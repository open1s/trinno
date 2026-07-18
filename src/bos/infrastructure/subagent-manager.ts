import { BrainOS } from '@open1s/ezbos';
import { getAgentFactory } from './agent-factory.js';
import { loadLocalSkill } from './remote_skills.js';

export interface SubagentInfo {
  jobId: string;
  name: string;
  skillName: string;
  goal: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  elapsedMs: number;
  output: string;
  error?: string;
}

type SubagentCallback = (subagents: SubagentInfo[]) => void;

export class SubagentManager {
  private subagents = new Map<string, SubagentInfo>();
  private outputs = new Map<string, string>();
  private abortControllers = new Map<string, AbortController>();
  private maxConcurrent: number;
  private resultTtlMs: number;
  pendingNotifications: string[];
  private onStatusChange: SubagentCallback;

  constructor(options?: {
    maxConcurrent?: number;
    resultTtlMs?: number;
    pendingNotificationsRef?: string[];
    onStatusChange?: SubagentCallback;
  }) {
    this.maxConcurrent = options?.maxConcurrent ?? 5;
    this.resultTtlMs = options?.resultTtlMs ?? 10 * 60 * 1000;
    this.pendingNotifications = options?.pendingNotificationsRef ?? [];
    this.onStatusChange = options?.onStatusChange ?? (() => {});
  }

  setEmitFn(fn: (subagents: SubagentInfo[]) => void): void {
    this.onStatusChange = fn;
  }

  private emitStatus(): void {
    const now = Date.now();
    const list = Array.from(this.subagents.entries()).map(([id, info]) => {
      const liveOutput = this.outputs.get(id);
      return {
        ...info,
        output: liveOutput ?? info.output,
        elapsedMs: info.status === 'running' ? now - info.startedAt : info.elapsedMs,
      };
    });
    this.onStatusChange(list);
  }

  async spawn(name: string, skillName: string, goal: string, timeoutSecs?: number): Promise<SubagentInfo> {
    if (this.subagents.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent subagents reached (${this.maxConcurrent})`);
    }

    const jobId = `sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const skillContent = loadLocalSkill(skillName);
    const systemPrompt = skillContent?.content
      ? `You are "${name}", a specialized subagent using the "${skillName}" skill.\n\n${skillContent.content}\n\nYour goal: ${goal}`
      : `You are "${name}". Your goal: ${goal}`;

    const info: SubagentInfo = {
      jobId,
      name,
      skillName,
      goal,
      status: 'running',
      startedAt: Date.now(),
      elapsedMs: 0,
      output: '',
    };
    this.subagents.set(jobId, info);
    this.outputs.set(jobId, '');
    this.emitStatus();

    const abort = new AbortController();
    this.abortControllers.set(jobId, abort);
    const timeout = timeoutSecs ?? 300;

    const run = async () => {
      let timedOut = false;
      const timer = setTimeout(() => {
        if (!abort.signal.aborted) {
          timedOut = true;
          abort.abort();
        }
      }, timeout * 1000);

      try {
        const factory = getAgentFactory();
        const agent = factory.create({
          name: `sa-${name}`,
          systemPrompt,
        });
        const started = await agent.start();

        abort.signal.addEventListener('abort', () => {
          started.stop().catch(() => {});
        });

        const textParts: string[] = [];
        await new Promise<void>((resolve) => {
          const onAbort = () => { started.stop().catch(() => {}); resolve(); };
          abort.signal.addEventListener('abort', onAbort, { once: true });

          started.stream(goal, (token: any) => {
            if (abort.signal.aborted) return;
            switch (token.type) {
              case 'Text':
                textParts.push(token.text);
                this.outputs.set(jobId, textParts.join(''));
                break;
              case 'Stop':
              case 'Done':
                resolve();
                break;
              case 'Error':
                resolve();
                break;
            }
          });
        });

        clearTimeout(timer);

        if (timedOut) {
          info.status = 'failed';
          info.error = `timeout after ${timeout}s`;
        } else if (abort.signal.aborted) {
          info.status = 'failed';
          info.error = 'aborted';
        } else {
          info.status = 'completed';
        }
        info.output = textParts.join('');
        info.elapsedMs = Date.now() - info.startedAt;
        this.emitStatus();
        this.appendNotification(name, jobId, info.status);
      } catch (err) {
        if (info.status === 'cancelled') return;
        const now = Date.now();
        info.status = 'failed';
        info.error = err instanceof Error ? err.message : String(err);
        info.elapsedMs = now - info.startedAt;
        this.emitStatus();
        this.appendNotification(name, jobId, 'failed', info.error);
      } finally {
        setTimeout(() => {
          this.subagents.delete(jobId);
          this.outputs.delete(jobId);
          this.abortControllers.delete(jobId);
          this.emitStatus();
        }, this.resultTtlMs);
      }
    };

    run();
    return info;
  }

  list(): SubagentInfo[] {
    const now = Date.now();
    for (const info of this.subagents.values()) {
      if (info.status === 'running') {
        info.elapsedMs = now - info.startedAt;
      }
    }
    return Array.from(this.subagents.values());
  }

  getResult(jobId: string): SubagentInfo | undefined {
    const info = this.subagents.get(jobId);
    if (!info) return undefined;
    if (info.status === 'running') {
      info.elapsedMs = Date.now() - info.startedAt;
    }
    return { ...info, output: this.outputs.get(jobId) ?? '' };
  }

  stop(jobId: string): boolean {
    const info = this.subagents.get(jobId);
    if (!info) return false;
    if (info.status !== 'running') return false;
    const abort = this.abortControllers.get(jobId);
    if (abort) {
      abort.abort();
    }
    info.status = 'cancelled';
    info.elapsedMs = Date.now() - info.startedAt;
    this.emitStatus();
    this.appendNotification(info.name, jobId, 'cancelled');
    return true;
  }

  private appendNotification(name: string, jobId: string, status: string, error?: string): void {
    const msg = status === 'completed'
      ? `Subagent "${name}" completed (${jobId})`
      : status === 'failed'
        ? `Subagent "${name}" failed: ${error || 'unknown error'} (${jobId})`
        : `Subagent "${name}" ${status} (${jobId})`;
    this.pendingNotifications.push(msg);
  }

  drainNotifications(): string[] {
    const drained = [...this.pendingNotifications];
    this.pendingNotifications.length = 0;
    return drained;
  }
}

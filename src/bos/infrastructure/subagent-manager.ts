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
  displayExpired?: boolean;
}

type SubagentCallback = (subagents: SubagentInfo[]) => void;

const MAX_OUTPUT_LENGTH = 100 * 1024;
const EMIT_THROTTLE_MS = 1000;
const COMPLETED_REMOVE_DELAY_MS = 3000;
const MAX_SUBAGENT_RETRIES = 3;
const SUBAGENT_RETRY_BACKOFF_MS = 2000;

function isRateLimited(msg: string): boolean {
  return /\b429\b|rate.?limit|too many requests/i.test(msg);
}

function parseRetryAfter(msg: string): number {
  const patterns = [
    /retry.?after\s*[=:]?\s*(\d+)\s*s/i,
    /try again in (\d+)\s*s/i,
    /please retry in (\d+)\s*seconds/i,
    /in (\d+)\s*seconds/i,
    /retry-after:\s*(\d+)/i,
    /"retry_after"\s*:\s*(\d+)/i,
  ];
  for (const re of patterns) {
    const m = msg.match(re);
    if (m && m[1]) {
      const s = parseInt(m[1], 10);
      if (s > 0 && s <= 300) return s;
    }
  }
  return 15;
}
const SUBAGENT_TOOL_NAMES = new Set([
  // Subagent management (recursion)
  'spawn_subagent', 'list_subagents', 'get_subagent_result', 'stop_subagent',
  // Shell execution
  'bash', 'exec_tool',
  // Write to disk
  'write_file', 'edit_file', 'ast_edit', 'apply_patch',
  'download_paper',
  // Write to store
  'store_memory', 'clear_memory', 'todowrite',
  // Write goal
  'update_goal',
]);

export class SubagentManager {
  private subagents = new Map<string, SubagentInfo>();
  private outputs = new Map<string, string>();
  private abortControllers = new Map<string, AbortController>();
  private maxConcurrent: number;
  private resultTtlMs: number;
  private lastEmitTime = 0;
  pendingNotifications: string[];
  private onStatusChange: SubagentCallback;
  private defaultHooks: any[];
  private bus?: any;
  private resultPub?: any;

  constructor(options?: {
    maxConcurrent?: number;
    resultTtlMs?: number;
    pendingNotificationsRef?: string[];
    onStatusChange?: SubagentCallback;
    defaultHooks?: any[];
    bus?: any;
  }) {
    this.maxConcurrent = options?.maxConcurrent ?? 5;
    this.resultTtlMs = options?.resultTtlMs ?? 10 * 60 * 1000;
    this.pendingNotifications = options?.pendingNotificationsRef ?? [];
    this.onStatusChange = options?.onStatusChange ?? (() => {});
    this.defaultHooks = options?.defaultHooks ?? [];
    this.bus = options?.bus;
  }

  setEmitFn(fn: (subagents: SubagentInfo[]) => void): void {
    this.onStatusChange = fn;
  }

  private async ensureResultPub(): Promise<void> {
    if (!this.bus || this.resultPub) return;
    this.resultPub = await this.bus.publisher('trinno:subagent:result');
  }

  private async publishResult(info: SubagentInfo): Promise<void> {
    try {
      await this.ensureResultPub();
      if (!this.resultPub) return;
      const { output, ...safe } = info;
      this.resultPub.text(JSON.stringify({ ...safe, outputLength: output.length })).catch(() => {});
    } catch {
      // bus unavailable — silently skip
    }
  }

  private emitStatus(): void {
    this.lastEmitTime = Date.now();
    const now = this.lastEmitTime;
    const list = Array.from(this.subagents.entries())
      .filter(([, info]) => !info.displayExpired)
      .map(([id, info]) => {
      const liveOutput = this.outputs.get(id);
      return {
        ...info,
        output: liveOutput ?? info.output,
        elapsedMs: info.status === 'running' ? now - info.startedAt : info.elapsedMs,
      };
    });
    this.onStatusChange(list);
  }

  private tryEmitStatus(): void {
    const now = Date.now();
    if (now - this.lastEmitTime >= EMIT_THROTTLE_MS) {
      this.emitStatus();
    }
  }

  async spawn(name: string, skillName: string, goal: string, timeoutSecs?: number): Promise<SubagentInfo> {
    if (this.subagents.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent subagents reached (${this.maxConcurrent})`);
    }

    const jobId = `sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const skillContent = loadLocalSkill(skillName);
    const skillSection = skillContent?.content
      ? `\n## Skill Instructions\n\n${skillContent.content}\n`
      : '';
    const rules = [
      `You are a focused subagent named "${name}".`,
      skillSection,
      `## Task\n\n${goal}`,
      ``,
      `## Rules`,
      `- Read-only: you can read/search files and the web, but cannot modify anything.`,
      `- After finishing, output the result and do NOT call more tools.`,
      `- Do NOT ask for approval — act autonomously.`,
      `- Keep output concise.`,
    ].filter(Boolean).join('\n');

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
        let outputText = '';
        let truncated = false;
        let lastError: string | null = null;

        for (let attempt = 0; attempt <= MAX_SUBAGENT_RETRIES; attempt++) {
          if (info.status !== 'running') break;
          if (attempt > 0) {
            if (!lastError || !isRateLimited(lastError)) break;
            const retryAfter = parseRetryAfter(lastError);
            const delay = Math.max(retryAfter * 1000, SUBAGENT_RETRY_BACKOFF_MS * Math.pow(2, attempt - 1));
            await Promise.race([
              new Promise(r => setTimeout(r, delay)),
              new Promise(r => abort.signal.addEventListener('abort', r, { once: true })),
            ]);
            if (info.status !== 'running') break;
            outputText = '';
            truncated = false;
            this.outputs.set(jobId, '');
            this.tryEmitStatus();
          }

          const factory = getAgentFactory();
          const modelConfig: any = (globalThis as any).__TRP_MODEL_CONFIG || {};
          const safeTools = factory.getDefaultTools().filter(t => !SUBAGENT_TOOL_NAMES.has(t.name));
          const agent = factory.create({
            name: `sa-${name}`,
            systemPrompt: rules,
            skipDefaultHooks: true,
            skipDefaultTools: true,
            tools: safeTools,
            hooks: this.defaultHooks,
            model: modelConfig.model,
            baseUrl: modelConfig.baseUrl,
            apiKey: modelConfig.apiKey,
          });
          const started = await agent.start();

          const abortStop = () => { started.stop().catch(() => {}); };
          let onAbort: (() => void) | null = null;

          abort.signal.addEventListener('abort', abortStop);

          try {
            await new Promise<void>((resolve) => {
              onAbort = () => { started.stop().catch(() => {}); resolve(); };
              abort.signal.addEventListener('abort', onAbort, { once: true });

              lastError = null;
              try {
                started.stream(goal, (token: any) => {
                  try {
                    if (abort.signal.aborted) return;
                    switch (token.type) {
                      case 'Text':
                        if (!truncated) {
                          outputText += token.text;
                          if (outputText.length > MAX_OUTPUT_LENGTH) {
                            truncated = true;
                            outputText = outputText.slice(0, MAX_OUTPUT_LENGTH) + '\n\n[output truncated]';
                          }
                          this.outputs.set(jobId, outputText);
                          this.tryEmitStatus();
                        }
                        break;
                      case 'Stop':
                      case 'Done':
                        resolve();
                        break;
                      case 'Error':
                        lastError = token.error || '';
                        started.stop().catch(() => {});
                        resolve();
                        break;
                    }
                  } catch (e) {
                    lastError = String(e);
                    resolve();
                  }
                });
              } catch (e) {
                lastError = String(e);
                resolve();
              }
            });
          } finally {
            abort.signal.removeEventListener('abort', abortStop);
            if (onAbort) abort.signal.removeEventListener('abort', onAbort);
            // If retrying, stop the partial agent
            if (attempt < MAX_SUBAGENT_RETRIES && lastError && isRateLimited(lastError)) {
              started.stop().catch(() => {});
            }
          }

          if (!lastError || !isRateLimited(lastError)) break;
        }

        clearTimeout(timer);

        if (info.status === 'cancelled') {
          // stop() already set status, emitted, and notified
        } else if (lastError && isRateLimited(lastError)) {
          info.status = 'failed';
          info.error = `rate limited after ${MAX_SUBAGENT_RETRIES + 1} attempts: ${lastError}`;
          info.elapsedMs = Date.now() - info.startedAt;
          this.emitStatus();
          this.appendNotification(name, 'failed', info.error);
          this.publishResult(info);
        } else if (timedOut) {
          info.status = 'failed';
          info.error = `timeout after ${timeout}s`;
          info.output = outputText;
          info.elapsedMs = Date.now() - info.startedAt;
          this.emitStatus();
          this.appendNotification(name, info.status);
          this.publishResult(info);
        } else if (abort.signal.aborted) {
          info.status = 'failed';
          info.error = 'aborted';
          info.output = outputText;
          info.elapsedMs = Date.now() - info.startedAt;
          this.emitStatus();
          this.appendNotification(name, info.status);
          this.publishResult(info);
        } else {
          info.status = 'completed';
          info.output = outputText;
          info.elapsedMs = Date.now() - info.startedAt;
          this.emitStatus();
          this.appendNotification(name, info.status);
          this.publishResult(info);
        }
      } catch (err) {
        if (info.status === 'cancelled') return;
        info.status = 'failed';
        const errMsg = err instanceof Error ? err.message : String(err);
        if (isRateLimited(errMsg)) {
          info.error = `rate limited after ${MAX_SUBAGENT_RETRIES + 1} attempts: ${errMsg}`;
        } else if (timedOut) {
          info.error = `timeout after ${timeout}s`;
        } else {
          info.error = errMsg;
        }
        info.elapsedMs = Date.now() - info.startedAt;
        this.emitStatus();
        this.appendNotification(name, 'failed', info.error);
        this.publishResult(info);
      } finally {
        // Display eviction: all terminal states disappear from UI after short delay
        if (info.status === 'completed' || info.status === 'failed') {
          setTimeout(() => {
            info.displayExpired = true;
            this.emitStatus();
          }, COMPLETED_REMOVE_DELAY_MS);
        }
        // (cancelled agents are handled by stop() with the same delay)
        // Data eviction: free memory after full TTL
        setTimeout(() => {
          this.subagents.delete(jobId);
          this.outputs.delete(jobId);
          this.abortControllers.delete(jobId);
        }, this.resultTtlMs);
      }
    };

    run();
    return info;
  }

  list(): SubagentInfo[] {
    const now = Date.now();
    return Array.from(this.subagents.entries())
      .filter(([, info]) => info.status !== 'completed')
      .map(([id, info]) => {
        const { displayExpired: _, ...rest } = info;
        return {
          ...rest,
          elapsedMs: info.status === 'running' ? now - info.startedAt : info.elapsedMs,
        };
      });
  }

  getResult(jobId: string): SubagentInfo | undefined {
    const info = this.subagents.get(jobId);
    if (!info) return undefined;
    const { displayExpired: _, ...rest } = info;
    const elapsedMs = info.status === 'running' ? Date.now() - info.startedAt : info.elapsedMs;
    return { ...rest, elapsedMs, output: this.outputs.get(jobId) ?? '' };
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
    this.appendNotification(info.name, 'cancelled');
    this.publishResult(info);
    // Display eviction: cancelled agents disappear from UI after short delay
    setTimeout(() => {
      info.displayExpired = true;
      this.emitStatus();
    }, COMPLETED_REMOVE_DELAY_MS);
    return true;
  }

  private appendNotification(name: string, status: string, error?: string): void {
    const msg = status === 'failed'
      ? `Subagent "${name}" failed: ${error || 'unknown error'}`
      : `Subagent "${name}" ${status}`;
    this.pendingNotifications.push(msg);
  }

  drainNotifications(): string[] {
    const drained = [...this.pendingNotifications];
    this.pendingNotifications.length = 0;
    return drained;
  }
}

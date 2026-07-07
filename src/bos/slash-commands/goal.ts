import { SlashCommand } from './registry.js';
import * as path from 'path';
import * as fs from 'fs';

export interface GoalState {
  text: string;
  status: 'active' | 'paused' | 'blocked' | 'complete' | 'budget_limited' | 'usage_limited';
  createdAt: number;
  updatedAt: number;
  tokensUsed?: number;
  blockedReasons?: string[];
  blockedCount?: number;
  acceptanceCriteria?: string[];
}

function isTerminal(status: string): boolean {
  return status === 'complete' || status === 'budget_limited';
}

function isActive(status: string): boolean {
  return status === 'active';  // only 'active' triggers continuation loop
}

function atomicWrite(fp: string, data: string): void {
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, fp);
}

function goalFilePath(): string {
  const root: string = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
  return path.join(root, '.trinno', 'goal.json');
}

function readGoal(): GoalState | null {
  try {
    const data = fs.readFileSync(goalFilePath(), 'utf-8');
    return JSON.parse(data) as GoalState;
  } catch {
    return null;
  }
}

function writeGoal(goal: GoalState): void {
  const fp = goalFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  atomicWrite(fp, JSON.stringify(goal, null, 2));
}

function deleteGoal(): void {
  try {
    fs.unlinkSync(goalFilePath());
  } catch {
    // ignore if not exist
  }
}

function ago(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Pursuing',
  paused: 'Paused',
  blocked: 'Blocked',
  complete: 'Complete',
  budget_limited: 'Budget Ltd',
  usage_limited: 'Usage Ltd',
};

export const goalCommand: SlashCommand = {
  name: 'goal',
  description: 'Set, view, pause, resume, or clear a persistent research goal',
  usage: '/goal <text> | /goal | /goal pause | /goal resume | /goal clear',
  async execute(args: string, _deps: any, emit: (type: string, data: any) => void, _signal: AbortSignal) {
    const trimmed = args.trim().toLowerCase();

    if (trimmed === 'clear') {
      deleteGoal();
      emit('token', { tokenType: 'Text', text: 'Goal cleared.\n' });
      emit('done', {});
      return;
    }

    if (trimmed === 'pause') {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set. Use `/goal <text>` to set one.\n' });
      } else {
        goal.status = 'paused';
        goal.updatedAt = Date.now();
        writeGoal(goal);
        emit('token', { tokenType: 'Text', text: `Goal **paused**: "${goal.text}"\n` });
      }
      emit('done', {});
      return;
    }

    if (trimmed === 'resume') {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set. Use `/goal <text>` to set one.\n' });
      } else {
        goal.status = 'active';
        goal.updatedAt = Date.now();
        goal.blockedCount = 0;
        goal.blockedReasons = [];
        writeGoal(goal);
        emit('token', { tokenType: 'Text', text: `Goal **resumed**: "${goal.text}"\n` });
      }
      emit('done', {});
      return;
    }

    if (!trimmed) {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set. Use `/goal <text>` to set a research goal.\n\nThis goal will be injected into every message so the agent stays focused on it.\n\nUsage:\n- `/goal <text>` [budget=N] - Set a new goal (optional token budget)\n- `/goal` - View current goal\n- `/goal pause` - Pause (keep, but don\'t inject)\n- `/goal resume` - Resume (resets blocked count)\n- `/goal clear` - Delete\n' });
      } else {
        const label = STATUS_LABEL[goal.status] || goal.status;
        const blockedInfo = goal.status === 'blocked' && goal.blockedReasons?.length
          ? `\n**Reason:** ${goal.blockedReasons[goal.blockedReasons.length - 1]}`
          : '';
        emit('token', { tokenType: 'Text', text: [
          `## Current Goal\n`,
          ``,
          `**Status:** ${label}`,
          `**Set:** ${ago(goal.createdAt)}`,
          `**Updated:** ${ago(goal.updatedAt)}`,
          blockedInfo,
          ``,
          `> ${goal.text}`,
          ``,
          goal.status === 'active'
            ? '_Active — guiding responses and auto-continuing until complete._'
            : goal.status === 'paused'
            ? '_Paused — not injected into messages. Use /goal resume to continue._'
            : goal.status === 'blocked'
            ? `_Blocked — agent determined it cannot be completed.${goal.blockedReasons ? ' ' + goal.blockedReasons.slice(-1)[0] : ''}_`
            : goal.status === 'complete'
            ? '_Complete — goal achieved. Use /goal clear to archive._'
            : goal.status === 'budget_limited'
            ? '_Budget exhausted — use /goal resume budg et=N to continue with new budget._'
            : '',
          ``,
          `Use \`/goal pause\`, \`/goal resume\`, or \`/goal clear\` to manage.`,
        ].join('\n') });
      }
      emit('done', {});
      return;
    }

    // Set a new goal
    let goalText = args.trim();
    const goal: GoalState = {
      text: goalText,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tokensUsed: 0,
      blockedCount: 0,
    };
    writeGoal(goal);
    emit('token', { tokenType: 'Text', text: `## Goal Set\n\n**Goal:** ${goalText}\n\nAgent works autonomously until complete or blocked. System manages pause/resume.\n\nUse \`/goal\` to view status, \`/goal pause\` to pause, \`/goal clear\` to delete.\n` });
    emit('done', {});
  },
};

export function readGoalForWorker(): GoalState | null {
  return readGoal();
}

export function writeGoalForWorker(goal: GoalState): void {
  writeGoal(goal);
}

export function isGoalActive(status: string): boolean {
  return isActive(status);
}

export function isGoalTerminal(status: string): boolean {
  return isTerminal(status);
}

import { SlashCommand } from './registry.js';
import * as path from 'path';
import * as fs from 'fs';

export interface GoalHistoryEntry {
  at: number;
  from: string;
  to: string;
  note?: string;
}

export interface GoalState {
  text: string;
  status: 'active' | 'paused' | 'blocked' | 'complete' | 'budget_limited' | 'usage_limited';
  createdAt: number;
  updatedAt: number;
  tokensUsed?: number;
  blockedReasons?: string[];
  blockedCount?: number;
  acceptanceCriteria?: string[];
  note?: string;
  history?: GoalHistoryEntry[];
  progress?: { completed: number; total: number; items?: string[] };
  editedAt?: number;
  previousText?: string;
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

function pushHistory(goal: GoalState, from: string, to: string, note?: string): void {
  if (!Array.isArray(goal.history)) goal.history = [];
  const entry: GoalHistoryEntry = { at: Date.now(), from, to };
  if (note) entry.note = note;
  goal.history.push(entry);
}

export function appendGoalHistory(from: string, to: string, note?: string): void {
  const goal = readGoal();
  if (!goal) return;
  pushHistory(goal, from, to, note);
  writeGoal(goal);
}

export function updateGoalProgress(progress: { completed: number; total: number; items?: string[] }): void {
  const goal = readGoal();
  if (!goal) return;
  goal.progress = progress;
  goal.updatedAt = Date.now();
  writeGoal(goal);
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
  budget_limited: 'Stalled',
  usage_limited: 'Usage Ltd',
};

export const goalCommand: SlashCommand = {
  name: 'goal',
  description: 'Set, view, edit, pause, resume, annotate, log, or clear a persistent research goal',
  usage: '/goal <text> | /goal | /goal edit <text> | /goal status <note> | /goal log | /goal pause | /goal resume | /goal clear',
  async execute(args: string, _deps: any, emit: (type: string, data: any) => void, _signal: AbortSignal) {
    const raw = args.trim();
    const lower = raw.toLowerCase();

    if (lower === 'clear') {
      deleteGoal();
      emit('token', { tokenType: 'Text', text: 'Goal cleared.\n' });
      emit('done', {});
      return;
    }

    if (lower === 'pause') {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set. Use `/goal <text>` to set one.\n' });
      } else {
        const prev = goal.status;
        goal.status = 'paused';
        goal.updatedAt = Date.now();
        pushHistory(goal, prev, 'paused');
        writeGoal(goal);
        emit('token', { tokenType: 'Text', text: `Goal **paused**: "${goal.text}"\n` });
      }
      emit('done', {});
      return;
    }

    if (lower === 'resume') {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set. Use `/goal <text>` to set one.\n' });
      } else {
        const prev = goal.status;
        goal.status = 'active';
        goal.updatedAt = Date.now();
        goal.blockedCount = 0;
        goal.blockedReasons = [];
        pushHistory(goal, prev, 'active');
        writeGoal(goal);
        emit('token', { tokenType: 'Text', text: `Goal **resumed**: "${goal.text}"\n` });
      }
      emit('done', {});
      return;
    }

    if (lower === 'log') {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set.\n' });
      } else {
        const lines: string[] = ['## Goal Log\n', `**Objective:** ${goal.text}`, ''];
        const hist = goal.history ?? [];
        if (hist.length === 0) {
          lines.push('_No status transitions recorded._\n');
        } else {
          for (const h of hist) {
            const ts = new Date(h.at).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
            const noteStr = h.note ? ` — "${h.note}"` : '';
            lines.push(`- ${ts} \`${h.from}\` → \`${h.to}\`${noteStr}`);
          }
          lines.push('');
        }
        if (goal.blockedReasons?.length) {
          lines.push('**Blocked reasons (chronological):**\n');
          for (const r of goal.blockedReasons) {
            lines.push(`- ${r}`);
          }
          lines.push('');
        }
        if (goal.progress) {
          lines.push(`**Sub-task progress:** ${goal.progress.completed}/${goal.progress.total}\n`);
        }
        emit('token', { tokenType: 'Text', text: lines.join('\n') });
      }
      emit('done', {});
      return;
    }

    const editMatch = raw.match(/^edit\s+(.+)$/i);
    if (editMatch) {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set. Use `/goal <text>` to set one first.\n' });
      } else {
        const oldText = goal.text;
        goal.text = editMatch[1]!.trim();
        goal.updatedAt = Date.now();
        goal.editedAt = Date.now();
        goal.previousText = oldText;
        pushHistory(goal, goal.status, goal.status, `edit: "${oldText}" → "${goal.text}"`);
        writeGoal(goal);
        emit('token', { tokenType: 'Text', text: `Goal **edited**:\n\nOld: ${oldText}\nNew: ${goal.text}\n` });
      }
      emit('done', {});
      return;
    }

    const statusMatch = raw.match(/^status\s+(.+)$/i);
    if (statusMatch) {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set. Use `/goal <text>` to set one first.\n' });
      } else {
        goal.note = statusMatch[1]!.trim();
        goal.updatedAt = Date.now();
        pushHistory(goal, goal.status, goal.status, `note: ${goal.note}`);
        writeGoal(goal);
        emit('token', { tokenType: 'Text', text: `Goal **annotated**:\n\n> ${goal.note}\n\nThe agent will see this note on subsequent turns.\n` });
      }
      emit('done', {});
      return;
    }

    if (!raw) {
      const goal = readGoal();
      if (!goal) {
        emit('token', { tokenType: 'Text', text: 'No goal set. Use `/goal <text>` to set a research goal.\n\nThis goal will be injected into every message so the agent stays focused on it.\n\nUsage:\n- `/goal <text>` - Set a new goal\n- `/goal` - View current goal\n- `/goal edit <text>` - Refine objective (keeps history)\n- `/goal status <note>` - Annotate goal with a user note\n- `/goal log` - Show full goal history\n- `/goal pause` - Pause (keep, but don\'t inject)\n- `/goal resume` - Resume (resets blocked count)\n- `/goal clear` - Delete\n' });
      } else {
        const label = STATUS_LABEL[goal.status] || goal.status;
        const blockedInfo = goal.status === 'blocked' && goal.blockedReasons?.length
          ? `\n**Reason:** ${goal.blockedReasons[goal.blockedReasons.length - 1]}`
          : '';
        const noteInfo = goal.note ? `\n**Note:** ${goal.note}` : '';
        const progressInfo = goal.progress ? `\n**Sub-tasks:** ${goal.progress.completed}/${goal.progress.total}` : '';
        const lines: string[] = [
          '## Current Goal',
          '',
          `**Status:** ${label}`,
          `**Set:** ${ago(goal.createdAt)}`,
          `**Updated:** ${ago(goal.updatedAt)}`,
          progressInfo,
          blockedInfo,
          noteInfo,
          '',
          `> ${goal.text}`,
          '',
          goal.status === 'active'
            ? '_Pursuing — guiding responses and auto-continuing until complete._'
            : goal.status === 'paused'
            ? '_Paused — not injected. Use /goal resume to continue._'
            : goal.status === 'blocked'
            ? `_Blocked — agent cannot complete.${goal.blockedReasons ? ' ' + goal.blockedReasons.slice(-1)[0] : ''}_`
            : goal.status === 'complete'
            ? '_Complete — use /goal clear to archive._'
            : goal.status === 'budget_limited'
            ? '_Stalled — no todowrite for 3 consecutive rounds OR identical output loop. Use `/goal resume` to retry._'
            : '',
          '',
          'Use `/goal pause`, `/goal resume`, `/goal edit <text>`, `/goal status <note>`, `/goal log`, or `/goal clear`.',
        ].filter(l => l !== '' || true);
        emit('token', { tokenType: 'Text', text: lines.join('\n') });
      }
      emit('done', {});
      return;
    }

    // Set a new goal
    const goalText = raw;
    const goal: GoalState = {
      text: goalText,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tokensUsed: 0,
      blockedCount: 0,
    };
    pushHistory(goal, 'none', 'active', 'goal set');
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

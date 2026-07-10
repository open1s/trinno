import * as fs from 'fs';
import * as path from 'path';
import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

const AUTO_STATE_FILE = 'auto_state.json';
const MAX_ITERATIONS = 50;

export interface AutoState {
  hypothesis: string;
  iteration: number;
  status: 'active' | 'paused' | 'complete';
  createdAt: number;
  updatedAt: number;
  history?: { at: number; from: string; to: string; note?: string }[];
}

function stateFilePath(root: string): string {
  return path.join(root, '08_AutoResearch', AUTO_STATE_FILE);
}

function atomicWrite(fp: string, data: string): void {
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, fp);
}

export function readAutoState(root: string): AutoState | null {
  try {
    const p = stateFilePath(root);
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as AutoState;
  } catch {
    return null;
  }
}

export function writeAutoState(root: string, state: AutoState): void {
  const p = stateFilePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWrite(p, JSON.stringify(state, null, 2));
}

function deleteAutoState(root: string): void {
  try { fs.unlinkSync(stateFilePath(root)); } catch { /* ok */ }
}

function pushHistory(state: AutoState, from: string, to: string, note?: string): void {
  if (!Array.isArray(state.history)) state.history = [];
  const entry: { at: number; from: string; to: string; note?: string } = { at: Date.now(), from, to };
  if (note) entry.note = note;
  state.history.push(entry);
}

function ensureAutoDirs(root: string): string | null {
  const autoDir = path.join(root, '08_AutoResearch');
  const experimentsDir = path.join(autoDir, 'experiments');
  try {
    fs.mkdirSync(experimentsDir, { recursive: true });
    fs.mkdirSync(path.join(autoDir, 'code'), { recursive: true });
    fs.mkdirSync(path.join(autoDir, 'results'), { recursive: true });
    fs.mkdirSync(path.join(autoDir, 'validation'), { recursive: true });
  } catch {
    return null;
  }
  return autoDir;
}

export const autoCommand: SlashCommand = {
  name: 'auto',
  description: 'AutoResearch iteration loop: propose → act → evaluate → ratchet. Subcommands: clear, status, pause, resume, log',
  usage: '/auto <hypothesis> | /auto clear | /auto status | /auto pause | /auto resume | /auto log',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const root = deps.phaseWriter.getWorkspaceRoot();
    if (!root) {
      emit('token', { tokenType: 'Text', text: 'No workspace root. Run /init first.' });
      emit('done', {});
      return;
    }

    const raw = args.trim();
    const lower = raw.toLowerCase();

    // Subcommand: /auto clear
    if (lower === 'clear') {
      deleteAutoState(root);
      emit('token', { tokenType: 'Text', text: 'AutoResearch state cleared.\n' });
      emit('done', {});
      return;
    }

    // Subcommand: /auto pause
    if (lower === 'pause') {
      const state = readAutoState(root);
      if (!state) {
        emit('token', { tokenType: 'Text', text: 'No active AutoResearch loop. Use `/auto <hypothesis>` to start.\n' });
      } else {
        state.status = 'paused';
        state.updatedAt = Date.now();
        pushHistory(state, state.status, 'paused');
        writeAutoState(root, state);
        emit('token', { tokenType: 'Text', text: `AutoResearch **paused** at iteration ${state.iteration}.\n` });
      }
      emit('done', {});
      return;
    }

    // Subcommand: /auto resume
    if (lower === 'resume') {
      const state = readAutoState(root);
      if (!state) {
        emit('token', { tokenType: 'Text', text: 'No AutoResearch loop found. Use `/auto <hypothesis>` to start.\n' });
      } else {
        state.status = 'active';
        state.updatedAt = Date.now();
        pushHistory(state, state.status, 'active');
        writeAutoState(root, state);
        emit('token', { tokenType: 'Text', text: `AutoResearch **resumed** at iteration ${state.iteration}: "${state.hypothesis}"\n\nThe next message will inject this hypothesis.\n` });
      }
      emit('done', {});
      return;
    }

    // Subcommand: /auto status
    if (lower === 'status' || raw === '') {
      const state = readAutoState(root);
      if (!state) {
        emit('token', { tokenType: 'Text', text: 'No AutoResearch loop running. Use `/auto <hypothesis>` to start.\n\nUsage:\n- `/auto <hypothesis>` — Start/continue a loop\n- `/auto status` — View current state\n- `/auto pause` — Pause (state preserved)\n- `/auto resume` — Resume\n- `/auto log` — Show history\n- `/auto clear` — Delete state\n' });
      } else {
        const lines: string[] = [
          '## AutoResearch Status',
          '',
          `**Iteration:** ${state.iteration}/${MAX_ITERATIONS}`,
          `**Hypothesis:** ${state.hypothesis}`,
          `**Status:** ${state.status}`,
          `**Created:** ${timeAgo(state.createdAt)}`,
          `**Updated:** ${timeAgo(state.updatedAt)}`,
          '',
        ];
        emit('token', { tokenType: 'Text', text: lines.join('\n') });
      }
      emit('done', {});
      return;
    }

    // Subcommand: /auto log
    if (lower === 'log') {
      const state = readAutoState(root);
      if (!state) {
        emit('token', { tokenType: 'Text', text: 'No AutoResearch loop found.\n' });
      } else {
        const lines: string[] = ['## AutoResearch Log\n', `**Hypothesis:** ${state.hypothesis}`, ''];
        const hist = state.history ?? [];
        if (hist.length === 0) {
          lines.push('_No transitions recorded._\n');
        } else {
          for (const h of hist) {
            const ts = new Date(h.at).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
            const noteStr = h.note ? ` — "${h.note}"` : '';
            lines.push(`- ${ts} \`${h.from}\` → \`${h.to}\`${noteStr}`);
          }
          lines.push('');
        }
        emit('token', { tokenType: 'Text', text: lines.join('\n') });
      }
      emit('done', {});
      return;
    }

    // Default: start/continue a loop with the given hypothesis
    if (signal.aborted) { emit('done', {}); return; }

    const autoDir = ensureAutoDirs(root);
    if (!autoDir) {
      emit('token', { tokenType: 'Text', text: `Cannot create directories in ${root}/08_AutoResearch. Check filesystem permissions.` });
      emit('done', {});
      return;
    }

    const scopePath = path.join(autoDir, 'scope.md');
    const evalPath = path.join(autoDir, 'eval.md');
    try {
      fs.accessSync(scopePath);
      fs.accessSync(evalPath);
    } catch {
      emit('token', { tokenType: 'Text', text: [
        '## /auto: Setup Required',
        '',
        'AutoResearch loop requires two setup files. Run `/init` to create templates:',
        '',
        '| File | Path | Purpose |',
        '|------|------|---------|',
        '| scope.md | `08_AutoResearch/scope.md` | Research scope, constraints, success criteria, mutation surface |',
        '| eval.md | `08_AutoResearch/eval.md` | Fixed evaluation metric, protocol, accept/reject criteria |',
        '',
        'Then run `/auto <hypothesis>` to start iterating.',
      ].join('\n') });
      emit('done', {});
      return;
    }

    // Count existing experiment logs
    const experimentsDir = path.join(autoDir, 'experiments');
    const existingLogs = fs.readdirSync(experimentsDir)
      .filter(f => f.startsWith('log_') && f.endsWith('.md'))
      .sort();
    const nextIter = existingLogs.length + 1;

    // Check iteration cap
    if (nextIter > MAX_ITERATIONS) {
      emit('token', { tokenType: 'Text', text: `## AutoResearch: Iteration Cap Reached\n\nMax ${MAX_ITERATIONS} iterations exceeded. Use \`/auto clear\` to reset, then \`/auto <new hypothesis>\` to start a fresh loop.\n` });
      emit('done', {});
      return;
    }

    const hypothesis = raw;
    const now = Date.now();
    const existingState = readAutoState(root);

    const state: AutoState = {
      hypothesis,
      iteration: nextIter,
      status: 'active',
      createdAt: existingState?.createdAt ?? now,
      updatedAt: now,
      history: existingState?.history ?? [],
    };
    pushHistory(state, existingState?.status ?? 'none', 'active', `iteration ${nextIter}`);
    writeAutoState(root, state);

    emit('token', { tokenType: 'Text', text: [
      `## AutoResearch Iteration ${nextIter}`,
      '',
      `**Hypothesis:** ${hypothesis}`,
      '',
      `The hypothesis will be injected into the agent on your next message — just continue chatting.`,
      '',
      '| Setting | Value |',
      '|---------|-------|',
      `| Iteration | ${nextIter} / ${MAX_ITERATIONS} |`,
      `| Scope | \`08_AutoResearch/scope.md\` |`,
      `| Eval | \`08_AutoResearch/eval.md\` |`,
      `| Logs | \`08_AutoResearch/experiments/\` |`,
      '',
    ].join('\n') });
    emit('done', {});
  },
};

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

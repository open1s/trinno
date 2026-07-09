import * as fs from 'fs';
import * as path from 'path';
import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

const AUTO_STATE_FILE = 'auto_state.json';

interface AutoState {
  hypothesis: string;
  iteration: number;
}

export function readAutoState(root: string): AutoState | null {
  const p = path.join(root, '08_AutoResearch', AUTO_STATE_FILE);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as AutoState;
  } catch {
    return null;
  }
}

export function writeAutoState(root: string, state: AutoState): void {
  const p = path.join(root, '08_AutoResearch', AUTO_STATE_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

export const autoCommand: SlashCommand = {
  name: 'auto',
  description: 'Start/continue an AutoResearch iteration loop: propose → act → evaluate → ratchet',
  usage: '/auto <research question or hypothesis>',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const root = deps.phaseWriter.getWorkspaceRoot();
    if (!root) {
      emit('token', { tokenType: 'Text', text: 'No workspace root. Run /init first.' });
      emit('done', {});
      return;
    }

    const autoDir = path.join(root, '08_AutoResearch');
    const experimentsDir = path.join(autoDir, 'experiments');
    try {
      fs.mkdirSync(experimentsDir, { recursive: true });
      fs.mkdirSync(path.join(autoDir, 'code'), { recursive: true });
      fs.mkdirSync(path.join(autoDir, 'results'), { recursive: true });
      fs.mkdirSync(path.join(autoDir, 'validation'), { recursive: true });
    } catch {
      emit('token', { tokenType: 'Text', text: `Cannot create subdirectories in ${autoDir}. Check filesystem permissions.` });
      emit('done', {});
      return;
    }
    if (signal.aborted) { emit('done', {}); return; }

    const existingLogs = fs.readdirSync(experimentsDir)
      .filter(f => f.startsWith('log_') && f.endsWith('.md'))
      .sort();
    const nextIter = existingLogs.length + 1;

    const scopePath = path.join(autoDir, 'scope.md');
    const evalPath = path.join(autoDir, 'eval.md');

    if (!fs.existsSync(scopePath) || !fs.existsSync(evalPath)) {
      emit('token', { tokenType: 'Text', text: [
        '## /auto: Setup Required',
        '',
        'AutoResearch loop requires two setup files. Create them manually or run `/init`:',
        '',
        '| File | Path | Purpose |',
        '|------|------|---------|',
        '| scope.md | `08_AutoResearch/scope.md` | Research scope, constraints, success criteria, mutation surface',
        '| eval.md | `08_AutoResearch/eval.md` | Fixed evaluation metric, protocol, accept/reject criteria',
        '',
        'Then run `/auto <hypothesis>` to start iterating.',
      ].join('\n') });
      emit('done', {});
      return;
    }

    const hypothesis = args.trim() || `Iteration ${nextIter}: continue optimizing based on previous results`;

    // Persist state to disk so it survives worker restart
    writeAutoState(root, { hypothesis, iteration: nextIter });
    (globalThis as any).__AUTO_PENDING = { hypothesis, iteration: nextIter };

    emit('token', { tokenType: 'Text', text: [
      `## AutoResearch Iteration ${nextIter}`,
      '',
      `**Hypothesis:** ${hypothesis}`,
      '',
      `The hypothesis will be injected into the agent on your next message — just continue chatting.`,
      '',
      '| Setting | Value |',
      '|---------|-------|',
      `| Hypothesis | ${hypothesis} |`,
      `| Scope | \`08_AutoResearch/scope.md\` |`,
      `| Eval | \`08_AutoResearch/eval.md\` |`,
      `| Logs | \`08_AutoResearch/experiments/\` |`,
      '',
    ].join('\n') });
    emit('done', {});
  },
};

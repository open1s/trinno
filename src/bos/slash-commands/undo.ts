import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SlashCommand } from './registry.js';

let hasSnapshot = false;

function getWorkspaceRoot(): string {
  return (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
}

function isJjRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.jj'));
  } catch {
    return false;
  }
}

export function takeSnapshot(promptPreview: string): void {
  const ws = getWorkspaceRoot();
  if (!isJjRepo(ws)) return;

  try {
    const descOut = spawnSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'description'], { cwd: ws, encoding: 'utf-8', timeout: 10000 });
    const currentDesc = (descOut.stdout as string)?.trim() || '';

    const msg = `AI: ${promptPreview.slice(0, 60).replace(/\n/g, ' ')}`;

    if (currentDesc) {
      // @ already has a description from a prior snapshot — fork a child
      const newc = spawnSync('jj', ['new'], { cwd: ws, stdio: 'pipe', timeout: 10000 });
      if (newc.status !== 0) throw new Error(newc.stderr?.toString() || 'jj new failed');
    }

    // Describe @ (existing if bare, or the freshly forked child)
    spawnSync('jj', ['describe', '-m', msg], { cwd: ws, stdio: 'pipe', timeout: 10000 });
    hasSnapshot = true;
  } catch {
    // jj unavailable or not a jj repo — skip silently
  }
}

export const undoCommand: SlashCommand = {
  name: 'undo',
  description: 'Undo the last AI prompt (jj abandon current working copy)',
  usage: '/undo',
  execute: async (_args, _deps, emit, _signal) => {
    const ws = getWorkspaceRoot();
    if (!isJjRepo(ws)) {
      emit('token', { tokenType: 'Text', text: 'No jj repository found at workspace root. Cannot undo.\n' });
      emit('done', {});
      return;
    }

    if (!hasSnapshot) {
      emit('token', { tokenType: 'Text', text: 'Nothing to undo — no prior prompt changes found.\n' });
      emit('done', {});
      return;
    }

    // 1. Get current @'s change_id (the commit we're about to remove)
    const idOut = spawnSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'change_id'], { cwd: ws, encoding: 'utf-8', timeout: 10000 });
    const currentId = (idOut.stdout as string)?.trim();
    if (!currentId) {
      emit('error', { error: 'Failed to read current change id' });
      return;
    }

    // 2. Move working copy to parent (reverts files to parent's state)
    const editRes = spawnSync('jj', ['edit', '@-'], { cwd: ws, stdio: 'pipe', timeout: 10000 });
    if (editRes.status !== 0) {
      emit('error', { error: `jj edit failed: ${editRes.stderr?.toString() || 'unknown error'}` });
      return;
    }

    // 3. Abandon the old commit (now that @ has moved away from it)
    const abandonRes = spawnSync('jj', ['abandon', currentId], { cwd: ws, stdio: 'pipe', timeout: 10000 });
    if (abandonRes.status !== 0) {
      emit('error', { error: `jj abandon failed: ${abandonRes.stderr?.toString() || 'unknown error'}` });
      return;
    }

    // 4. If the new @ also has an AI: description, keep hasSnapshot for further undo
    const descOut = spawnSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'description'], { cwd: ws, encoding: 'utf-8', timeout: 10000 });
    const currentDesc = (descOut.stdout as string)?.trim() || '';
    hasSnapshot = currentDesc.startsWith('AI:');

    emit('token', { tokenType: 'Text', text: 'Undone: reverted the last AI change.\n' });
    emit('done', {});
  },
};

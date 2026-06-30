import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface RemoteSkillEntry {
  name: string;
  description: string;
  /** Primary git URL. Optional when `repos` is provided. */
  repo?: string;
  /**
   * Additional git URLs that contribute skills under the same `name`.
   * Order matters: `repo` (if any) is consulted first, then entries here in
   * array order. Useful for mirrors / multi-source skill aggregation.
   */
  repos?: string[];
  ref?: string;
  tags?: string[];
}

export interface RemoteSkillSearchHit {
  name: string;
  description: string;
  repo: string;
  ref?: string;
  tags?: string[];
  score: number;
}

export interface LoadResult {
  ok: boolean;
  content?: string;
  error?: string;
  cacheDir?: string;
  subdirs?: string[];
}

const SKILL_FILE = 'SKILL.md';
const README_FILE = 'README.md';
const VALID_SEG = /^[a-zA-Z0-9_.-]+$/;
const MAX_SCAN_DEPTH = 6;

/**
 * Resolve the effective ordered list of git URLs for a registry entry.
 * `repo` (primary) is first, followed by the `repos` array; duplicates are
 * removed and surrounding whitespace is trimmed.
 */
export function getEntryRepos(entry: RemoteSkillEntry): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== 'string') return;
    const trimmed = v.trim();
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed);
  };
  push(entry.repo);
  if (Array.isArray(entry.repos)) {
    for (const r of entry.repos) push(r);
  }
  return out;
}

export function parseRemoteSkillsFromConfigJson(configJson: string): RemoteSkillEntry[] {
  try {
    const config = JSON.parse(configJson);
    const sec = config?.skills_registry;
    const list = sec?.skills;
    if (!Array.isArray(list)) return [];
    return list
      .filter((e: any) => {
        if (!e || typeof e.name !== 'string' || typeof e.description !== 'string') return false;
        const hasRepo = typeof e.repo === 'string' && e.repo.trim().length > 0;
        const hasRepos =
          Array.isArray(e.repos) &&
          e.repos.some((r: any) => typeof r === 'string' && r.trim().length > 0);
        return hasRepo || hasRepos;
      })
      .map((e: any) => {
        const entry: RemoteSkillEntry = {
          name: e.name,
          description: e.description,
        };
        if (typeof e.repo === 'string' && e.repo.trim().length > 0) {
          entry.repo = e.repo.trim();
        }
        if (Array.isArray(e.repos)) {
          const cleaned = e.repos
            .filter((r: any) => typeof r === 'string' && r.trim().length > 0)
            .map((r: string) => r.trim());
          if (cleaned.length > 0) entry.repos = cleaned;
        }
        if (typeof e.ref === 'string' && e.ref.length > 0) entry.ref = e.ref;
        if (Array.isArray(e.tags)) {
          const tags = e.tags.filter((t: any) => typeof t === 'string' && t.length > 0);
          if (tags.length > 0) entry.tags = tags;
        }
        return entry;
      });
  } catch {
    return [];
  }
}

export function loadRemoteSkillsFromBosConfig(): RemoteSkillEntry[] {
  try {
    const { ConfigLoader } = require('@open1s/jsbos');
    const loader = new ConfigLoader();
    loader.discover();
    const configJson = loader.loadSync();
    return parseRemoteSkillsFromConfigJson(configJson);
  } catch {
    return [];
  }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function getCacheDir(workspaceRoot: string, name: string, repoIndex: number = -1): string {
  // Single-repo entries (or unknown index) cache at `<name>` for backward
  // compatibility with previously cloned folders. Multi-repo entries (>=2
  // effective repos) split into `<name>/repo-0`, `<name>/repo-1`, ...
  const base = path.join(workspaceRoot, '.bos', 'skills-remote', name);
  if (repoIndex < 0) return base;
  return path.join(base, `repo-${repoIndex}`);
}

function parseFrontmatterDescription(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return '';
  const fm = fmMatch[1] || '';
  const descMatch = fm.match(/^description:\s*["']?([^"'\n]+)["']?/m);
  return (descMatch?.[1] || '').trim();
}

function scoreEntry(entry: RemoteSkillEntry, queryTokens: string[]): number {
  let score = 0;
  const name = entry.name.toLowerCase();
  const desc = entry.description.toLowerCase();
  const tags = (entry.tags || []).map(t => t.toLowerCase());
  for (const q of queryTokens) {
    if (name === q) score += 10;
    else if (name.includes(q)) score += 5;
    if (desc.includes(q)) score += 2;
    for (const t of tags) {
      if (t === q) score += 4;
      else if (t.includes(q)) score += 1;
    }
  }
  return score;
}

export async function searchRemoteSkills(
  query: string,
  entries: RemoteSkillEntry[],
  limit: number = 5,
): Promise<RemoteSkillSearchHit[]> {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
  if (tokens.length === 0) return [];

  const hits: RemoteSkillSearchHit[] = [];
  for (const entry of entries) {
    const s = scoreEntry(entry, tokens);
    if (s > 0) {
      hits.push({
        name: entry.name,
        description: entry.description,
        repo: entry.repo,
        ...(entry.ref !== undefined ? { ref: entry.ref } : {}),
        ...(entry.tags !== undefined ? { tags: entry.tags } : {}),
        score: s,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function spawnCapture(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number = 30000,
): Promise<{ok: boolean; stdout: string; stderr: string}> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ok, stdout, stderr});
    };
    let proc;
    try {
      proc = spawn(cmd, args, {cwd, shell: false});
    } catch (e: any) {
      resolve({ok: false, stdout: '', stderr: e.message || String(e)});
      return;
    }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      finish(false);
    }, timeoutMs);
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
    proc.on('error', (e: any) => {
      clearTimeout(timer);
      finish(false);
      stderr += e.message || String(e);
    });
    proc.on('exit', code => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

const cloneLocks = new Map<string, Promise<unknown>>();

async function withCloneLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = cloneLocks.get(name);
  let next: Promise<unknown>;
  if (prev) {
    next = prev.then(fn, fn);
  } else {
    next = fn();
  }
  cloneLocks.set(name, next);
  try {
    return (await next) as T;
  } finally {
    if (cloneLocks.get(name) === next) cloneLocks.delete(name);
  }
}

function listSubdirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);
  } catch {
    return [];
  }
}

// ──────────────────────────────────────
// Clone + Scan
// ──────────────────────────────────────

async function ensureCloned(
  workspaceRoot: string,
  name: string,
  repo: string,
  ref?: string,
): Promise<{cacheDir: string; error?: string}> {
  const cacheDir = getCacheDir(workspaceRoot, name);
  if (fs.existsSync(cacheDir)) return {cacheDir};
  return withCloneLock(name, async () => {
    if (fs.existsSync(cacheDir)) return {cacheDir};
    try {
      ensureDir(path.dirname(cacheDir));
      const args = ['clone', '--depth', '1'];
      if (ref) args.push('--branch', ref);
      args.push(repo, cacheDir);
      const r = await spawnCapture('git', args, path.dirname(cacheDir), 60000);
      if (!r.ok) {
        const msg = (r.stderr || r.stdout || 'git clone failed').trim();
        return {cacheDir, error: `clone failed: ${msg.slice(0, 500)}`};
      }
      return {cacheDir};
    } catch (e: any) {
      return {cacheDir, error: `clone error: ${e.message || String(e)}`};
    }
  });
}

/** Walk cached repo for all SKILL.md files, return entries with full names */
function scanForSkillFiles(
  cacheDir: string,
  parentName: string,
  parentEntry: RemoteSkillEntry,
): RemoteSkillEntry[] {
  const results: RemoteSkillEntry[] = [];
  const visited = new Set<string>();

  function walk(dir: string, depth: number) {
    if (depth > MAX_SCAN_DEPTH) return;
    const real = path.resolve(dir);
    if (visited.has(real)) return;
    visited.add(real);

    const skillPath = path.join(dir, SKILL_FILE);
    if (fs.existsSync(skillPath)) {
      try {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const desc = parseFrontmatterDescription(content);
        const rel = path.relative(cacheDir, dir);
        const name = rel ? `${parentName}/${rel}` : parentName;
        const entry: RemoteSkillEntry = {
          name,
          description: desc || rel || parentName,
          repo: parentEntry.repo,
        };
        if (parentEntry.ref) entry.ref = parentEntry.ref;
        if (parentEntry.tags) entry.tags = [...parentEntry.tags];
        results.push(entry);
      } catch { /* skip unreadable */ }
      // Don't return — there may be deeper SKILL.md files too
    }

    let dirEntries: fs.Dirent[];
    try { dirEntries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of dirEntries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
    }
  }

  walk(cacheDir, 0);
  return results;
}

/**
 * Clone all registry repos and scan for SKILL.md files.
 * Returns a flat list of all discovered skills (parent/subpath names).
 * Already-cached repos are not re-cloned.
 */
export async function buildRemoteSkillIndex(
  workspaceRoot: string,
  registryEntries: RemoteSkillEntry[],
): Promise<RemoteSkillEntry[]> {
  const all: RemoteSkillEntry[] = [];
  const seen = new Set<string>();
  for (const entry of registryEntries) {
    if (entry.name.includes('/')) {
      // Pre-configured sub-skill entry — include as-is
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      all.push(entry);
    } else {
      // Repo root — ensure cloned, then scan
      const { cacheDir, error } = await ensureCloned(workspaceRoot, entry.name, entry.repo, entry.ref);
      if (error || !cacheDir) {
        console.warn(`[remote-skills] clone failed for ${entry.name}: ${error}`);
        continue;
      }
      const discovered = scanForSkillFiles(cacheDir, entry.name, entry);
      for (const d of discovered) {
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        all.push(d);
      }
    }
  }
  return all;
}

// ──────────────────────────────────────
// Load
// ──────────────────────────────────────

export async function loadRemoteSkill(
  workspaceRoot: string,
  name: string,
  registryEntries: RemoteSkillEntry[],
): Promise<LoadResult> {
  if (!name || name.length > 512) {
    return {ok: false, error: `invalid skill address: ${name}`};
  }
  const segs = name.split('/');
  for (const seg of segs) {
    if (!seg || seg === '.' || seg === '..' || !VALID_SEG.test(seg)) {
      return {ok: false, error: `invalid skill address: ${name}`};
    }
  }

  // Look up parent entry (first segment) in the ORIGINAL registry
  const parentName = segs[0]!;
  const subpath = segs.length > 1 ? segs.slice(1).join('/') : null;
  const parentEntry = registryEntries.find(e => e.name === parentName);
  if (!parentEntry) {
    return {ok: false, error: `parent repo not found in registry: ${parentName}`};
  }

  // Clone
  const { cacheDir, error } = await ensureCloned(workspaceRoot, parentName, parentEntry.repo, parentEntry.ref);
  if (error) return {ok: false, error, cacheDir};

  // Read target file
  const targetDir = subpath ? path.join(cacheDir, subpath) : cacheDir;
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return {ok: false, error: `path not found: ${name}`, cacheDir};
  }

  for (const file of [SKILL_FILE, README_FILE]) {
    const fp = path.join(targetDir, file);
    if (fs.existsSync(fp)) {
      try {
        return {ok: true, content: fs.readFileSync(fp, 'utf-8'), cacheDir};
      } catch (e: any) {
        return {ok: false, error: `read ${file} failed: ${e.message}`, cacheDir};
      }
    }
  }

  const subdirs = listSubdirs(targetDir);
  if (subdirs.length > 0) {
    return {
      ok: false,
      error: `no SKILL.md or README.md at ${name}. Subdirs: ${subdirs.slice(0, 20).join(', ')}`,
      cacheDir,
      subdirs: subdirs.slice(0, 20),
    };
  }
  return {ok: false, error: `no SKILL.md or README.md at ${name}`, cacheDir};
}

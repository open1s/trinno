import * as fs from 'fs';
import * as path from 'path';

export interface MemoryEntry {
  id: string;
  type: 'fact' | 'decision' | 'preference' | 'insight' | 'summary';
  content: string;
  tags: string[];
  timestamp: number;
  source: string;
  sessionId?: string;
  sessionTitle?: string;
  accessCount: number;
  lastAccess: number;
}

export interface MemoryStore {
  version: number;
  entries: MemoryEntry[];
}

const STORE_VERSION = 1;
const MAX_ENTRIES = 500;
const DEDUP_WINDOW_MS = 3600_000;
const PRUNE_AGE_MS = 120 * 24 * 3600_000;
const SUMMARY_PER_SESSION_MAX = 5;

function getMemoryStorePath(baseDir: string): string {
  return path.join(baseDir, '.bos', 'memory', 'memory-store.json');
}

function ensureMemoryDir(baseDir: string): void {
  fs.mkdirSync(path.join(baseDir, '.bos', 'memory'), { recursive: true });
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function loadMemoryStore(baseDir: string): MemoryStore {
  const filePath = getMemoryStorePath(baseDir);
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
      return parsed as MemoryStore;
    }
    console.warn('[memory] invalid store format, resetting');
    return { version: STORE_VERSION, entries: [] };
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn('[memory] load error:', err?.message);
    }
    return { version: STORE_VERSION, entries: [] };
  }
}

export function saveMemoryStore(baseDir: string, store: MemoryStore): void {
  ensureMemoryDir(baseDir);
  const filePath = getMemoryStorePath(baseDir);
  const tmpPath = filePath + '.tmp';
  const data = JSON.stringify(store, null, 2);
  fs.writeFileSync(tmpPath, data, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function pruneStore(store: MemoryStore): void {
  const now = Date.now();

  // 1. Remove entries older than PRUNE_AGE_MS if over 300 entries
  if (store.entries.length > 300) {
    store.entries = store.entries.filter(e => now - e.timestamp < PRUNE_AGE_MS);
  }

  // 2. Per-session: keep at most SUMMARY_PER_SESSION_MAX summaries
  const groupBySession = new Map<string, MemoryEntry[]>();
  for (const e of store.entries) {
    if (e.type === 'summary' && e.sessionId) {
      const g = groupBySession.get(e.sessionId) || [];
      g.push(e);
      groupBySession.set(e.sessionId, g);
    }
  }
  for (const [, group] of groupBySession) {
    if (group.length > SUMMARY_PER_SESSION_MAX) {
      group.sort((a, b) => b.timestamp - a.timestamp);
      const toRemove = new Set(group.slice(SUMMARY_PER_SESSION_MAX).map(e => e.id));
      store.entries = store.entries.filter(e => !toRemove.has(e.id));
    }
  }

  // 3. Hard cap at MAX_ENTRIES
  if (store.entries.length > MAX_ENTRIES) {
    store.entries.sort((a, b) => {
      const aScore = (b.accessCount || 0) - (a.accessCount || 0);
      if (aScore !== 0) return aScore;
      return b.timestamp - a.timestamp;
    });
    store.entries = store.entries.slice(0, MAX_ENTRIES);
  }
}

export function addMemory(
  baseDir: string,
  entry: Omit<MemoryEntry, 'id' | 'timestamp' | 'accessCount' | 'lastAccess'>,
): MemoryEntry {
  const store = loadMemoryStore(baseDir);
  const now = Date.now();
  const normalized = normalize(entry.content);

  // Dedup: exact match within dedup window → update timestamp + access count
  const threshold = now - DEDUP_WINDOW_MS;
  const dup = store.entries.find(e =>
    e.timestamp > threshold &&
    e.type === entry.type &&
    normalize(e.content) === normalized,
  );
  if (dup) {
    dup.timestamp = now;
    dup.accessCount = (dup.accessCount || 0) + 1;
    dup.lastAccess = now;
    dup.tags = [...new Set([...dup.tags, ...(entry.tags || [])])];
    if (entry.sessionId) dup.sessionId = entry.sessionId;
    if (entry.sessionTitle) dup.sessionTitle = entry.sessionTitle;
    saveMemoryStore(baseDir, store);
    return dup;
  }

  const newEntry: MemoryEntry = {
    id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
    ...entry,
    timestamp: now,
    accessCount: 1,
    lastAccess: now,
  };
  store.entries.push(newEntry);
  pruneStore(store);
  saveMemoryStore(baseDir, store);
  return newEntry;
}

export function searchMemories(
  baseDir: string,
  query: string,
  options?: { limit?: number; type?: string },
): MemoryEntry[] {
  const store = loadMemoryStore(baseDir);
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const now = Date.now();
  const scored: { entry: MemoryEntry; score: number }[] = [];

  for (const e of store.entries) {
    if (options?.type && e.type !== options.type) continue;

    const text = normalize(e.content + ' ' + (e.tags || []).join(' '));
    const matches = terms.filter(t => text.includes(t)).length;
    if (matches === 0) continue;

    const termScore = matches / terms.length;
    const recency = Math.max(0, 1 - (now - e.timestamp) / (90 * 24 * 3600_000));
    const accessBonus = Math.min(1, (e.accessCount || 0) / 10) * 0.1;
    const typeWeight = e.type === 'fact' ? 1.2 : e.type === 'summary' ? 1.0 : 0.9;
    const score = termScore * 0.5 + recency * 0.3 + accessBonus + typeWeight * 0.1;

    scored.push({ entry: e, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options?.limit ?? 10).map(s => s.entry);
}

export function listMemories(
  baseDir: string,
  options?: { limit?: number; type?: string },
): MemoryEntry[] {
  const store = loadMemoryStore(baseDir);
  let entries = store.entries;
  if (options?.type) {
    entries = entries.filter(e => e.type === options.type);
  }
  entries.sort((a, b) => {
    const aScore = (a.accessCount || 0) - (b.accessCount || 0);
    if (aScore !== 0) return aScore;
    return b.timestamp - a.timestamp;
  });
  return entries.slice(0, options?.limit ?? 20);
}

export function getMemoryStorePathForDir(baseDir: string): string {
  return getMemoryStorePath(baseDir);
}

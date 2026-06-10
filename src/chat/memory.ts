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
}

export interface MemoryStore {
  version: number;
  entries: MemoryEntry[];
}

const STORE_VERSION = 1;

function getMemoryStorePath(baseDir: string): string {
  return path.join(baseDir, '.bos', 'memory', 'memory-store.json');
}

function ensureMemoryDir(baseDir: string): void {
  fs.mkdirSync(path.join(baseDir, '.bos', 'memory'), { recursive: true });
}

export function loadMemoryStore(baseDir: string): MemoryStore {
  const filePath = getMemoryStorePath(baseDir);
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as MemoryStore;
  } catch {
    return { version: STORE_VERSION, entries: [] };
  }
}

export function saveMemoryStore(baseDir: string, store: MemoryStore): void {
  ensureMemoryDir(baseDir);
  const filePath = getMemoryStorePath(baseDir);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

export function addMemory(
  baseDir: string,
  entry: Omit<MemoryEntry, 'id' | 'timestamp'>,
): MemoryEntry {
  const store = loadMemoryStore(baseDir);
  const newEntry: MemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...entry,
    timestamp: Date.now(),
  };
  store.entries.push(newEntry);
  if (store.entries.length > 500) {
    store.entries = store.entries.slice(-500);
  }
  saveMemoryStore(baseDir, store);
  return newEntry;
}

export function searchMemories(
  baseDir: string,
  query: string,
  options?: { limit?: number; type?: string },
): MemoryEntry[] {
  const store = loadMemoryStore(baseDir);
  const q = query.toLowerCase();
  let results = store.entries.filter(e => {
    if (options?.type && e.type !== options.type) return false;
    return (
      e.content.toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q))
    );
  });
  results.sort((a, b) => b.timestamp - a.timestamp);
  return results.slice(0, options?.limit ?? 10);
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
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries.slice(0, options?.limit ?? 20);
}

export function getMemoryStorePathForDir(baseDir: string): string {
  return getMemoryStorePath(baseDir);
}

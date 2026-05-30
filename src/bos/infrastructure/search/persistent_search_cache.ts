import * as fs from 'fs';
import * as path from 'path';
import { SearchResult } from '../../domain/solution/search_port.js';
import { CachedSearchResult, SearchCache } from './cached_search.js';

interface PersistedShape {
  version: 1;
  entries: CachedSearchResult[];
}

export interface PersistentSearchCacheOptions {
  cacheFilePath: string;
  defaultTtlMs?: number;
  flushIntervalMs?: number;
}

const FLUSH_INTERVAL_MS = 5000;
const MAX_ENTRIES_DEFAULT = 5000;

export class PersistentSearchCache extends SearchCache {
  private cacheFilePath: string;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private flushIntervalMs: number;
  private maxEntries: number;

  constructor(opts: PersistentSearchCacheOptions) {
    super();
    this.cacheFilePath = opts.cacheFilePath;
    this.flushIntervalMs = opts.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.maxEntries = MAX_ENTRIES_DEFAULT;
    if (opts.defaultTtlMs) {
      (this as any).defaultTtlMs = opts.defaultTtlMs;
    }
    this.load();
  }

  get filePath(): string {
    return this.cacheFilePath;
  }

  set(query: string, results: SearchResult[], ttlMs?: number): void {
    super.set(query, results, ttlMs);
    this.enforceMaxEntries();
    this.scheduleFlush();
  }

  clear(): void {
    super.clear();
    this.scheduleFlush();
  }

  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private load(): void {
    if (!fs.existsSync(this.cacheFilePath)) return;
    try {
      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedShape;
      if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return;
      const now = Date.now();
      for (const entry of parsed.entries) {
        if (now - entry.timestamp <= entry.ttlMs) {
          super.set(entry.query, entry.results, entry.ttlMs);
        }
      }
      this.enforceMaxEntries();
    } catch {
      try {
        fs.renameSync(this.cacheFilePath, `${this.cacheFilePath}.corrupt-${Date.now()}`);
      } catch {
      }
    }
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushIntervalMs);
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload: PersistedShape = {
        version: 1,
        entries: this.getAll(),
      };
      const tmpPath = `${this.cacheFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf-8');
      fs.renameSync(tmpPath, this.cacheFilePath);
    } catch {
      this.dirty = true;
    }
  }

  private enforceMaxEntries(): void {
    if (this.size <= this.maxEntries) return;
    const all = this.getAll();
    all.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = this.size - this.maxEntries;
    for (let i = 0; i < toRemove; i++) {
      const stale = all[i];
      if (stale) {
        (this as any).cache.delete(stale.query);
      }
    }
  }
}

export function defaultSearchCachePath(workspaceRoot?: string): string {
  if (workspaceRoot) {
    return path.join(workspaceRoot, '.bos', 'search-cache.json');
  }
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return path.join(home, '.bos', 'search-cache.json');
}

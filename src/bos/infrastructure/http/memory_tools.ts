import { defineTool } from '@open1s/ezbos';
import { addMemory, searchMemories, listMemories, loadMemoryStore, saveMemoryStore } from '../../../chat/memory.js';

const MEMORY_TYPES = ['fact', 'decision', 'preference', 'insight', 'summary'] as const;

export function createMemoryTools(memoryDir: string) {
  const storeMemory = defineTool(
    'memory_store',
    'Store important knowledge to long-term memory. Facts persist across sessions. Use for: key decisions, user preferences, research findings, reusable insights. Avoid trivial or single-use info.',
  )
    .required('content', 'string', 'The memory (1-3 sentences, specific and concise)')
    .required('type', 'string', 'Type: fact=objective truth, decision=choice made, preference=user tendency, insight=analysis finding, summary=conversation digest')
    .param('tags', 'string', 'Comma-separated tags for retrieval (e.g., "rollup,zk,proof")')
    .handle((args: any) => {
      const content = String(args.content).trim();
      const type = String(args.type);
      if (content.length < 10) {
        return { ok: false, error: 'Content too short (min 10 chars). Be specific.' };
      }
      if (!(MEMORY_TYPES as readonly string[]).includes(type)) {
        return { ok: false, error: `Invalid type: ${type}. One of: ${MEMORY_TYPES.join(', ')}` };
      }
      if (content.length > 2000) {
        return { ok: false, error: 'Content too long (max 2000 chars). Be concise.' };
      }
      const entry = addMemory(memoryDir, {
        type: type as any,
        content,
        tags: String(args.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
        source: 'LLM',
      });
      return { ok: true, data: { id: entry.id, message: 'Memory stored', dedup: entry.timestamp !== Date.now() } };
    });

  const searchMemory = defineTool(
    'memory_search',
    'Search stored memories by keywords. Returns most relevant results first (sorted by: term match > recency > access frequency).',
  )
    .required('query', 'string', 'Search keywords (space-separated)')
    .param('limit', 'number', 'Max results (default 10, max 30)')
    .param('type', 'string', 'Filter: fact, decision, preference, insight, summary')
    .handle((args: any) => {
      const searchOpts: { limit?: number; type?: string } = {};
      searchOpts.limit = Math.min(Number(args.limit) || 10, 30);
      if (args.type) searchOpts.type = String(args.type);
      const results = searchMemories(memoryDir, String(args.query), searchOpts);
      return { ok: true, data: { count: results.length, memories: results } };
    });

  const listMemory = defineTool(
    'memory_list',
    'List memories sorted by access count + recency. Optionally filter by type.',
  )
    .param('type', 'string', 'Filter: fact, decision, preference, insight, summary')
    .param('limit', 'number', 'Max results (default 20)')
    .handle((args: any) => {
      const listOpts: { limit?: number; type?: string } = {};
      listOpts.limit = Number(args.limit) || 20;
      if (args.type) listOpts.type = String(args.type);
      const results = listMemories(memoryDir, listOpts);
      return { ok: true, data: { count: results.length, memories: results } };
    });

  const clearMemory = defineTool(
    'memory_clear',
    'Clear memories. Specify type to clear only that type, or omit type to clear all.',
  )
    .param('type', 'string', 'Type to clear. Omit to clear ALL memories.')
    .handle((args: any) => {
      const store = loadMemoryStore(memoryDir);
      const type = args.type as string | undefined;
      const before = store.entries.length;
      if (type && (MEMORY_TYPES as readonly string[]).includes(type as any)) {
        store.entries = store.entries.filter(e => e.type !== type);
      } else if (!type) {
        store.entries = [];
      } else {
        return { ok: false, error: `Invalid type: ${type}. Omit type to clear all.` };
      }
      saveMemoryStore(memoryDir, store);
      return { ok: true, data: { removed: before - store.entries.length, remaining: store.entries.length } };
    });

  const memoryStats = defineTool(
    'memory_stats',
    'Show memory store statistics: count by type, oldest/newest, total entries.',
  )
    .handle((args: any) => {
      const store = loadMemoryStore(memoryDir);
      const byType: Record<string, number> = {};
      for (const e of store.entries) {
        byType[e.type] = (byType[e.type] || 0) + 1;
      }
      const timestamps = store.entries.map(e => e.timestamp).sort();
      const oldestTs = timestamps[0];
      const newestTs = timestamps[timestamps.length - 1];
      const oldest = oldestTs ? new Date(oldestTs).toISOString() : null;
      const newest = newestTs ? new Date(newestTs).toISOString() : null;
    });

  return [storeMemory, searchMemory, listMemory, clearMemory, memoryStats];
}

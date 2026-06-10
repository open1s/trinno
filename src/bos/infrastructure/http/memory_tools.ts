import { defineTool } from '@open1s/ezbos';
import { addMemory, searchMemories, listMemories, loadMemoryStore, saveMemoryStore } from '../../../chat/memory';

const MEMORY_TYPES = ['fact', 'decision', 'preference', 'insight', 'summary'] as const;

export function createMemoryTools(memoryDir: string) {
  const storeMemory = defineTool(
    'memory_store',
    'Store an important fact, decision, preference, or insight to long-term memory. '
    + 'Use sparingly — only for reusable knowledge that should persist across sessions.',
  )
    .required('content', 'string', 'The memory content (1-3 sentences, concise)')
    .required('type', 'string', 'Type: fact, decision, preference, insight, summary')
    .param('tags', 'string', 'Comma-separated tags (e.g., "rollup,zk,compression")')
    .handle((args: any) => {
      const type = String(args.type);
      if (!(MEMORY_TYPES as readonly string[]).includes(type)) {
        return { ok: false, error: `Invalid type: ${type}. Must be one of: ${MEMORY_TYPES.join(', ')}` };
      }
      const entry = addMemory(memoryDir, {
        type: type as any,
        content: String(args.content),
        tags: String(args.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
        source: 'LLM',
      });
      return { ok: true, data: { id: entry.id, message: 'Memory stored' } };
    });

  const searchMemory = defineTool(
    'memory_search',
    'Search stored memories by keyword. Returns entries sorted by recency.',
  )
    .required('query', 'string', 'Search keyword')
    .param('limit', 'number', 'Max results (default 10, max 30)')
    .param('type', 'string', 'Filter by type: fact, decision, preference, insight, summary')
    .handle((args: any) => {
      const searchOpts: { limit?: number; type?: string } = {};
      searchOpts.limit = Math.min(Number(args.limit) || 10, 30);
      if (args.type) searchOpts.type = String(args.type);
      const results = searchMemories(memoryDir, String(args.query), searchOpts);
      return { ok: true, data: { count: results.length, memories: results } };
    });

  const listMemory = defineTool(
    'memory_list',
    'List stored memories, optionally filtered by type.',
  )
    .param('type', 'string', 'Filter by type: fact, decision, preference, insight, summary')
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
    'Clear all memories of a specific type, or all memories if no type specified.',
  )
    .param('type', 'string', 'Type to clear: fact, decision, preference, insight, summary. If omitted, clears all.')
    .handle((args: any) => {
      const store = loadMemoryStore(memoryDir);
      const type = args.type as string | undefined;
      const before = store.entries.length;
      if (type && (MEMORY_TYPES as readonly string[]).includes(type as any)) {
        store.entries = store.entries.filter(e => e.type !== type);
      } else if (!type) {
        store.entries = [];
      }
      saveMemoryStore(memoryDir, store);
      const removed = before - store.entries.length;
      return { ok: true, data: { removed, remaining: store.entries.length } };
    });

  return [storeMemory, searchMemory, listMemory, clearMemory];
}

import { defineTool, ok, err } from '@open1s/ezbos';
import { z } from 'zod';
import { addMemory, searchMemories, listMemories, loadMemoryStore, saveMemoryStore } from '../../../chat/memory.js';

const MEMORY_TYPES = ['fact', 'decision', 'preference', 'insight', 'summary'] as const;

const memoryType = (description: string) => z.enum(MEMORY_TYPES).describe(description);

export function createMemoryTools(memoryDir: string) {
  const storeMemory = defineTool({
    name: 'memory_store',
    description:
      'Store important knowledge to long-term memory. Facts persist across sessions. Use for: key decisions, user preferences, research findings, reusable insights. Avoid trivial or single-use info.',
    parameters: z.object({
      content: z.string().describe('The memory (1-3 sentences, specific and concise)'),
      type: memoryType(
        'Type: fact=objective truth, decision=choice made, preference=user tendency, insight=analysis finding, summary=conversation digest',
      ),
      tags: z.string().optional().describe('Comma-separated tags for retrieval (e.g., "rollup,zk,proof")'),
    }),
    execute: ({ content: raw, type, tags }) => {
      const content = raw.trim();
      if (content.length < 10) {
        return err('Content too short (min 10 chars). Be specific.');
      }
      if (content.length > 2000) {
        return err('Content too long (max 2000 chars). Be concise.');
      }
      const entry = addMemory(memoryDir, {
        type,
        content,
        tags: String(tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
        source: 'LLM',
      });
      return { ok: true, data: { id: entry.id, message: 'Memory stored', dedup: entry.timestamp !== Date.now() } };
    },
  });

  const searchMemory = defineTool({
    name: 'memory_search',
    description:
      'Search stored memories by keywords. Returns most relevant results first (sorted by: term match > recency > access frequency).',
    parameters: z.object({
      query: z.string().describe('Search keywords (space-separated)'),
      limit: z.number().optional().describe('Max results (default 10, max 30)'),
      type: memoryType('Filter: fact, decision, preference, insight, summary').optional(),
    }),
    execute: ({ query, limit, type }) => {
      const searchOpts: { limit?: number; type?: string } = {};
      searchOpts.limit = Math.min(Number(limit) || 10, 30);
      if (type) searchOpts.type = type;
      const results = searchMemories(memoryDir, query, searchOpts);
      return { ok: true, data: { count: results.length, memories: results } };
    },
  });

  const listMemory = defineTool({
    name: 'memory_list',
    description: 'List memories sorted by access count + recency. Optionally filter by type.',
    parameters: z.object({
      type: memoryType('Filter: fact, decision, preference, insight, summary').optional(),
      limit: z.number().optional().describe('Max results (default 20)'),
    }),
    execute: ({ type, limit }) => {
      const listOpts: { limit?: number; type?: string } = {};
      listOpts.limit = Number(limit) || 20;
      if (type) listOpts.type = type;
      const results = listMemories(memoryDir, listOpts);
      return { ok: true, data: { count: results.length, memories: results } };
    },
  });

  const clearMemory = defineTool({
    name: 'memory_clear',
    description: 'Clear memories. Specify type to clear only that type, or omit type to clear all.',
    parameters: z.object({
      type: memoryType('Type to clear. Omit to clear ALL memories.').optional(),
    }),
    execute: ({ type }) => {
      const store = loadMemoryStore(memoryDir);
      const before = store.entries.length;
      if (type) {
        store.entries = store.entries.filter(e => e.type !== type);
      } else {
        store.entries = [];
      }
      saveMemoryStore(memoryDir, store);
      return { ok: true, data: { removed: before - store.entries.length, remaining: store.entries.length } };
    },
  });

  const memoryStats = defineTool({
    name: 'memory_stats',
    description: 'Show memory store statistics: count by type, oldest/newest, total entries.',
    parameters: z.object({}),
    execute: () => {
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
      return ok({ total: store.entries.length, byType, oldest, newest });
    },
  });

  return [storeMemory, searchMemory, listMemory, clearMemory, memoryStats];
}


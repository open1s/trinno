import { defineTool, ok, err } from '@open1s/ezbos';
import { z } from 'zod';
import { DuckDuckGoSearchService } from '../search/duckduckgo_search.js';

export function createWebsearchTools() {
  const ddg = new DuckDuckGoSearchService();

  // Typed zod form (ezbos 2.x): schema drives the model-facing JSON Schema
  // AND runtime argument validation.
  const websearch = defineTool({
    name: 'websearch',
    description:
      'Search the web for current information, news, or general topics when domain knowledge is uncertain. Returns title, URL, and snippet for each result. Importance-weight results before quoting. Use before triz_search when you are unsure; never fabricate data — if search is unavailable, say so and use domain knowledge with explicit "illustrative" labels.',
    parameters: z.object({
      query: z.string().describe('Search query'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Max results (1-10, default 5)'),
    }),
    execute: async ({ query, maxResults }) => {
      try {
        const capped = Math.min(Math.max(maxResults ?? 5, 1), 10);
        const results = await ddg.searchGeneral(query, capped);
        return ok({
          query,
          count: results.length,
          results: results.map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
          })),
        });
      } catch (e: any) {
        return err(e.message || String(e));
      }
    },
  });

  return [websearch];
}

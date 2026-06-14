import { defineTool, ok, err } from '@open1s/ezbos';
import { DuckDuckGoSearchService } from '../search/duckduckgo_search.js';

export function createWebsearchTools() {
  const ddg = new DuckDuckGoSearchService();

  const websearch = defineTool(
    'websearch',
    'Search the web for current information, news, or general topics when domain knowledge is uncertain. Returns title, URL, and snippet for each result. Importance-weight results before quoting. Use before triz_search when you are unsure; never fabricate data — if search is unavailable, say so and use domain knowledge with explicit "illustrative" labels.',
  )
    .required('query', 'string', 'Search query')
    .param('maxResults', 'number', 'Max results (1-10, default 5)')
    .handle(async (args) => {
      try {
        const maxResults = Math.min(Math.max(args.maxResults ?? 5, 1), 10);
        const results = await ddg.searchGeneral(args.query as string, maxResults);
        return ok({
          query: args.query,
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
    });

  return [websearch];
}

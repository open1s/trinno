import { SearchResult, SearchQuery, SearchService } from '../../domain/solution/search_port.js';
import { ReferenceSourceType } from '../../domain/solution/external_reference.js';

export class GooglePatentsSearchService implements SearchService {
  async search(_query: SearchQuery): Promise<SearchResult[]> {
    return [];
  }

  async searchPatents(query: string, maxResults = 5): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // Strategy 1: Google Patents internal JSON API (used by their React frontend)
    try {
      const apiUrl = `https://patents.google.com/patent/search?q=${encodeURIComponent(query)}&num=${maxResults}&f=json`;
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TRIZ-Research/1.0)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('json')) {
          const data: any = await response.json();
          const items = data.results || data.patents || data.clusters?.[0]?.result || [];

          if (items.length > 0) {
            for (const item of items) {
              if (results.length >= maxResults) break;
              const doc = item.patent || item.document || item;
              const title = doc.title || item.title || '';
              const id = doc.publication_number || doc.patent_number || doc.id || '';
              if (!title && !id) continue;

              results.push({
                title: title || `Patent ${id}`,
                url: id ? `https://patents.google.com/patent/${id}` : (doc.url || ''),
                snippet: doc.abstract || doc.snippet || '',
                sourceType: 'patent' as ReferenceSourceType,
                publishedDate: doc.publication_date || doc.filing_date || undefined,
                authors: doc.inventor
                  ? (Array.isArray(doc.inventor) ? doc.inventor : [doc.inventor]).map((i: any) => typeof i === 'string' ? i : i.name).filter(Boolean)
                  : doc.assignee ? (Array.isArray(doc.assignee) ? doc.assignee : [doc.assignee]).map((a: any) => typeof a === 'string' ? a : a.name).filter(Boolean)
                  : undefined,
              });
            }
            if (results.length > 0) return results;
          }
        }
      }
    } catch {
    }

    // Strategy 2: Google Patents search via patent result page
    try {
      const url = `https://patents.google.com/?q=${encodeURIComponent(query)}&num=${maxResults}&language=EN`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TRIZ-Research/1.0; +https://github.com/triz-tool)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const html = await response.text();

        // Check for embedded initial state JSON (Next.js/Nuxt SSR hydration)
        const scriptMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
          || html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/);
        if (scriptMatch) {
          try {
            const json = JSON.parse(scriptMatch[1]!);
            // Walk into the JSON to find results — Next.js places them in props.pageProps
            const walk = (obj: any, depth = 0): any[] => {
              if (depth > 6) return [];
              if (!obj || typeof obj !== 'object') return [];
              const found: any[] = [];
              if (Array.isArray(obj)) {
                for (const item of obj) {
                  if (item && typeof item === 'object') {
                    if ((item.patent_number || item.publication_number) && item.title) {
                      found.push(item);
                    } else {
                      found.push(...walk(item, depth + 1));
                    }
                  }
                }
              } else {
                const keys = Object.keys(obj);
                for (const k of keys) {
                  if (typeof obj[k] === 'object') {
                    found.push(...walk(obj[k], depth + 1));
                  }
                }
              }
              return found;
            };
            const patentItems = walk(json);
            const resultMap = new Map<string, SearchResult>();
            for (const item of patentItems) {
              if (resultMap.size >= maxResults) break;
              const title = item.title || item.invention_title || '';
              const id = item.patent_number || item.publication_number || '';
              const key = (title + id).slice(0, 60);
              if (!resultMap.has(key) && (title || id)) {
                resultMap.set(key, {
                  title: title || `Patent ${id}`,
                  url: id ? `https://patents.google.com/patent/${id}` : '',
                  snippet: item.abstract || item.snippet || '',
                  sourceType: 'patent' as ReferenceSourceType,
                  publishedDate: item.publication_date || item.filing_date || item.grant_date || undefined,
                  authors: item.inventor
                    ? (Array.isArray(item.inventor) ? item.inventor : [item.inventor]).map((i: any) => typeof i === 'string' ? i : i.name).filter(Boolean)
                    : undefined,
                });
              }
            }
            results.push(...resultMap.values());
            if (results.length > 0) return results;
          } catch {
          }
        }

        // Strategy 3: regex scrape patent links from HTML
        const patentLinkMatches = html.matchAll(
          /<a[^>]*href="\/patent\/([A-Z]{2}\d+[A-Z]?\d*[A-Z]?\/[^"]*)"[^>]*>(.*?)<\/a>/gi,
        );

        const resultMap = new Map<string, SearchResult>();
        for (const match of patentLinkMatches) {
          if (resultMap.size >= maxResults) break;
          const patentId = match[1] ?? '';
          const title = this.stripHtml(match[2] || 'Unknown Patent');
          const key = title.slice(0, 50);
          if (!resultMap.has(key) && title.length > 5) {
            const date = this.extractDateFromPatentId(patentId);
            resultMap.set(key, {
              title,
              url: `https://patents.google.com/patent/${patentId}`,
              snippet: '',
              sourceType: 'patent' as ReferenceSourceType,
              ...(date !== undefined && { publishedDate: date }),
            });
          }
        }
        results.push(...resultMap.values());
      }
    } catch {
    }

    return results;
  }

  async searchPapers(_query: string, _maxResults = 5): Promise<SearchResult[]> {
    return [];
  }

  async searchTechSolutions(_query: string, _maxResults = 5): Promise<SearchResult[]> {
    return [];
  }

  private stripHtml(str: string): string {
    return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  }

  private extractDateFromPatentId(patentId: string): string | undefined {
    const yearMatch = patentId.match(/\/en\/(\d{4})/);
    if (yearMatch) return yearMatch[1];
    const usMatch = patentId.match(/US(\d{4})/);
    if (usMatch) return usMatch[1];
    return undefined;
  }
}
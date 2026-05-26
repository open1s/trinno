import { SearchResult, SearchQuery, SearchService } from '../../domain/solution/search_port.js';
import { ReferenceSourceType } from '../../domain/solution/external_reference.js';

export class GooglePatentsSearchService implements SearchService {
  async search(_query: SearchQuery): Promise<SearchResult[]> {
    return [];
  }

  async searchPatents(query: string, maxResults = 5): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // Try Google Patents SPA page (may not work — JS-rendered, no server-side data)
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

        // Check if page is SPA shell (no actual results rendered server-side)
        const hasResults = html.includes('result') || html.includes('patent-result') || (html.match(/\/patent\/[A-Z]{2}\d/gi) || []).length > 2;

        if (hasResults) {
          // Try multiple regex patterns for patent links
          const patentMatches = html.matchAll(
            /<a[^>]*href="\/patent\/([A-Z]{2}\d+[A-Z]?\d*[A-Z]?\/[^"]*)"[^>]*>(.*?)<\/a>/gi,
          );

          const resultMap = new Map<string, SearchResult>();
          for (const match of patentMatches) {
            if (resultMap.size >= maxResults) break;
            const patentId = match[1];
            const title = this.stripHtml(match[2] || 'Unknown Patent');
            const key = title.slice(0, 50);
            if (!resultMap.has(key) && title.length > 5) {
              resultMap.set(key, {
                title,
                url: `https://patents.google.com/patent/${patentId}`,
                snippet: '',
                sourceType: 'patent' as ReferenceSourceType,
                publishedDate: this.extractDateFromPatentId(patentId),
              });
            }
          }
          results.push(...resultMap.values());
        }
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
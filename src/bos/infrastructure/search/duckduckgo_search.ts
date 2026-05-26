import { SearchResult, SearchQuery, SearchService } from '../../domain/solution/search_port.js';
import { ReferenceSourceType } from '../../domain/solution/external_reference.js';

export class DuckDuckGoSearchService implements SearchService {
  async search(_query: SearchQuery): Promise<SearchResult[]> {
    return [];
  }

  async searchPatents(_query: string, _maxResults = 5): Promise<SearchResult[]> {
    return [];
  }

  async searchPapers(_query: string, _maxResults = 5): Promise<SearchResult[]> {
    return [];
  }

  async searchTechSolutions(query: string, maxResults = 5): Promise<SearchResult[]> {
    const techQuery = `${query} technical solution engineering implementation`;
    return this.webSearch(techQuery, maxResults, 'tech_solution');
  }

  async searchNews(query: string, maxResults = 5): Promise<SearchResult[]> {
    return this.webSearch(`${query} news`, maxResults, 'news');
  }

  async searchGeneral(query: string, maxResults = 5): Promise<SearchResult[]> {
    return this.webSearch(query, maxResults, 'tech_solution');
  }

  private async webSearch(query: string, maxResults: number, sourceType: ReferenceSourceType): Promise<SearchResult[]> {
    // Try DuckDuckGo JSON API first
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'TRIZ-Research/1.0 (+https://github.com/triz-tool)',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const data: any = await response.json();
        const results: SearchResult[] = [];

        if (data.AbstractText && data.AbstractText.length > 10) {
          results.push({
            title: data.Heading || 'Result',
            url: data.AbstractURL || data.AbstractSource || '',
            snippet: data.AbstractText.slice(0, 500),
            sourceType,
            publishedDate: undefined,
          });
        }

        if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
          for (const topic of data.RelatedTopics) {
            if (results.length >= maxResults) break;
            if (!topic.Text || topic.Text.length < 10) continue;
            results.push({
              title: topic.Text.split(' - ')[0]?.slice(0, 80) || topic.FirstURL?.slice(0, 80) || 'Related result',
              url: topic.FirstURL || '',
              snippet: topic.Text.slice(0, 500),
              sourceType,
              publishedDate: undefined,
            });
          }
        }
        if (results.length > 0) return results;
      }
    } catch {
    }

    // Fallback: DuckDuckGo HTML endpoint
    try {
      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(htmlUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TRIZ-Research/1.0)',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const html = await response.text();
        const results: SearchResult[] = [];

        const linkMatches = html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi);
        const snippetMatches = html.matchAll(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi);
        const links = [...linkMatches];
        const snippets = [...snippetMatches];

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
          const title = this.stripHtml(links[i]?.[2] || '');
          const url = links[i]?.[1] || '';
          const snippet = this.stripHtml(snippets[i]?.[1] || '');
          if (title && url) {
            results.push({ title, url, snippet, sourceType });
          }
        }

        return results;
      }
    } catch {
    }

    return [];
  }

  private stripHtml(str: string): string {
    return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
  }
}
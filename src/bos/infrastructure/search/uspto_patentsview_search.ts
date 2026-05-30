import { SearchResult, SearchQuery, SearchService } from '../../domain/solution/search_port.js';
import { ReferenceSourceType } from '../../domain/solution/external_reference.js';

/**
 * Free USPTO PatentsView API — no API key required.
 * Covers US patents.  Uses POST to query endpoint.
 * Docs: https://patentsview.org/apis/api-search-patent
 *
 * Fields we request: patent_title, patent_abstract, patent_date,
 *                    patent_number, inventor_first_name, inventor_last_name
 */
export class UsptoPatentsViewSearchService implements SearchService {
  private baseUrl = 'https://api.patentsview.org/patents/query';

  async search(_query: SearchQuery): Promise<SearchResult[]> {
    return [];
  }

  async searchPatents(query: string, maxResults = 5): Promise<SearchResult[]> {
    try {
      const q = JSON.stringify({
        q: { _text_any: { patent_title: query } },
        f: [
          'patent_title',
          'patent_abstract',
          'patent_date',
          'patent_number',
          'inventor_first_name',
          'inventor_last_name',
        ],
        o: { per_page: maxResults, page: 1 },
      });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: q,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) return [];

      const data: any = await response.json();
      const patents = data.patents || [];

      if (patents.length === 0) return [];

      return patents.map((p: any) => {
        const inventors: string[] = [];
        if (p.inventors && Array.isArray(p.inventors)) {
          for (const inv of p.inventors) {
            const name = [inv.inventor_first_name, inv.inventor_last_name]
              .filter(Boolean).join(' ');
            if (name) inventors.push(name);
          }
        }

        const result: SearchResult = {
          title: p.patent_title || 'Unknown Patent',
          url: `https://patents.google.com/patent/${p.patent_number}/en`,
          snippet: (p.patent_abstract || '').slice(0, 500),
          sourceType: 'patent' as ReferenceSourceType,
          publishedDate: p.patent_date,
        };
        if (inventors.length > 0) {
          result.authors = inventors;
        }
        return result;
      });
    } catch {
      return [];
    }
  }

  async searchPapers(_query: string, _maxResults = 5): Promise<SearchResult[]> {
    return [];
  }

  async searchTechSolutions(_query: string, _maxResults = 5): Promise<SearchResult[]> {
    return [];
  }
}
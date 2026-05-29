import { SearchResult, SearchQuery, SearchService } from '../../domain/solution/search_port.js';
import { ReferenceSourceType } from '../../domain/solution/external_reference.js';

export interface OpenAlexConfig {
  baseUrl?: string;
}

function reconstructAbstract(invertedIndex: Record<string, number[]> | null | undefined): string {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const wordPositions: Array<{ word: string; pos: number }> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    let posList: number[];
    if (Array.isArray(positions) && positions.length > 0 && typeof positions[0] === 'number') {
      posList = positions as number[];
    } else if (Array.isArray(positions)) {
      posList = positions.filter(p => typeof p === 'number') as number[];
    } else {
      continue;
    }
    for (const pos of posList) {
      wordPositions.push({ word, pos });
    }
  }
  wordPositions.sort((a, b) => a.pos - b.pos);
  return wordPositions.map(w => w.word).join(' ');
}

export class OpenAlexSearchService implements SearchService {
  private config: OpenAlexConfig;

  constructor(config: OpenAlexConfig = {}) {
    this.config = config;
  }

  async search(_query: SearchQuery): Promise<SearchResult[]> {
    return [];
  }

  async searchPatents(query: string, maxResults = 5): Promise<SearchResult[]> {
    const baseUrl = this.config.baseUrl || 'https://api.openalex.org';

    // OpenAlex has limited patent support. The `types` filter uses work-type
    // IDs; patent-type works exist but are rare.  Search broadly and let
    // the relevance scoring do the filtering — this gives better coverage
    // than filtering on a narrow type that may not match.
    try {
      const response = await fetch(
        `${baseUrl}/works?search=${encodeURIComponent(query)}&per_page=${maxResults}&select=title,doi,publication_date,authorships,primary_location,type`,
      );

      if (response.ok) {
        const data: any = await response.json();
        const works = data.results || [];

        return works.map((w: any) => ({
          title: w.title || 'Unknown',
          url: w.primary_location?.landing_page_url || w.doi || '',
          snippet: '',
          sourceType: 'patent' as ReferenceSourceType,
          publishedDate: w.publication_date || undefined,
          authors: w.authorships?.map((a: any) => a.author?.display_name).filter(Boolean) || undefined,
        }));
      }
    } catch {
    }

    return [];
  }

  async searchPapers(query: string, maxResults = 5): Promise<SearchResult[]> {
    const baseUrl = this.config.baseUrl || 'https://api.openalex.org';

    const response = await fetch(
      `${baseUrl}/works?search=${encodeURIComponent(query)}&per_page=${maxResults}&select=title,doi,abstract_inverted_index,publication_date,authorships,primary_location`,
    );

    if (!response.ok) return [];

    const data: any = await response.json();
    const works = data.results || [];

    return works.map((w: any) => ({
      title: w.title || 'Unknown Paper',
      url: w.primary_location?.landing_page_url || w.doi || '',
      snippet: reconstructAbstract(w.abstract_inverted_index),
      sourceType: 'paper' as ReferenceSourceType,
      publishedDate: w.publication_date || undefined,
      authors: w.authorships?.map((a: any) => a.author?.display_name).filter(Boolean) || undefined,
    }));
  }

  async searchTechSolutions(query: string, maxResults = 5): Promise<SearchResult[]> {
    const baseUrl = this.config.baseUrl || 'https://api.openalex.org';

    const response = await fetch(
      `${baseUrl}/works?search=${encodeURIComponent(query + ' engineering solution')}&per_page=${maxResults}&select=title,doi,abstract_inverted_index,publication_date,authorships,primary_location`,
    );

    if (!response.ok) return [];

    const data: any = await response.json();
    const works = data.results || [];

    return works.map((w: any) => ({
      title: w.title || '',
      url: w.primary_location?.landing_page_url || w.doi || '',
      snippet: reconstructAbstract(w.abstract_inverted_index),
      sourceType: 'tech_solution' as ReferenceSourceType,
      publishedDate: w.publication_date || undefined,
      authors: w.authorships?.map((a: any) => a.author?.display_name).filter(Boolean) || undefined,
    }));
  }
}
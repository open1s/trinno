import { SearchResult, SearchQuery, SearchService } from '../../domain/solution/search_port.js';
import { ReferenceSourceType } from '../../domain/solution/external_reference.js';
import { CrossRefSearchService } from './crossref_search.js';
import { OpenAlexSearchService } from './openalex_search.js';
import { GooglePatentsSearchService } from './google_patents_search.js';
import { UsptoPatentsViewSearchService } from './uspto_patentsview_search.js';
import { DuckDuckGoSearchService } from './duckduckgo_search.js';
import { createModuleLogger } from '../logging/logger.js';

const log = createModuleLogger('search');

export interface BraveSearchConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface SerperConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface SemanticScholarConfig {
  baseUrl?: string;
}

export interface MultiSourceSearchConfig {
  brave?: BraveSearchConfig;
  serper?: SerperConfig;
  semanticScholar?: SemanticScholarConfig;
  crossRef?: import('./crossref_search.js').CrossRefConfig;
  openAlex?: import('./openalex_search.js').OpenAlexConfig;
  defaultMaxResults?: number;
}

export class MultiSourceSearchService implements SearchService {
  private config: MultiSourceSearchConfig;
  private crossRefSearch: CrossRefSearchService;
  private openAlexSearch: OpenAlexSearchService;
  private googlePatentsSearch: GooglePatentsSearchService;
  private usptoPatentsViewSearch: UsptoPatentsViewSearchService;
  private duckduckgoSearch: DuckDuckGoSearchService;

  constructor(config: MultiSourceSearchConfig) {
    this.config = config;
    this.crossRefSearch = new CrossRefSearchService(config.crossRef);
    this.openAlexSearch = new OpenAlexSearchService(config.openAlex);
    this.googlePatentsSearch = new GooglePatentsSearchService();
    this.usptoPatentsViewSearch = new UsptoPatentsViewSearchService();
    this.duckduckgoSearch = new DuckDuckGoSearchService();
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const keywordStr = query.keywords.join(' ');
    const maxResults = query.maxResults || this.config.defaultMaxResults || 10;
    const results: SearchResult[] = [];

    if (query.sourceTypes.includes('patent') && this.config.serper) {
      const patents = await this.searchPatents(keywordStr, maxResults);
      results.push(...patents);
    }

    if (query.sourceTypes.includes('paper') && this.config.semanticScholar) {
      const papers = await this.searchPapers(keywordStr, maxResults);
      results.push(...papers);
    }

    if (query.sourceTypes.includes('tech_solution') && this.config.brave) {
      const tech = await this.searchTechSolutions(keywordStr, maxResults);
      results.push(...tech);
    }

    if (query.sourceTypes.includes('news') && this.config.brave) {
      const news = await this.searchNews(keywordStr, maxResults);
      results.push(...news);
    }

    if (query.sourceTypes.includes('blog') && this.config.brave) {
      const blogs = await this.searchBlogs(keywordStr, maxResults);
      results.push(...blogs);
    }

    results.sort((a, b) => (b.snippet.length + b.title.length) - (a.snippet.length + a.title.length));
    return results.slice(0, maxResults);
  }

  async searchPatents(query: string, maxResults = 5): Promise<SearchResult[]> {
    log.debug({ query, maxResults }, 'searchPatents');
    if (this.config.serper) {
      try {
        const response = await fetch(`${this.config.serper.baseUrl || 'https://google.serper.dev/patents'}`, {
          method: 'POST',
          headers: {
            'X-API-KEY': this.config.serper.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: query, num: maxResults }),
        });

        if (response.ok) {
          const data: any = await response.json();
          const patents = data.patents || data.organic || [];

          if (patents.length > 0) {
            log.debug({ count: patents.length, source: 'serper' }, 'patents found');
            return patents.slice(0, maxResults).map((p: any) => ({
              title: p.title || p.snippet?.split('\n')[0] || 'Unknown Patent',
              url: p.link || p.url || '',
              snippet: p.snippet || p.abstract || '',
              sourceType: 'patent' as ReferenceSourceType,
              publishedDate: p.date || p.publicationDate,
              authors: p.inventors ? [p.inventors].flat() : undefined,
            }));
          }
        }
      } catch (e) {
        log.warn({ err: e }, 'serper patent search failed');
      }
    }

    // Try free Google Patents
    log.debug('fallback: Google Patents');
    const googleResults = await this.googlePatentsSearch.searchPatents(query, maxResults);
    if (googleResults.length > 0) {
      log.debug({ count: googleResults.length, source: 'google-patents' }, 'patents found');
      return googleResults;
    }

    // Try USPTO PatentsView (free, covers US patents)
    try {
      log.debug('fallback: USPTO PatentsView');
      const usptoResults = await this.usptoPatentsViewSearch.searchPatents(query, maxResults);
      if (usptoResults.length > 0) {
        log.debug({ count: usptoResults.length, source: 'uspto' }, 'patents found');
        return usptoResults;
      }
    } catch (e) {
      log.warn({ err: e }, 'USPTO search failed');
    }

    // Last resort: OpenAlex API
    try {
      log.debug('fallback: OpenAlex patents');
      const openAlexResults = await this.openAlexSearch.searchPatents(query, maxResults);
      if (openAlexResults.length > 0) {
        log.debug({ count: openAlexResults.length, source: 'openalex' }, 'patents found');
        return openAlexResults;
      }
    } catch (e) {
      log.warn({ err: e }, 'OpenAlex patent search failed');
    }

    log.debug({ query }, 'no patents found from any source');
    return [];
  }

  async searchPapers(query: string, maxResults = 5): Promise<SearchResult[]> {
    log.debug({ query, maxResults }, 'searchPapers');
    const baseUrl = this.config.semanticScholar?.baseUrl || 'https://api.semanticscholar.org/graph/v1';

    const tryCrossRef = async () => {
      log.debug('fallback: CrossRef papers');
      return await this.crossRefSearch.searchPapers(query, maxResults);
    };

    try {
      const response = await fetch(
        `${baseUrl}/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=title,abstract,authors,year,externalIds,url`,
      );

      if (response.ok) {
        const data: any = await response.json();
        const papers = data.data || [];

        if (papers.length > 0) {
          const results = papers.map((p: any) => ({
            title: p.title || 'Unknown Paper',
            url: p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
            snippet: p.abstract || '',
            sourceType: 'paper' as ReferenceSourceType,
            publishedDate: p.year ? String(p.year) : undefined,
            authors: p.authors ? p.authors.map((a: any) => a.name) : undefined,
          }));

          // If >50% of results have empty snippets, merge with CrossRef for better abstracts
          const emptyCount = results.filter((r: SearchResult) => !r.snippet).length;
          if (emptyCount > results.length / 2) {
            log.debug({ total: results.length, emptySnippets: emptyCount }, 'merging with CrossRef abstracts');
            const crResults = await tryCrossRef();
            // Merge: use CrossRef snippet if SS has none, otherwise keep SS
            const crByTitle = new Map<string, string>();
            for (const cr of crResults) {
              crByTitle.set(cr.title.toLowerCase(), cr.snippet);
            }
            for (const r of results) {
              if (!r.snippet) {
                const crSnippet = crByTitle.get(r.title.toLowerCase());
                if (crSnippet) r.snippet = crSnippet;
              }
            }
          }

          log.debug({ count: results.length, source: 'semantic-scholar' }, 'papers found');
          return results;
        }
      }

      // Semantic Scholar returned empty, try CrossRef
      return await tryCrossRef();
    } catch (e) {
      log.warn({ err: e }, 'Semantic Scholar search failed, falling back to CrossRef');
      // Fallback to CrossRef on any error
      return await tryCrossRef();
    }
  }

  async searchTechSolutions(query: string, maxResults = 5): Promise<SearchResult[]> {
    log.debug({ query, maxResults }, 'searchTechSolutions');
    if (this.config.brave) {
      try {
        const response = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query + ' technical solution engineering')}&count=${maxResults}`,
          {
            headers: {
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip',
              'X-Subscription-Token': this.config.brave.apiKey,
            },
          },
        );

        if (response.ok) {
          const data: any = await response.json();
          const results = data.web?.results || [];

          if (results.length > 0) {
            log.debug({ count: results.length, source: 'brave' }, 'tech solutions found');
            return results.slice(0, maxResults).map((r: any) => ({
              title: r.title || '',
              url: r.url || '',
              snippet: r.description || '',
              sourceType: 'tech_solution' as ReferenceSourceType,
              publishedDate: r.page_age,
            }));
          }
        }
      } catch (e) {
        log.warn({ err: e }, 'Brave search failed');
      }
    }

    // Try free DuckDuckGo search
    log.debug('fallback: DuckDuckGo tech solutions');
    const ddgResults = await this.duckduckgoSearch.searchTechSolutions(query, maxResults);
    if (ddgResults.length > 0) {
      log.debug({ count: ddgResults.length, source: 'duckduckgo' }, 'tech solutions found');
      return ddgResults;
    }

    // Last resort: OpenAlex for relevant engineering papers
    try {
      log.debug('fallback: OpenAlex tech solutions');
      const openAlexResults = await this.openAlexSearch.searchTechSolutions(query, maxResults);
      if (openAlexResults.length > 0) {
        log.debug({ count: openAlexResults.length, source: 'openalex' }, 'tech solutions found');
        return openAlexResults;
      }
    } catch (e) {
      log.warn({ err: e }, 'OpenAlex tech solutions failed');
    }

    log.debug({ query }, 'no tech solutions found from any source');
    return [];
  }

  async searchNews(query: string, maxResults = 5): Promise<SearchResult[]> {
    if (!this.config.brave) return [];

    const response = await fetch(
      `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.config.brave.apiKey,
        },
      },
    );

    if (!response.ok) return [];

    const data: any = await response.json();
    const results = data.results || [];

    return results.slice(0, maxResults).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      sourceType: 'news' as ReferenceSourceType,
      publishedDate: r.page_age,
    }));
  }

  async searchBlogs(query: string, maxResults = 5): Promise<SearchResult[]> {
    if (!this.config.brave) return [];

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query + ' blog')}&count=${maxResults}`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.config.brave.apiKey,
        },
      },
    );

    if (!response.ok) return [];

    const data: any = await response.json();
    const results = data.web?.results || [];

    return results.slice(0, maxResults).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      sourceType: 'blog' as ReferenceSourceType,
      publishedDate: r.page_age,
    }));
  }
}

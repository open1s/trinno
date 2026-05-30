import type { PaperMeta, ParsedIdentifier } from './types';

const API = 'https://api.openalex.org';

export interface SearchHit {
  title: string;
  authors: string[];
  year: number | undefined;
  doi: string | undefined;
  arxivId: string | undefined;
  venue: string | undefined;
  pdfUrl: string | undefined;
  abstract: string | undefined;
  openalexId: string | undefined;
}


function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv || typeof inv !== 'object') return '';
  const positions: Array<{ word: string; pos: number }> = [];
  for (const [word, locs] of Object.entries(inv)) {
    if (!Array.isArray(locs)) continue;
    for (const p of locs) {
      if (typeof p === 'number') positions.push({ word, pos: p });
    }
  }
  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(' ');
}

function pickPdf(work: any): string | undefined {
  const candidates = [
    work?.best_oa_location?.pdf_url,
    work?.primary_location?.pdf_url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.toLowerCase().endsWith('.pdf')) return c;
  }
  return undefined;
}

function toHit(work: any): SearchHit {
  const title: string = work?.title || work?.display_name || 'Untitled';
  const authors = (work?.authorships || [])
    .map((a: any) => a?.author?.display_name)
    .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
  const year = typeof work?.publication_year === 'number' ? work.publication_year : undefined;
  const doi = typeof work?.doi === 'string' ? work.doi.replace(/^https?:\/\/doi\.org\//, '') : undefined;
  const arxivRaw: string | undefined = typeof work?.ids?.arxiv === 'string' ? work.ids.arxiv : undefined;
  const arxivId = arxivRaw ? arxivRaw.replace(/^https?:\/\/arxiv\.org\/abs\//, '') : undefined;
  const openalexRaw: string | undefined = typeof work?.ids?.openalex === 'string' ? work.ids.openalex : undefined;
  const venue = work?.primary_location?.source?.display_name || work?.host_venue?.display_name;
  const pdfUrl = pickPdf(work);
  const abstract = reconstructAbstract(work?.abstract_inverted_index);
  return {
    title,
    authors,
    year,
    doi,
    arxivId,
    venue,
    pdfUrl,
    abstract: abstract || undefined,
    openalexId: openalexRaw,
  };
}

export async function searchOpenAlex(query: string, limit = 3, signal?: AbortSignal): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const fields = [
    'title',
    'authorships',
    'publication_year',
    'doi',
    'ids',
    'primary_location',
    'best_oa_location',
    'host_venue',
    'abstract_inverted_index',
  ].join(',');

  const url = `${API}/works?search=${encodeURIComponent(trimmed)}&per_page=${Math.max(1, Math.min(10, limit))}&select=${fields}`;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno-research@example.com)' },
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const results: any[] = data?.results || [];
    return results.map(toHit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export function toPaperMeta(hit: SearchHit): PaperMeta {
  const meta: PaperMeta = { title: hit.title, authors: hit.authors };
  if (hit.year !== undefined) meta.year = hit.year;
  if (hit.doi) meta.doi = hit.doi;
  if (hit.arxivId) meta.arxivId = hit.arxivId;
  if (hit.venue) meta.venue = hit.venue;
  if (hit.abstract) meta.abstract = hit.abstract;
  return meta;
}

export function hitToIdentifier(hit: SearchHit): ParsedIdentifier | null {
  if (hit.doi) return { kind: 'doi', value: hit.doi, doi: hit.doi };
  if (hit.arxivId) return { kind: 'arxiv', value: hit.arxivId, arxivId: hit.arxivId };
  return null;
}

import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';

const BASE = 'https://api.openalex.org';

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
  return positions.map(p => p.word).join(' ');
}

function pickPdf(work: any): string | null {
  const candidates = [
    work?.best_oa_location?.pdf_url,
    work?.primary_location?.pdf_url,
    work?.primary_location?.source?.pdf_url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.toLowerCase().endsWith('.pdf')) return c;
  }
  return null;
}

function metaFromWork(work: any): PaperMeta {
  const title: string = work?.title || work?.display_name || 'Untitled';
  const authorships: any[] = work?.authorships || [];
  const authors = authorships
    .map((a: any) => a?.author?.display_name)
    .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);

  const year: number | undefined = typeof work?.publication_year === 'number' ? work.publication_year : undefined;

  const doi: string | undefined = typeof work?.doi === 'string' ? work.doi.replace(/^https?:\/\/doi\.org\//, '') : undefined;
  const ids = work?.ids ?? {};
  const arxivId: string | undefined = typeof ids?.arxiv === 'string' ? ids.arxiv.replace(/^https?:\/\/arxiv\.org\/abs\//, '') : undefined;
  const pmid: string | undefined = typeof ids?.pmid === 'string' ? ids.pmid.replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, '') : undefined;
  const venue: string | undefined = work?.primary_location?.source?.display_name || work?.host_venue?.display_name;

  const meta: PaperMeta = {
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(pmid ? { pmid } : {}),
    ...(venue ? { venue } : {}),
  };
  const abstract = reconstructAbstract(work?.abstract_inverted_index);
  if (abstract) meta.abstract = abstract;
  return meta;
}

async function fetchWork(id: ParsedIdentifier, signal: AbortSignal | undefined, timeoutMs: number): Promise<any | null> {
  let url: string | null = null;
  if (id.kind === 'doi' && id.doi) url = `${BASE}/works/doi:${encodeURIComponent(id.doi)}`;
  else if (id.kind === 'arxiv' && id.arxivId) url = `${BASE}/works/doi:${encodeURIComponent('10.48550/arXiv.' + id.arxivId)}`;
  else if (id.kind === 'pmid' && id.pmid) url = `${BASE}/works/pmid:${encodeURIComponent(id.pmid)}`;
  if (!url) return null;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno@example.com)' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export const openalexSource: PaperSource = {
  name: 'openalex',
  rank: 2,
  timeoutMs: 8000,
  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    const work = await fetchWork(id, signal, this.timeoutMs);
    if (!work) return null;
    const pdfUrl = pickPdf(work);
    if (!pdfUrl) return null;
    return { source: 'openalex', pdfUrl, meta: metaFromWork(work) };
  },
};

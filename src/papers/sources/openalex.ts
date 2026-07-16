import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

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
  const pdfCandidates = [
    work?.best_oa_location?.pdf_url,
    work?.primary_location?.pdf_url,
  ];
  for (const c of pdfCandidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  const oaUrl = work?.open_access?.oa_url;
  if (typeof oaUrl === 'string' && oaUrl.toLowerCase().endsWith('.pdf')) return oaUrl;
  const sourceUrl = work?.primary_location?.source?.pdf_url;
  if (typeof sourceUrl === 'string' && sourceUrl.length > 0) return sourceUrl;
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
  const venue: string | undefined = work?.primary_location?.source?.display_name;

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

  try {
    const res = await httpRequest({
      url,
      signal,
      timeoutMs,
      maxRetries: 0,
      headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno@example.com)' },
      accept: 'application/json',
    });
    if (res.status < 200 || res.status >= 300) return null;
    return JSON.parse(res.body.toString('utf-8'));
  } catch {
    return null;
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

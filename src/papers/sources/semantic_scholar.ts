import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';

const BASE = 'https://api.semanticscholar.org/graph/v1/paper';

function doiFromId(id: ParsedIdentifier): string | null {
  if (id.kind === 'doi' && id.doi) return id.doi;
  if (id.kind === 'arxiv' && id.arxivId) return `10.48550/arXiv.${id.arxivId}`;
  if (id.kind === 'pmid' && id.pmid) return id.pmid;
  return null;
}

function metaFromPaper(p: any): PaperMeta {
  const title: string = p?.title || 'Untitled';
  const authors: string[] = Array.isArray(p?.authors)
    ? p.authors.map((a: any) => a?.name).filter((n: unknown): n is string => typeof n === 'string' && n.length > 0)
    : [];
  const year: number | undefined = typeof p?.year === 'number' ? p.year : undefined;
  const ext: any = p?.externalIds ?? {};
  const doi: string | undefined = typeof ext.DOI === 'string' ? ext.DOI : undefined;
  const arxivId: string | undefined = typeof ext.ArXiv === 'string' ? ext.ArXiv : undefined;
  const pmid: string | undefined = typeof ext.PubMed === 'string' ? ext.PubMed : undefined;
  const venue: string | undefined = p?.venue;
  const meta: PaperMeta = {
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(pmid ? { pmid } : {}),
    ...(venue ? { venue } : {}),
  };
  if (typeof p?.abstract === 'string' && p.abstract.length > 0) meta.abstract = p.abstract;
  return meta;
}

export const semanticScholarSource: PaperSource = {
  name: 'semantic_scholar',
  rank: 3,
  timeoutMs: 8000,
  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    const doi = doiFromId(id);
    if (!doi) return null;

    const url = `${BASE}/DOI:${encodeURIComponent(doi)}?fields=title,authors,year,externalIds,venue,abstract,openAccessPdf`;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'trinno-research/1.0' } });
      if (!res.ok) return null;
      const data: any = await res.json();
      const pdfUrl: string | undefined = data?.openAccessPdf?.url;
      if (!pdfUrl) return null;
      return { source: 'semantic_scholar', pdfUrl, meta: metaFromPaper(data) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  },
};

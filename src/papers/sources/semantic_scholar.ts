import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

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
    try {
      const res = await httpRequest({
        url,
        signal,
        timeoutMs: this.timeoutMs,
        maxRetries: 0,
        headers: { 'User-Agent': 'trinno-research/1.0' },
        accept: 'application/json',
      });
      if (res.status < 200 || res.status >= 300) return null;
      const data: any = JSON.parse(res.body.toString('utf-8'));
      const pdfUrl: string | undefined = data?.openAccessPdf?.url;
      if (!pdfUrl) return null;
      return { source: 'semantic_scholar', pdfUrl, meta: metaFromPaper(data) };
    } catch {
      return null;
    }
  },
};

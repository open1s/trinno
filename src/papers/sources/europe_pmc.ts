import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

function buildQuery(id: ParsedIdentifier): string | null {
  if (id.kind === 'doi' && id.doi) return `DOI:"${id.doi}"`;
  if (id.kind === 'pmid' && id.pmid) return `EXT_ID:${id.pmid} AND SRC:MED`;
  if (id.kind === 'arxiv' && id.arxivId) return `ARXIV:${id.arxivId}`;
  return null;
}

function pickPdfUrl(hit: any): string | null {
  const list: any[] = hit?.fullTextUrlList?.fullTextUrl ?? [];
  for (const item of list) {
    const availability = String(item?.availability || '').toLowerCase();
    const url: string | undefined = item?.url;
    const documentStyle = String(item?.documentStyle || '').toLowerCase();
    if (url && (url.toLowerCase().endsWith('.pdf') || documentStyle.includes('pdf'))) {
      if (!availability || availability.includes('free') || availability.includes('open')) return url;
    }
  }
  for (const item of list) {
    const url: string | undefined = item?.url;
    if (url && url.toLowerCase().endsWith('.pdf')) return url;
  }
  return null;
}

function metaFromHit(hit: any): PaperMeta {
  const title: string = hit?.title || 'Untitled';
  const authorStr: string = hit?.authorString || hit?.firstAuthor || '';
  const authors = authorStr ? authorStr.split(/,\s*/).map((s: string) => s.trim()).filter(Boolean) : [];
  const year: number | undefined = hit?.pubYear ? parseInt(String(hit.pubYear), 10) : undefined;
  const doi: string | undefined = hit?.doi || (hit?.externalIds && typeof hit.externalIds === 'object' ? hit.externalIds.doi : undefined);
  const pmid: string | undefined = hit?.pmid ? String(hit.pmid) : undefined;
  const venue: string | undefined = hit?.journalTitle || hit?.bookTitle;
  const meta: PaperMeta = {
    title,
    authors,
    ...(year !== undefined && !Number.isNaN(year) ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(pmid ? { pmid } : {}),
    ...(venue ? { venue } : {}),
  };
  if (typeof hit?.abstractText === 'string' && hit.abstractText.length > 0) meta.abstract = hit.abstractText;
  return meta;
}

export const europePmcSource: PaperSource = {
  name: 'europe_pmc',
  rank: 4,
  timeoutMs: 8000,
  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    const query = buildQuery(id);
    if (!query) return null;

    const url = `${BASE}?query=${encodeURIComponent(query)}&format=json&resultType=core`;
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
      const hits: any[] = data?.response?.result ?? [];
      if (hits.length === 0) return null;
      for (const hit of hits) {
        const pdf = pickPdfUrl(hit);
        if (pdf) return { source: 'europe_pmc', pdfUrl: pdf, meta: metaFromHit(hit) };
      }
      return null;
    } catch {
      return null;
    }
  },
};

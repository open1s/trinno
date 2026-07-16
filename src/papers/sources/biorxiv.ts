import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

const BIORXIV_DOI_RE = /^10\.1101\//i;

function doiToBiorxivPdf(doi: string): string {
  return `https://www.biorxiv.org/content/${doi}.full.pdf`;
}

async function fetchMetadata(id: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<any | null> {
  const apiUrl = `https://api.biorxiv.org/details/biorxiv/${encodeURIComponent(id)}`;
  try {
    const res = await httpRequest({
      url: apiUrl,
      signal,
      timeoutMs,
      maxRetries: 0,
      headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno-research@example.com)' },
      accept: 'application/json',
    });
    if (res.status < 200 || res.status >= 300) return null;
    const data: any = JSON.parse(res.body.toString('utf-8'));
    const coll = Array.isArray(data?.collection) ? data.collection : [];
    return coll.length > 0 ? coll[0] : null;
  } catch {
    return null;
  }
}

function metaFromApi(record: any, doi: string): PaperMeta {
  const title: string = record?.title || doi;
  const authors: string[] = (record?.authors || '').split(';').map((s: string) => s.trim()).filter(Boolean);
  const date: string | undefined = record?.date;
  const year: number | undefined = date ? parseInt(date.slice(0, 4), 10) : undefined;
  const category: string | undefined = record?.category;
  return {
    title,
    authors,
    doi,
    ...(category ? { venue: `bioRxiv (${category})` } : { venue: 'bioRxiv' }),
    ...(year !== undefined && !Number.isNaN(year) ? { year } : {}),
  };
}

export class BiorxivSource implements PaperSource {
  readonly name = 'biorxiv';
  readonly rank = 2;
  readonly timeoutMs = 8000;

  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    if (id.kind !== 'doi' || !id.doi) return null;
    if (!BIORXIV_DOI_RE.test(id.doi)) return null;

    const record = await fetchMetadata(id.doi, signal, this.timeoutMs);
    if (!record) return null;

    return {
      source: 'biorxiv',
      pdfUrl: doiToBiorxivPdf(id.doi),
      meta: metaFromApi(record, id.doi),
    };
  }
}

export const biorxivSource: PaperSource = new BiorxivSource();

import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';

const BIORXIV_DOI_RE = /^10\.1101\//i;

function doiToBiorxivPdf(doi: string): string {
  return `https://www.biorxiv.org/content/${doi}.full.pdf`;
}

async function fetchMetadata(id: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<any | null> {
  const apiUrl = `https://api.biorxiv.org/details/biorxiv/${encodeURIComponent(id)}`;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno-research@example.com)' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const coll = Array.isArray(data?.collection) ? data.collection : [];
    return coll.length > 0 ? coll[0] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
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

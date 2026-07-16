import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

const API = 'https://api.crossref.org/works';

function metaFromResponse(m: any): PaperMeta {
  const title: string = Array.isArray(m?.title) && m.title.length > 0 ? m.title[0] : 'Untitled';
  const authors: string[] = Array.isArray(m?.author)
    ? m.author
        .map((a: any) => {
          if (!a) return '';
          if (a.family && a.given) return `${a.family}, ${a.given}`;
          if (a.family) return a.family;
          if (a.name) return a.name;
          return '';
        })
        .filter((s: string) => s.length > 0)
    : [];
  const issued: any = m?.issued?.['date-parts']?.[0];
  const year: number | undefined = Array.isArray(issued) ? issued[0] : undefined;
  const doi: string | undefined = m?.DOI;
  const venue: string | undefined =
    Array.isArray(m?.['container-title']) && m['container-title'].length > 0
      ? m['container-title'][0]
      : m?.publisher;
  const abstract: string | undefined = typeof m?.abstract === 'string' ? m.abstract.replace(/<[^>]+>/g, '') : undefined;
  const meta: PaperMeta = { title, authors, ...(doi ? { doi } : {}), ...(venue ? { venue } : {}) };
  if (year !== undefined && !Number.isNaN(year)) meta.year = year;
  if (abstract) meta.abstract = abstract;
  return meta;
}

function pickPdfUrl(links: any[]): string | null {
  for (const l of links) {
    if (!l) continue;
    const ct: string = (l['content-type'] || '').toLowerCase();
    const url: string = l.URL || '';
    if (ct.includes('application/pdf') || /\.pdf(\?|#|$)/i.test(url)) return url;
  }
  return null;
}

export class CrossrefSource implements PaperSource {
  readonly name = 'crossref';
  readonly rank = 4;
  readonly timeoutMs = 10000;

  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    if (id.kind !== 'doi' || !id.doi) return null;

    const url = `${API}/${encodeURIComponent(id.doi)}`;
    try {
      const res = await httpRequest({
        url,
        signal,
        timeoutMs: this.timeoutMs,
        maxRetries: 0,
        headers: {
          'User-Agent': 'trinno-research/1.0 (mailto:trinno-research@example.com)',
          'Accept': 'application/json',
        },
      });
      if (res.status < 200 || res.status >= 300) return null;
      const data: any = JSON.parse(res.body.toString('utf-8'));
      const m = data?.message;
      if (!m) return null;
      const links: any[] = Array.isArray(m.link) ? m.link : [];
      const pdfUrl = pickPdfUrl(links);
      if (!pdfUrl) return null;
      return {
        source: 'crossref',
        pdfUrl,
        meta: metaFromResponse(m),
      };
    } catch {
      return null;
    }
  }
}

export const crossrefSource: PaperSource = new CrossrefSource();

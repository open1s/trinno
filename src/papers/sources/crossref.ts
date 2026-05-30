import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';

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
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'trinno-research/1.0 (mailto:trinno-research@example.com)',
          'Accept': 'application/json',
        },
      });
      if (!res.ok) return null;
      const data: any = await res.json();
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
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}

export const crossrefSource: PaperSource = new CrossrefSource();

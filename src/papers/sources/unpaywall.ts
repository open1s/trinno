import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

const API = 'https://api.unpaywall.org/v2';

function pickPdfUrl(resp: any): string | null {
  const best = resp?.best_oa_location;
  if (best?.pdf_url) return best.pdf_url;
  const locs = resp?.oa_locations;
  if (Array.isArray(locs)) {
    for (const loc of locs) {
      if (loc?.pdf_url) return loc.pdf_url;
    }
  }
  return null;
}

function metaFromResponse(resp: any): PaperMeta {
  const title: string = resp?.title || 'Untitled';
  const authors: string[] = Array.isArray(resp?.z_authors)
    ? resp.z_authors.map((a: any) => a?.family ? `${a.family}, ${a.given ?? ''}`.trim().replace(/,\s*$/, '') : a?.given ? `${a.given}` : '').filter((s: string) => s.length > 0)
    : [];
  const year: number | undefined = typeof resp?.year === 'number' ? resp.year : (typeof resp?.published_date === 'string' ? parseInt(resp.published_date.slice(0, 4), 10) : undefined);
  const doi: string | undefined = resp?.doi;
  const venue: string | undefined = resp?.journal_name || resp?.publisher;
  const meta: PaperMeta = { title, authors, ...(year !== undefined && !Number.isNaN(year) ? { year } : {}), ...(doi ? { doi } : {}), ...(venue ? { venue } : {}) };
  return meta;
}

export interface UnpaywallConfig {
  email: string;
}

export class UnpaywallSource implements PaperSource {
  readonly name = 'unpaywall';
  readonly rank = 3;
  readonly timeoutMs = 8000;
  private email: string;

  constructor(config: UnpaywallConfig) {
    this.email = (config.email || '').trim() || 'trinno-research@example.com';
  }

  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    if (id.kind !== 'doi' || !id.doi) return null;
    const url = `${API}/${encodeURIComponent(id.doi)}?email=${encodeURIComponent(this.email)}`;

    try {
      const res = await httpRequest({
        url,
        signal,
        timeoutMs: this.timeoutMs,
        maxRetries: 0,
        headers: { 'User-Agent': `trinno-research/1.0 (mailto:${this.email})` },
        accept: 'application/json',
      });
      if (res.status < 200 || res.status >= 300) return null;
      const data: any = JSON.parse(res.body.toString('utf-8'));
      const pdfUrl = pickPdfUrl(data);
      if (!pdfUrl) return null;
      return { source: 'unpaywall', pdfUrl, meta: metaFromResponse(data) };
    } catch {
      return null;
    }
  }
}

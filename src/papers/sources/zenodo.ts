import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { createModuleLogger } from '../../bos/infrastructure/logging/logger';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

const log = createModuleLogger('zenodo');
const ZENODO_DOI_RE = /^10\.5281\/zenodo\.(\d+)$/i;
const API_HOST = 'https://zenodo.org';

function extractZenodoId(id: ParsedIdentifier): string | null {
  if (id.kind !== 'doi' || !id.doi) return null;
  const m = ZENODO_DOI_RE.exec(id.doi);
  return m && m[1] ? m[1] : null;
}

function pickBestFile(files: any[]): { url: string; size: number; format: string; key: string } | null {
  const ranked: Array<{ rank: number; entry: { url: string; size: number; format: string; key: string } }> = [];
  for (const f of files) {
    if (!f) continue;
    const links = f.links ?? {};
    const url: string | undefined = links.self || links.download || f.url;
    if (!url) continue;
    const fullUrl = new URL(url, API_HOST).toString();
    const mime: string = (f.mime_type || links.mime_type || '').toLowerCase();
    const key: string = (f.key || '').toLowerCase();
    const size: number = typeof f.size === 'number' ? f.size : 0;
    let rank = 99;
    if (mime.includes('application/pdf') || key.endsWith('.pdf')) rank = 0;
    else if (mime.includes('wordprocessing') || key.endsWith('.docx')) rank = 1;
    else if (mime.includes('msword') || key.endsWith('.doc')) rank = 2;
    else if (mime.includes('epub') || key.endsWith('.epub')) rank = 3;
    else if (mime.includes('html') || key.endsWith('.html') || key.endsWith('.htm')) rank = 4;
    else if (mime.includes('text/plain') || key.endsWith('.txt')) rank = 5;
    else if (mime.includes('zip') || key.endsWith('.zip')) rank = 6;
    else if (mime.includes('postscript') || key.endsWith('.ps')) rank = 7;
    else if (mime.includes('rtf') || key.endsWith('.rtf')) rank = 8;
    else if (key) rank = 50;
    ranked.push({ rank, entry: { url: fullUrl, size, format: mime || 'application/octet-stream', key } });
  }
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked[0]!.entry;
}

function metaFromResponse(resp: any, zenodoId: string): PaperMeta {
  const title: string = resp?.metadata?.title || `Zenodo record ${zenodoId}`;
  const creators: any[] = Array.isArray(resp?.metadata?.creators) ? resp.metadata.creators : [];
  const authors: string[] = creators
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c?.name && typeof c.name === 'string') return c.name;
      if (c?.family || c?.given) return `${c.family ?? ''}${c.given ? ', ' + c.given : ''}`.replace(/^,\s*|\s*,\s*$/g, '');
      return '';
    })
    .filter((s: string) => s.length > 0);
  const pubDate: string | undefined = resp?.metadata?.publication_date || resp?.created;
  const year: number | undefined = pubDate ? parseInt(pubDate.slice(0, 4), 10) : undefined;
  const doi: string = resp?.metadata?.doi || `10.5281/zenodo.${zenodoId}`;
  const venue: string = resp?.metadata?.publisher || 'Zenodo';
  const meta: PaperMeta = {
    title,
    authors,
    doi,
    venue,
  };
  if (year !== undefined && !Number.isNaN(year)) {
    meta.year = year;
  }
  return meta;
}

export class ZenodoSource implements PaperSource {
  readonly name = 'zenodo';
  readonly rank = 2;
  readonly timeoutMs = 10000;

  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    const zenodoId = extractZenodoId(id);
    if (!zenodoId) return null;

    const apiUrl = `${API_HOST}/api/records/${encodeURIComponent(zenodoId)}`;
    try {
      const res = await httpRequest({
        url: apiUrl,
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
      const files: any[] = Array.isArray(data?.files) ? data.files : [];
      const best = pickBestFile(files);
      if (!best) {
        const fileKeys = files.map((f: any) => f?.key || '<unknown>').slice(0, 5).join(', ');
        log.warn({ zenodoId, files: fileKeys || '<none>' }, 'no downloadable files');
        return null;
      }
      return {
        source: 'zenodo',
        pdfUrl: best.url,
        format: best.format,
        meta: metaFromResponse(data, zenodoId),
      };
    } catch {
      return null;
    }
  }
}

export const zenodoSource: PaperSource = new ZenodoSource();

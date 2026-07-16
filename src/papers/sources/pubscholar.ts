import type { PaperSource, SourceCandidate, ParsedIdentifier } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

const ARTICLE_HASH_RE = /^https?:\/\/pubscholar\.cn\/articles\/([a-f0-9]{32,128})/i;
const PATENTS_RE = /^https?:\/\/pubscholar\.cn\/patents\/([a-f0-9]{32,128})(?:\/\d+)?/i;
const BOOKS_RE = /^https?:\/\/pubscholar\.cn\/books\/([a-f0-9]{32,128})/i;
const PREVIEW_BASE = 'https://file.scholarin.cn/preview2';

async function probe(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<{ ok: boolean; contentType: string | null }> {
  try {
    const res = await httpRequest({
      url,
      method: 'HEAD',
      signal,
      timeoutMs,
      maxRetries: 0,
      headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno@example.com)' },
    });
    if (res.status < 200 || res.status >= 300) return { ok: false, contentType: null };
    return { ok: true, contentType: res.contentType };
  } catch {
    return { ok: false, contentType: null };
  }
}

function buildCandidates(articleHash: string, kind: 'article' | 'patent' | 'book'): string[] {
  const urls: string[] = [];
  const prefix = kind === 'patent' ? 'editor_patent_' : 'editor_cj_';
  const first32 = articleHash.slice(0, 32);
  for (const h of [articleHash, first32]) {
    if (h.length >= 8) {
      urls.push(`${PREVIEW_BASE}?file=${prefix}${h}.pdf`);
    }
  }
  return urls;
}

function parsePubScholarUrl(url: string): { hash: string; kind: 'article' | 'patent' | 'book' } | null {
  for (const { re, kind } of [
    { re: ARTICLE_HASH_RE, kind: 'article' as const },
    { re: PATENTS_RE, kind: 'patent' as const },
    { re: BOOKS_RE, kind: 'book' as const },
  ]) {
    const m = url.match(re);
    if (m && m[1]) {
      return { hash: m[1].toLowerCase(), kind };
    }
  }
  return null;
}

export const pubscholarSource: PaperSource = {
  name: 'pubscholar',
  rank: 1,
  timeoutMs: 6_000,
  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    if (id.kind !== 'url' || !id.value) return null;
    if (!/^https?:\/\/pubscholar\.cn\//i.test(id.value)) return null;

    const parsed = parsePubScholarUrl(id.value);
    if (!parsed) return null;

    const candidates = buildCandidates(parsed.hash, parsed.kind);
    for (const url of candidates) {
      const probe_ = await probe(url, signal, this.timeoutMs);
      if (probe_.ok && probe_.contentType === 'application/pdf') {
        return { source: 'pubscholar', pdfUrl: url, format: 'application/pdf' };
      }
    }
    return null;
  },
};

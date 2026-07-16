import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

interface PublisherPattern {
  name: string;
  doiPrefix: string;
  buildPdfUrl: (doi: string) => string;
  buildHtmlUrl: (doi: string) => string;
  rank: number;
}

const PATTERNS: PublisherPattern[] = [
  {
    name: 'frontiers',
    doiPrefix: '10.3389/',
    buildPdfUrl: (doi) => {
      const article = doi.replace(/^10\.3389\//, '').replace(/\./g, '/');
      return `https://www.frontiersin.org/articles/${article}/pdf`;
    },
    buildHtmlUrl: (doi) => {
      const article = doi.replace(/^10\.3389\//, '').replace(/\./g, '/');
      return `https://www.frontiersin.org/articles/${article}/full`;
    },
    rank: 2,
  },
  {
    name: 'mdpi',
    doiPrefix: '10.3390/',
    buildPdfUrl: (doi) => {
      const article = doi.replace(/^10\.3390\//, '').replace(/\./g, '/');
      return `https://www.mdpi.com/${article}/pdf`;
    },
    buildHtmlUrl: (doi) => {
      const article = doi.replace(/^10\.3390\//, '').replace(/\./g, '/');
      return `https://www.mdpi.com/${article}`;
    },
    rank: 2,
  },
  {
    name: 'plos',
    doiPrefix: '10.1371/',
    buildPdfUrl: (doi) => `https://journals.plos.org/plosone/article/file?id=${encodeURIComponent(doi)}&type=printable`,
    buildHtmlUrl: (doi) => `https://journals.plos.org/plosone/article?id=${encodeURIComponent(doi)}`,
    rank: 2,
  },
  {
    name: 'peerj',
    doiPrefix: '10.7717/',
    buildPdfUrl: (doi) => {
      const article = doi.replace(/^10\.7717\//, '').replace(/\./g, '/');
      return `https://peerj.com/articles/${article}.pdf`;
    },
    buildHtmlUrl: (doi) => {
      const article = doi.replace(/^10\.7717\//, '').replace(/\./g, '/');
      return `https://peerj.com/articles/${article}`;
    },
    rank: 2,
  },
];

function findPattern(doi: string): PublisherPattern | null {
  const lower = doi.toLowerCase();
  return PATTERNS.find(p => lower.startsWith(p.doiPrefix)) ?? null;
}

async function checkPdfReachable(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<boolean> {
  try {
    const res = await httpRequest({
      url,
      method: 'HEAD',
      signal,
      timeoutMs,
      maxRetries: 0,
      redirect: 'auto',
      headers: {
        'User-Agent': 'trinno-research/1.0 (mailto:trinno-research@example.com)',
        'Accept': 'application/pdf,*/*',
      },
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

export class PublisherDirectSource implements PaperSource {
  readonly name = 'publisher-direct';
  readonly rank = 5;
  readonly timeoutMs = 6000;
  private pattern: PublisherPattern | null = null;

  resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    return this.tryResolve(id, signal);
  }

  private async tryResolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    if (id.kind !== 'doi' || !id.doi) return null;
    const pattern = findPattern(id.doi);
    if (!pattern) return null;

    const pdfUrl = pattern.buildPdfUrl(id.doi);
    const htmlUrl = pattern.buildHtmlUrl(id.doi);
    const ok = await checkPdfReachable(pdfUrl, signal, this.timeoutMs);
    if (!ok) return null;

    return {
      source: pattern.name,
      pdfUrl,
      meta: {
        title: id.doi,
        authors: [],
        doi: id.doi,
        ...(htmlUrl ? { venue: pattern.name } : {}),
      },
    };
  }
}

export const publisherDirectSource: PaperSource = new PublisherDirectSource();

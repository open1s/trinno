import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';

const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;

function arxivIdFromIdentifier(id: ParsedIdentifier): string | null {
  if (id.kind === 'arxiv' && id.arxivId) return id.arxivId;
  if (id.kind === 'doi' && id.doi) {
    const m = id.doi.match(ARXIV_DOI);
    if (m && m[1]) return m[1];
  }
  return null;
}

interface ArxivEntry {
  id: string;
  title: string;
  authors: string[];
  year: number | undefined;
  doi: string | undefined;
  pdfUrl: string;
}

function parseArxivApi(xml: string): ArxivEntry | null {
  const idMatch = xml.match(/<id>\s*(https?:\/\/arxiv\.org\/abs\/([^<\s]+))\s*<\/id>/i);
  if (!idMatch || !idMatch[2]) return null;
  const arxivId = idMatch[2];

  const titleMatch = xml.match(/<title>\s*([\s\S]*?)\s*<\/title>/i);
  const title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  const authorBlocks = xml.match(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi) || [];
  const authors = authorBlocks
    .map(b => b.match(/<name>([\s\S]*?)<\/name>/i))
    .filter((m): m is RegExpMatchArray => !!m && !!m[1])
    .map(m => m[1]!.trim());

  const publishedMatch = xml.match(/<published>\s*(\d{4})/);
  const year = publishedMatch && publishedMatch[1] ? parseInt(publishedMatch[1], 10) : undefined;

  const doiMatch = xml.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/i);
  const doi = doiMatch && doiMatch[1] ? doiMatch[1].trim() : undefined;

  return {
    id: arxivId,
    title,
    authors,
    year,
    doi,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
  };
}

async function fetchWithTimeout(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno@example.com)' } });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export const arxivSource: PaperSource = {
  name: 'arxiv',
  rank: 1,
  timeoutMs: 8000,
  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    const arxivId = arxivIdFromIdentifier(id);
    if (!arxivId) return null;

    const apiUrl = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
    let entry: ArxivEntry | null = null;
    try {
      const res = await fetchWithTimeout(apiUrl, signal, this.timeoutMs);
      if (res.ok) {
        const xml = await res.text();
        entry = parseArxivApi(xml);
      }
    } catch {
      entry = null;
    }

    if (!entry) {
      return {
        source: 'arxiv',
        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      };
    }

    const meta: PaperMeta = {
      title: entry.title || arxivId,
      authors: entry.authors,
      arxivId: entry.id,
    };
    if (entry.year !== undefined) meta.year = entry.year;
    if (entry.doi) meta.doi = entry.doi;

    return { source: 'arxiv', pdfUrl: entry.pdfUrl, meta, license: 'arxiv' };
  },
};

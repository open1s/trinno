import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { arxivSource } from './sources/arxiv';
import { openalexSource } from './sources/openalex';
import { UnpaywallSource } from './sources/unpaywall';
import { semanticScholarSource } from './sources/semantic_scholar';
import { europePmcSource } from './sources/europe_pmc';
import { zenodoSource } from './sources/zenodo';
import { crossrefSource } from './sources/crossref';
import { biorxivSource } from './sources/biorxiv';
import { publisherDirectSource } from './sources/publisher_direct';
import { directUrlSource } from './sources/direct_url';
import { pubscholarSource } from './sources/pubscholar';
import { raceSources } from './racer';
import { buildFilename, dedupeFilename } from './filename';
import { parseIdentifier, isResolvable } from './identifier';
import type { DownloadOptions, DownloadResult, PaperSource, PaperMeta, ParsedIdentifier, ManualUrl } from './types';

const ALL_SOURCES: PaperSource[] = [
  directUrlSource,
  pubscholarSource,
  arxivSource,
  biorxivSource,
  openalexSource,
  zenodoSource,
  publisherDirectSource,
  crossrefSource,
  semanticScholarSource,
  europePmcSource,
];

export function getDefaultSources(email?: string): PaperSource[] {
  const unpaywall = new UnpaywallSource({ email: email || 'trinno-research@example.com' });
  return [...ALL_SOURCES, unpaywall];
}

const MIN_BYTES = 1_000;
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);
const DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const EPUB_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const FORMAT_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'text/html': 'html',
  'text/plain': 'txt',
  'application/epub+zip': 'epub',
  'application/zip': 'zip',
  'application/octet-stream': 'bin',
  'application/postscript': 'ps',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
};

const EXT_FORMAT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  ps: 'application/postscript',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  tex: 'application/x-tex',
  md: 'text/markdown',
};

const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ]/;

function buildSearchQuery(parsed: ParsedIdentifier, meta?: PaperMeta | null): string {
  if (parsed.doi) return parsed.doi;
  if (parsed.arxivId) return parsed.arxivId;
  if (parsed.pmid) return parsed.pmid;
  if (meta) {
    const title = meta.title || '';
    const author = meta.authors?.[0] || '';
    const year = meta.year ? ` ${meta.year}` : '';
    return [title, author + year].filter(Boolean).join(' ').trim();
  }
  return parsed.value || '';
}

function isChinese(meta?: PaperMeta | null): boolean {
  if (!meta) return false;
  if (CJK_RE.test(meta.title)) return true;
  if ((meta.authors || []).some(a => CJK_RE.test(a))) return true;
  if (meta.venue && CJK_RE.test(meta.venue)) return true;
  return false;
}

export function buildManualDownloadUrls(parsed: ParsedIdentifier, meta?: PaperMeta | null): ManualUrl[] {
  const urls: ManualUrl[] = [];
  const seen = new Set<string>();

  const push = (label: string, url: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push({ label, url });
  };

  if (parsed.doi) {
    push('Publisher (DOI)', `https://doi.org/${parsed.doi}`);
    const m = parsed.doi.match(/^10\.1016\/([^\s]+)$/i);
    if (m && m[1]) {
      const pii = m[1].replace(/^[^/]*\./, '');
      push('ScienceDirect', `https://www.sciencedirect.com/science/article/pii/${pii}`);
    }
    const wiley = parsed.doi.match(/^10\.1002\/(.+)$/i);
    if (wiley && wiley[1]) push('Wiley Online', `https://onlinelibrary.wiley.com/doi/${parsed.doi}`);
    const ieee = parsed.doi.match(/^10\.1109\/(.+)$/i);
    if (ieee && ieee[1]) push('IEEE Xplore', `https://ieeexplore.ieee.org/document/${ieee[1]}`);
    const acm = parsed.doi.match(/^10\.1145\/(.+)$/i);
    if (acm && acm[1]) push('ACM Digital Library', `https://dl.acm.org/doi/${parsed.doi}`);
    const springer = parsed.doi.match(/^10\.1007\/(.+)$/i);
    if (springer && springer[1]) push('SpringerLink', `https://link.springer.com/article/${parsed.doi}`);
  }

  if (parsed.arxivId) {
    push('arXiv abstract', `https://arxiv.org/abs/${parsed.arxivId}`);
  }

  if (parsed.pmid) {
    push('PubMed', `https://pubmed.ncbi.nlm.nih.gov/${parsed.pmid}/`);
  }

  if (meta?.url) {
    push('Landing page', meta.url);
  }
  if (meta?.venue) {
    push(`Journal: ${meta.venue}`, `https://scholar.google.com/scholar?q=${encodeURIComponent(`"${meta.title}" ${meta.venue}`)}`);
  }

  const q = buildSearchQuery(parsed, meta);
  const encoded = encodeURIComponent(q);
  push('Google Scholar', `https://scholar.google.com/scholar?q=${encoded}`);
  push('Semantic Scholar', `https://www.semanticscholar.org/search?q=${encoded}`);
  push('ResearchGate', `https://www.researchgate.net/search/publication?q=${encoded}`);

  if (isChinese(meta)) {
    push('Baidu Scholar (百度学术)', `https://xueshu.baidu.com/s?wd=${encodeURIComponent(meta?.title || q)}`);
    push('CNKI (知网)', `https://www.cnki.net/`);
    push('Wanfang (万方)', `https://www.wanfangdata.com.cn/search/searchResult.do?searchType=per_page&key=${encodeURIComponent(meta?.title || q)}`);
  }

  return urls;
}

async function lookupMetadata(parsed: ParsedIdentifier, signal: AbortSignal | undefined): Promise<PaperMeta | null> {
  let url: string | null = null;
  if (parsed.kind === 'doi' && parsed.doi) url = `https://api.openalex.org/works/doi:${encodeURIComponent(parsed.doi)}`;
  else if (parsed.kind === 'pmid' && parsed.pmid) url = `https://api.openalex.org/works/pmid:${encodeURIComponent(parsed.pmid)}`;
  else if (parsed.kind === 'arxiv' && parsed.arxivId) url = `https://api.openalex.org/works/doi:${encodeURIComponent('10.48550/arXiv.' + parsed.arxivId)}`;
  if (!url) return null;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno@example.com)' },
    });
    if (!res.ok) return null;
    const work: any = await res.json();
    if (!work) return null;
    const title: string = work.title || work.display_name || '';
    if (!title) return null;
    const authorships: any[] = work.authorships || [];
    const authors = authorships
      .map((a: any) => a?.author?.display_name)
      .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
    const year: number | undefined = typeof work.publication_year === 'number' ? work.publication_year : undefined;
    const doi: string | undefined = typeof work.doi === 'string' ? work.doi.replace(/^https?:\/\/doi\.org\//, '') : (parsed.doi ?? undefined);
    const venue: string | undefined = work?.primary_location?.source?.display_name || work?.host_venue?.display_name;
    const oaUrl: string | undefined = typeof work?.open_access?.oa_url === 'string' ? work.open_access.oa_url : undefined;
    const landingUrl: string | undefined = typeof work?.primary_location?.landing_page_url === 'string' ? work.primary_location.landing_page_url : undefined;
    const meta: PaperMeta = { title, authors };
    if (year !== undefined) meta.year = year;
    if (doi) meta.doi = doi;
    if (parsed.arxivId) meta.arxivId = parsed.arxivId;
    if (parsed.pmid) meta.pmid = parsed.pmid;
    if (venue) meta.venue = venue;
    if (oaUrl) meta.url = oaUrl;
    else if (landingUrl) meta.url = landingUrl;
    return meta;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function detectFormatFromBuffer(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('utf8') === '%PDF-') return 'application/pdf';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(DOCX_MAGIC)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ZIP_MAGIC)) return 'application/zip';
  if (buf.length >= 4 && (buf.subarray(0, 4).equals(EPUB_MAGIC))) {
    return 'application/epub+zip';
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString('utf8') === '{\\rtf1') return 'application/rtf';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('utf8') === '<!DOC' || buf.length >= 5 && buf.subarray(0, 5).toString('utf8') === '<html') return 'text/html';
  return null;
}

function detectFormatFromUrl(url: string): string | null {
  let pathname: string = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
  }
  const m = pathname.match(/\.([a-zA-Z0-9]{1,5})$/);
  if (!m || !m[1]) return null;
  const ext = m[1].toLowerCase();
  return EXT_FORMAT[ext] ?? null;
}

function extForFormat(format: string | undefined): string {
  if (!format) return 'bin';
  return FORMAT_EXT[format] ?? format.split('/').pop()?.split('+')[0] ?? 'bin';
}

const FILE_LINK_RE = /\.(pdf|docx?|pptx?)(\?|#|$)/i;

function fileUrlPriority(u: string): number {
  if (/\.pdf(\?|#|$)/i.test(u)) return 0;
  if (/\.docx(\?|#|$)/i.test(u)) return 1;
  if (/\.doc(\?|#|$)/i.test(u)) return 2;
  if (/\.pptx(\?|#|$)/i.test(u)) return 3;
  if (/\.ppt(\?|#|$)/i.test(u)) return 4;
  return 5;
}

/**
 * Extract direct file URLs (PDF/DOC/DOCX/PPT/PPTX) from an HTML page.
 * Looks at <meta name="citation_pdf_url">, <link href>, and <a href> tags.
 * Resolves relative URLs against baseUrl. Sorted by priority: pdf > docx > doc > pptx > ppt.
 */
export function extractFileUrlsFromHtml(html: string, baseUrl: string): string[] {
  const found = new Set<string>();

  const metaRe = /<meta\s+[^>]*name=["']citation_pdf_url["']\s+[^>]*content=["']([^"']+)["']/gi;
  for (const m of html.matchAll(metaRe)) {
    const u = m[1];
    if (u && FILE_LINK_RE.test(u)) found.add(u);
  }

  const linkRe = /<link\s+[^>]*href=["']([^"']+)["']/gi;
  for (const m of html.matchAll(linkRe)) {
    const u = m[1];
    if (u && FILE_LINK_RE.test(u)) found.add(u);
  }

  const anchorRe = /<a\s+[^>]*href=["']([^"']+)["']/gi;
  for (const m of html.matchAll(anchorRe)) {
    const u = m[1];
    if (u && FILE_LINK_RE.test(u)) found.add(u);
  }

  const resolved: string[] = [];
  for (const u of found) {
    try {
      resolved.push(new URL(u, baseUrl).toString());
    } catch { /* skip invalid */ }
  }

  resolved.sort((a, b) => fileUrlPriority(a) - fileUrlPriority(b));
  return resolved;
}

async function fetchFile(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<{ buffer: Buffer; contentType: string | null; extHint: string | null }> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'trinno-research/1.0 (mailto:trinno-research@example.com)',
        'Accept': 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip,application/epub+zip,application/octet-stream,text/html,text/plain,*/*',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    const contentType = (res.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() || null;
    const extHint = contentType;
    return { buffer, contentType, extHint };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function resolveOutputDir(override?: string): string {
  if (override && override.trim().length > 0) return override;
  const configured = readConfiguredOutputDir();
  if (configured && configured.trim().length > 0) {
    return configured.startsWith('~') ? path.join(os.homedir(), configured.slice(1)) : configured;
  }
  const firstFolder = readFirstWorkspaceFolder();
  if (firstFolder) {
    return path.join(firstFolder, '06_References');
  }
  return path.join(os.homedir(), '.trinno', 'papers');
}

function readConfiguredOutputDir(): string {
  try {
    const vscode = require('vscode');
    const cfg = vscode.workspace.getConfiguration('chat.papers').get('outputDir', '');
    return typeof cfg === 'string' ? cfg : '';
  } catch {
    return '';
  }
}

function readFirstWorkspaceFolder(): string | null {
  try {
    const vscode = require('vscode');
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) return folders[0]!.uri.fsPath;
  } catch {
  }
  return null;
}

export interface DownloadProgress {
  source: string;
  status: 'start' | 'fail' | 'success';
  filePath?: string;
  error?: string;
}

export async function downloadPaper(
  opts: DownloadOptions,
  onProgress?: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  const parsed = parseIdentifier(opts.identifier);
  if (!isResolvable(parsed)) {
    return { ok: false, error: `Cannot resolve identifier: ${opts.identifier}` };
  }

  const sources = (opts.sources && opts.sources.length > 0
    ? opts.sources
    : getDefaultSources(opts.email));

  const raceOpts: Parameters<typeof raceSources>[0] = {
    identifier: parsed,
    sources,
    onSourceStart: (s) => onProgress?.({ source: s, status: 'start' }),
    onSourceFail: (s, e) => onProgress?.({ source: s, status: 'fail', error: e }),
  };
  if (opts.signal) raceOpts.signal = opts.signal;
  const race = await raceSources(raceOpts);

  if (!race) {
    const meta = await lookupMetadata(parsed, opts.signal);
    return {
      ok: false,
      error: 'No source could resolve the identifier to a downloadable file.',
      attempts: [],
      ...(meta ? { meta } : {}),
      manualUrls: buildManualDownloadUrls(parsed, meta),
    };
  }

  const candidate = race.winner;
  onProgress?.({ source: candidate.source, status: 'start' });

  let fetched: { buffer: Buffer; contentType: string | null; extHint: string | null };
  try {
    fetched = await fetchFile(candidate.pdfUrl, opts.signal, 30_000);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    onProgress?.({ source: candidate.source, status: 'fail', error: msg });
    const failResult: DownloadResult = {
      ok: false,
      source: candidate.source,
      error: `Download failed from ${candidate.source}: ${msg}`,
    };
    if (candidate.meta) failResult.meta = candidate.meta;
    failResult.manualUrls = buildManualDownloadUrls(parsed, candidate.meta);
    return failResult;
  }

  const { buffer, contentType } = fetched;

  if (buffer.length < MIN_BYTES) {
    onProgress?.({
      source: candidate.source,
      status: 'fail',
      error: `Response from ${candidate.source} is too small (${buffer.length} bytes)`,
    });
    const failResult: DownloadResult = {
      ok: false,
      source: candidate.source,
      error: `Response from ${candidate.source} is too small (${buffer.length} bytes)`,
    };
    if (candidate.meta) failResult.meta = candidate.meta;
    failResult.manualUrls = buildManualDownloadUrls(parsed, candidate.meta);
    return failResult;
  }

  const format =
    candidate.format ||
    contentType ||
    detectFormatFromBuffer(buffer) ||
    detectFormatFromUrl(candidate.pdfUrl) ||
    'application/octet-stream';

  let resolvedBuffer = buffer;
  let resolvedFormat: string = format;
  let resolvedFromExtracted: string | null = null;

  if (resolvedFormat === 'text/html') {
    const htmlText = buffer.toString('utf8', 0, Math.min(buffer.length, 1_000_000));
    const candidates = extractFileUrlsFromHtml(htmlText, candidate.pdfUrl).slice(0, 5);
    for (const fileUrl of candidates) {
      try {
        const inner = await fetchFile(fileUrl, opts.signal, 15_000);
        const innerFormat =
          inner.contentType ||
          detectFormatFromBuffer(inner.buffer) ||
          detectFormatFromUrl(fileUrl) ||
          'application/octet-stream';
        if (innerFormat !== 'text/html' && inner.buffer.length >= MIN_BYTES) {
          resolvedBuffer = inner.buffer;
          resolvedFormat = innerFormat;
          resolvedFromExtracted = fileUrl;
          break;
        }
      } catch {
        // try next candidate
      }
    }
    if (!resolvedFromExtracted) {
      onProgress?.({
        source: candidate.source,
        status: 'fail',
        error: `${candidate.source} returned an HTML page with no extractable PDF/DOC/DOCX/PPT link`,
      });
      const failResult: DownloadResult = {
        ok: false,
        source: candidate.source,
        error: `${candidate.source} returned an HTML page (no direct file link found). Try a different identifier or use /download with a direct URL.`,
      };
      if (candidate.meta) failResult.meta = candidate.meta;
      failResult.manualUrls = buildManualDownloadUrls(parsed, candidate.meta);
      return failResult;
    }
  }

  const outputDir = resolveOutputDir(opts.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const fallback: PaperMeta = { title: parsed.value, authors: [] };
  if (parsed.doi) fallback.doi = parsed.doi;
  if (parsed.arxivId) fallback.arxivId = parsed.arxivId;
  if (parsed.pmid) fallback.pmid = parsed.pmid;
  const meta: PaperMeta = candidate.meta ?? fallback;
  const ext = extForFormat(resolvedFormat);
  const filename = dedupeFilename(outputDir, buildFilename(meta, ext));
  const fullPath = path.join(outputDir, filename);
  fs.writeFileSync(fullPath, resolvedBuffer);

  onProgress?.({ source: candidate.source, status: 'success', filePath: fullPath });

  return {
    ok: true,
    source: candidate.source,
    filePath: fullPath,
    bytes: resolvedBuffer.length,
    format: resolvedFormat,
    meta,
  };
}

export function listDownloadedPapers(outputDir?: string): { filePath: string; size: number; mtime: number }[] {
  const dir = resolveOutputDir(outputDir);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: { filePath: string; size: number; mtime: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    const isSupported = lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.doc') || lower.endsWith('.epub') || lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.txt') || lower.endsWith('.rtf') || lower.endsWith('.odt') || lower.endsWith('.tex') || lower.endsWith('.md');
    if (!isSupported) continue;
    const full = path.join(dir, entry.name);
    try {
      const st = fs.statSync(full);
      results.push({ filePath: full, size: st.size, mtime: st.mtimeMs });
    } catch {
      // ignore
    }
  }
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

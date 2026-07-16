import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createModuleLogger } from '../bos/infrastructure/logging/logger';
import { arxivSource } from './sources/arxiv';

const log = createModuleLogger('papers');
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
import { sciHubSource } from './sources/sci_hub';
import { raceSources } from './racer';
import { buildFilename, dedupeFilename } from './filename';
import { parseIdentifier, isResolvable } from './identifier';
import { httpRequest } from '../bos/infrastructure/http/http_client';
import { extractUrlsFromHtml } from '../bos/infrastructure/http/document_extractor';
import type { DownloadOptions, DownloadResult, PaperSource, PaperMeta, ParsedIdentifier, ManualUrl, SourceCandidate } from './types';

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
  sciHubSource,
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
    const res = await httpRequest({
      url,
      signal: ctrl.signal,
      timeoutMs: 8000,
      maxRetries: 0,
      headers: { 'User-Agent': 'trinno-research/1.0 (mailto:trinno@example.com)' },
      accept: 'application/json',
    });
    if (res.status < 200 || res.status >= 300) return null;
    const work: any = JSON.parse(res.body.toString('utf-8'));
    if (!work) return null;
    const title: string = work.title || work.display_name || '';
    if (!title) return null;
    const authorships: any[] = work.authorships || [];
    const authors = authorships
      .map((a: any) => a?.author?.display_name)
      .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
    const year: number | undefined = typeof work.publication_year === 'number' ? work.publication_year : undefined;
    const doi: string | undefined = typeof work.doi === 'string' ? work.doi.replace(/^https?:\/\/doi\.org\//, '') : (parsed.doi ?? undefined);
    const venue: string | undefined = work?.primary_location?.source?.display_name;
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

const FILE_LINK_RE = /\.(pdf|docx?|pptx?|epub|ps)(\?|#|$)/i;
const DOWNLOAD_URL_RE = /\/(pdf|download|fulltext|full-text|supplement)\//i;

const DOWNLOAD_TEXT_RE = /\b(pdf|download|full ?text|全文)\b/i;

function fileUrlPriority(u: string): number {
  if (/\.pdf(\?|#|$)/i.test(u)) return 0;
  if (/\.docx(\?|#|$)/i.test(u)) return 1;
  if (/\.doc(\?|#|$)/i.test(u)) return 2;
  if (/\.pptx(\?|#|$)/i.test(u)) return 3;
  if (/\.ppt(\?|#|$)/i.test(u)) return 4;
  if (/\.epub(\?|#|$)/i.test(u)) return 5;
  if (/\.ps(\?|#|$)/i.test(u)) return 6;
  return 7;
}

function isFileUrl(u: string): boolean {
  return FILE_LINK_RE.test(u) || DOWNLOAD_URL_RE.test(u) || /\b(format|type)=pdf/i.test(u);
}

/**
 * Extract direct file URLs (PDF/DOC/DOCX/PPT/PPTX/EPUB) from an HTML page.
 * Checks <meta>, <link>, <embed>, <iframe>, and <a> tags.
 * For <a> tags also inspects link text and title.
 * Resolves relative URLs against baseUrl. Sorted by priority.
 */
export function extractFileUrlsFromHtml(html: string, baseUrl: string): string[] {
  const found = new Set<string>();

  const ATTR_RE = /(name|content|property|itemprop|href|src|rel)\s*=\s*["']([^"']+)["']/gi;

  // <meta> — check every meta's content for a file URL
  const metaTagRe = /<meta\s[^>]*>/gi;
  for (const m of html.matchAll(metaTagRe)) {
    const tag = m[0];
    ATTR_RE.lastIndex = 0;
    const attrs: Record<string, string> = {};
    for (const a of tag.matchAll(ATTR_RE)) {
      attrs[a[1]!.toLowerCase()] = a[2]!;
    }
    const u = attrs['content'];
    if (u && isFileUrl(u)) found.add(u);
  }

  // <link> — check href + rel="pdf" / rel="alternate"
  const linkTagRe = /<link\s[^>]*>/gi;
  for (const m of html.matchAll(linkTagRe)) {
    const tag = m[0];
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    const rel = tag.match(/rel\s*=\s*["']([^"']+)["']/i);
    const u = href?.[1];
    if (!u) continue;
    if (isFileUrl(u)) found.add(u);
    else if (rel && /pdf|alternate/i.test(rel[1]!) && /\.pdf(?:\?|#|$)/i.test(u)) found.add(u);
  }

  // <embed> / <iframe> — check src
  const embedRe = /<(?:embed|iframe)\s[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(embedRe)) {
    const u = m[1];
    if (u && isFileUrl(u)) found.add(u);
  }

  // <a> — match full tag with inner text to also check link text / title
  const anchorFullRe = /<a\s[^>]*>.*?<\/a>/gis;
  for (const m of html.matchAll(anchorFullRe)) {
    const tag = m[0];
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    const u = href?.[1];
    if (!u) continue;
    if (isFileUrl(u)) {
      found.add(u);
      continue;
    }
    // No extension in URL — check link text and attributes for download signals
    const inner = tag.replace(/<[^>]*>/g, '');
    const title = tag.match(/title\s*=\s*["']([^"']+)["']/i);
    if (DOWNLOAD_TEXT_RE.test(inner) || (title && DOWNLOAD_TEXT_RE.test(title[1]!))) {
      found.add(u);
    }
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
  const res = await httpRequest({
    url,
    ...(signal ? { signal } : {}),
    timeoutMs,
    redirect: 'manual',
    maxRetries: 1,
  });
  return {
    buffer: res.body,
    contentType: res.contentType,
    extHint: res.contentType,
  };
}

function resolveOutputDir(override?: string): string | null {
  if (override && override.trim().length > 0) return override;
  const firstFolder = readFirstWorkspaceFolder();
  if (firstFolder) {
    return path.join(firstFolder, '06_References');
  }
  return null;
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
  log.info({ identifier: opts.identifier, kind: parsed.kind }, 'downloadPaper start');
  if (!isResolvable(parsed)) {
    log.warn({ identifier: opts.identifier }, 'unresolvable identifier');
    return { ok: false, error: `Cannot resolve identifier: ${opts.identifier}` };
  }

  const sources = (opts.sources && opts.sources.length > 0
    ? opts.sources
    : getDefaultSources(opts.email));
  log.debug({ sourceCount: sources.length }, 'racing sources');

  const raceOpts: Parameters<typeof raceSources>[0] = {
    identifier: parsed,
    sources,
    onSourceStart: (s) => {
      log.debug({ source: s }, 'source race started');
      onProgress?.({ source: s, status: 'start' });
    },
    onSourceFail: (s, e) => {
      log.warn({ source: s, error: e }, 'source race failed');
      onProgress?.({ source: s, status: 'fail', error: e });
    },
  };
  if (opts.signal) raceOpts.signal = opts.signal;
  const race = await raceSources(raceOpts);

  if (!race || race.candidates.length === 0) {
    log.warn({ identifier: opts.identifier }, 'no source resolved the identifier');
    const meta = await lookupMetadata(parsed, opts.signal);
    return {
      ok: false,
      error: 'No source could resolve the identifier to a downloadable file.',
      attempts: [],
      ...(meta ? { meta } : {}),
      manualUrls: buildManualDownloadUrls(parsed, meta),
    };
  }

  const candidates = race.candidates;
  log.debug({ winnerCount: candidates.length, sourceCount: race.failures.length }, 'race finished');

  let lastCandidate: SourceCandidate | null = null;
  let lastError: string = '';

  for (const candidate of candidates) {
    lastCandidate = candidate;
    onProgress?.({ source: candidate.source, status: 'start' });

    let fetched: { buffer: Buffer; contentType: string | null; extHint: string | null };
    try {
      fetched = await fetchFile(candidate.pdfUrl, opts.signal, 120_000);
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      onProgress?.({ source: candidate.source, status: 'fail', error: lastError });
      continue;
    }

    const { buffer, contentType } = fetched;
    if (buffer.length < MIN_BYTES) {
      lastError = `Response from ${candidate.source} is too small (${buffer.length} bytes)`;
      onProgress?.({ source: candidate.source, status: 'fail', error: lastError });
      continue;
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
      const extracted = extractUrlsFromHtml(htmlText, candidate.pdfUrl).slice(0, 5);
      for (const e of extracted) {
        try {
          const inner = await fetchFile(e.url, opts.signal, 15_000);
          const innerFormat =
            inner.contentType ||
            detectFormatFromBuffer(inner.buffer) ||
            detectFormatFromUrl(e.url) ||
            'application/octet-stream';
          if (innerFormat !== 'text/html' && inner.buffer.length >= MIN_BYTES) {
            resolvedBuffer = inner.buffer;
            resolvedFormat = innerFormat;
            resolvedFromExtracted = e.url;
            break;
          }
        } catch {
        }
      }
      if (!resolvedFromExtracted) {
        lastError = `${candidate.source} returned an HTML page with no extractable file link`;
        onProgress?.({ source: candidate.source, status: 'fail', error: lastError });
        continue;
      }
    }

    const outputDir = resolveOutputDir(opts.outputDir);
    if (!outputDir) {
      lastError = 'No workspace folder is open. Open a folder to set the download target (06_References).';
      continue;
    }
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

  const failResult: DownloadResult = {
    ok: false,
    error: lastError || 'All sources failed to download',
    ...(lastCandidate ? { source: lastCandidate.source } : {}),
  };
  if (lastCandidate?.meta) failResult.meta = lastCandidate.meta;
  failResult.manualUrls = buildManualDownloadUrls(parsed, lastCandidate?.meta ?? undefined);
  return failResult;
}

export function listDownloadedPapers(outputDir?: string): { filePath: string; size: number; mtime: number }[] {
  const dir = resolveOutputDir(outputDir);
  if (!dir) return [];
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

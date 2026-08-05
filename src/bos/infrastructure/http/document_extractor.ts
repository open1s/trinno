/**
 * DocumentExtractor — parses any HTML page for downloadable file URLs.
 *
 * Covers:
 *   - Meta tags (citation_pdf_url, og:url, DC.*, etc.)
 *   - JSON-LD structured data
 *   - iframe / embed / object / source elements
 *   - <a> + <link> tags
 *   - Publisher-specific patterns (ScienceDirect, Nature, ACS, etc.)
 *   - API/download endpoints with format params
 *   - Any downloadable file format (PDF, DOCX, PPTX, EPUB, ZIP, images, datasets, etc.)
 */

import * as url from 'url';

export interface ExtractedUrl {
  /** Full resolved URL */
  url: string;
  /** Format hint from URL or context */
  formatHint: string | null;
  /** Source of the extraction (meta, iframe, href, jsonld, etc.) */
  source: string;
  /** Lower priority = better match */
  priority: number;
}

const FILE_EXT_RE = /\.(pdf|docx?|xlsx?|csv|pptx?|epub|rtf|txt|zip|tar(\.(gz|bz2|xz))?|7z|rar|gz|bz2|xz|png|jpe?g|gif|svg|tiff?|bmp|webp|ico|json|xml|html?|ps|tex|bib|ris|enw)(\?|#|$)/i;

const DOWNLOAD_PATH_RE = /\/(pdf|download|fulltext|full-text|supplement|supplementary|data[-\s]?set|archive|file)\//i;

const DOWNLOAD_QUERY_RE = /\b(format|type)=pdf\b|\b(download|save)=/i;

const DOWNLOAD_TEXT_RE = /\b(pdf|download|full ?text|全文|supplement|supplementary|dataset|archive)\b/i;

const PUBLISHER_PATTERNS = [
  // ScienceDirect — /science/article/pii/S0360319925000382/pdfft?md5=...&pid=...
  /\/(?:pdfft|pdf)\?/gi,
  // Nature — articles/XXX.pdf
  /\/articles\/s\d{5}-\d{3}-\d{5}-\w\/pdf\//gi,
  // ACS — /doi/pdf/10.1021/...
  /\/doi\/pdf\//gi,
  // Wiley — /doi/epdf/...
  /\/doi\/epdf\//gi,
  // SpringerLink — /content/pdf/...
  /\/content\/pdf\//gi,
  // IEEE — /stamp/stamp.jsp?tp=&arnumber=...
  /\/stamp\/stamp\.jsp/gi,
  // Taylor & Francis API
  /\/chapters\/oa-edit\/download\?/gi,
  // PubMed Central — /pmc/articles/PMC...
  /\/pmc\/articles\/PMC\d+\/pdf\//gi,
  // arXiv PDF
  /\/pdf\/\d{4}\.\d{4,}/gi,
];

function formatFromUrl(u: string): string | null {
  const m = u.match(/\.(pdf|docx?|xlsx?|csv|pptx?|epub|rtf|txt|zip|png|jpe?g|svg)(?:\?|#|$)/i);
  if (!m) return null;
  const ext = m[1]!.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    epub: 'application/epub+zip',
    zip: 'application/zip',
    csv: 'text/csv',
    txt: 'text/plain',
    rtf: 'application/rtf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };
  return map[ext] ?? null;
}

function priorityOf(u: string): number {
  if (/\.pdf(\?|#|$)/i.test(u)) return 0;
  if (/\.docx?(\?|#|$)/i.test(u)) return 1;
  if (/\.xlsx?(\?|#|$)/i.test(u)) return 2;
  if (/\.csv(\?|#|$)/i.test(u)) return 3;
  if (/\.pptx?(\?|#|$)/i.test(u)) return 4;
  if (/\.epub(\?|#|$)/i.test(u)) return 5;
  if (/\.zip(\?|#|$)/i.test(u)) return 6;
  if (/\.(tar|gz|bz2|xz|7z|rar)(\?|#|$)/i.test(u)) return 7;
  if (/\.(png|jpe?g|gif|svg|tiff?|bmp|webp)(\?|#|$)/i.test(u)) return 8;
  if (/\.(txt|rtf)(\?|#|$)/i.test(u)) return 9;
  if (/\.(json|xml)(\?|#|$)/i.test(u)) return 10;
  return 11;
}

function isDownloadUrl(u: string): boolean {
  return FILE_EXT_RE.test(u) || DOWNLOAD_PATH_RE.test(u) || DOWNLOAD_QUERY_RE.test(u);
}

function matchesPublisher(u: string): boolean {
  for (const p of PUBLISHER_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(u)) return true;
  }
  return false;
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const ATTR_RE = /(name|content|property|itemprop|href|src|rel|type|citation_pdf_url)\s*=\s*["']([^"']+)["']/gi;
  for (const m of tag.matchAll(ATTR_RE)) {
    attrs[m[1]!.toLowerCase()] = m[2]!;
  }
  return attrs;
}

function resolve(u: string, baseUrl: string): string | null {
  try {
    return new url.URL(u, baseUrl).toString();
  } catch {
    return null;
  }
}

export function extractUrlsFromHtml(html: string, baseUrl: string): ExtractedUrl[] {
  const seen = new Set<string>();
  const results: ExtractedUrl[] = [];

  function add(u: string, source: string, priority?: number) {
    const resolved = resolve(u, baseUrl);
    if (!resolved) return;
    const key = resolved.toLowerCase().replace(/#.*/, '');
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      url: resolved,
      formatHint: formatFromUrl(resolved),
      source,
      priority: priority ?? priorityOf(resolved),
    });
  }

  // --- Meta tags ---
  const metaTagRe = /<meta\s[^>]*[^>/]*>/gi;
  for (const m of html.matchAll(metaTagRe)) {
    const attrs = parseAttrs(m[0]!);
    const content = attrs['content'];
    if (!content) continue;

    // citation_pdf_url
    if (attrs['name']?.toLowerCase() === 'citation_pdf_url') {
      add(content, 'meta:citation_pdf_url', 0);
      continue;
    }

    // og:url, og:video, og:image
    if (attrs['property']?.toLowerCase() === 'og:image') {
      add(content, 'meta:og:image', 8);
      continue;
    }
    if (attrs['property']?.toLowerCase() === 'og:audio') {
      add(content, 'meta:og:audio', 10);
      continue;
    }

    // DC.format + DC.identifier pattern — link DOI page to a PDF format hint
    // but we only get the identifier, not the actual PDF URL. Skip unless metadata links file.

    // Any content that is a file URL
    if (isDownloadUrl(content)) {
      add(content, 'meta:content');
    }
    if (matchesPublisher(content)) {
      add(content, 'meta:publisher');
    }
  }

  // --- JSON-LD ---
  const jsonldRe = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(jsonldRe)) {
    try {
      const data = JSON.parse(m[1]!);
      const crawl = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.url && typeof obj.url === 'string' && isDownloadUrl(obj.url)) {
          add(obj.url, 'jsonld:url');
        }
        if (obj.contentUrl && typeof obj.contentUrl === 'string') {
          add(obj.contentUrl, 'jsonld:contentUrl');
        }
        if (obj.encodingFormat === 'application/pdf' && obj.url) {
          add(obj.url, 'jsonld:pdf', 0);
        }
        if (obj.distribution) {
          const dists = Array.isArray(obj.distribution) ? obj.distribution : [obj.distribution];
          for (const d of dists) {
            if (d?.contentUrl) add(d.contentUrl, 'jsonld:distribution:contentUrl');
            if (d?.downloadURL) add(d.downloadURL, 'jsonld:distribution:downloadURL');
            if (d?.url && d?.encodingFormat === 'application/pdf') add(d.url, 'jsonld:distribution:pdf', 0);
          }
        }
        if (Array.isArray(obj)) {
          for (const item of obj) crawl(item);
        } else {
          for (const v of Object.values(obj)) {
            if (typeof v === 'object' && v !== null) crawl(v);
          }
        }
      };
      crawl(data);
    } catch { /* invalid JSON */ }
  }

  // --- iframe / embed / object ---
  const embedRe = /<(?:iframe|embed|object)\s[^>]*>/gi;
  for (const m of html.matchAll(embedRe)) {
    const tag = m[0]!;
    const attrs = parseAttrs(tag);
    const src = attrs['src'];
    if (src && isDownloadUrl(src)) {
      add(src, 'embed:src');
    } else if (src && matchesPublisher(src)) {
      add(src, 'embed:publisher');
    }
    // data-src (lazy-loaded content)
    const dataSrc = tag.match(/data-src\s*=\s*["']([^"']+)["']/i);
    if (dataSrc?.[1] && (isDownloadUrl(dataSrc[1]) || matchesPublisher(dataSrc[1]))) {
      add(dataSrc[1], 'embed:data-src');
    }
  }

  // --- <source> inside <video>/<audio> ---
  const sourceRe = /<source\s[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(sourceRe)) {
    const u = m[1];
    if (u && isDownloadUrl(u)) add(u, 'source:src');
  }

  // --- <link> rel=alternate ---
  const linkTagRe = /<link\s[^>]*>/gi;
  for (const m of html.matchAll(linkTagRe)) {
    const attrs = parseAttrs(m[0]!);
    const href = attrs['href'];
    if (!href) continue;
    const rel = attrs['rel']?.toLowerCase() || '';
    const type = attrs['type']?.toLowerCase() || '';

    if (type === 'application/pdf') {
      add(href, 'link:pdf', 0);
    } else if (type.includes('pdf')) {
      add(href, 'link:pdf-type');
    } else if (rel === 'alternate' && /pdf/i.test(type || '')) {
      add(href, 'link:alternate-pdf');
    } else if (isDownloadUrl(href)) {
      add(href, 'link:href');
    }
  }

  // --- <a> + link text + title ---
  const anchorFullRe = /<a\s[^>]*>.*?<\/a>/gis;
  for (const m of html.matchAll(anchorFullRe)) {
    const tag = m[0]!;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!href?.[1]) continue;
    const u = href[1]!;
    if (isDownloadUrl(u)) {
      add(u, 'a:href');
      continue;
    }
    if (matchesPublisher(u)) {
      add(u, 'a:publisher', 5);
      continue;
    }
    // Check link text for download signals
    const inner = tag.replace(/<[^>]*>/g, '');
    const title = tag.match(/title\s*=\s*["']([^"']+)["']/i);
    if (DOWNLOAD_TEXT_RE.test(inner) || (title?.[1] && DOWNLOAD_TEXT_RE.test(title[1]))) {
      add(u, 'a:text-signal', 6);
    }
  }

  // --- Bare publisher PDF URL patterns in page text ---
  for (const p of PUBLISHER_PATTERNS) {
    for (const m of html.matchAll(p)) {
      const full = m[0]!;
      if (isDownloadUrl(full) || /download|pdf/i.test(full)) {
        add(full, 'text:publisher-url');
      }
    }
  }

  // Sort by priority, then by format desirability
  results.sort((a, b) => a.priority - b.priority || (b.formatHint ? 0 : 1) - (a.formatHint ? 0 : 1));
  return results;
}

export function extractTopUrls(html: string, baseUrl: string, maxUrls = 10): ExtractedUrl[] {
  return extractUrlsFromHtml(html, baseUrl).slice(0, maxUrls);
}
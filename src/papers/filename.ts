import * as fs from 'fs';
import * as path from 'path';
import type { PaperMeta } from './types';

const MAX_TITLE = 120;
const MAX_AUTHOR = 40;
const MAX_TOTAL = 200;

const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;
const WHITESPACE = /\s+/g;
const TRAILING_DOTS = /\.+$/;
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizeSegment(s: string, max: number): string {
  let out = (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  out = out.replace(ILLEGAL, ' ').replace(WHITESPACE, ' ').trim().replace(TRAILING_DOTS, '');
  // Re-strip trailing dots after truncation ("aa..a" cut at 'max' can end on a dot).
  if (out.length > max) out = out.slice(0, max).trim().replace(TRAILING_DOTS, '');
  if (RESERVED_WIN.test(out)) out = '_' + out;
  if (!out) out = 'untitled';
  return out;
}

export function buildFilename(meta: PaperMeta, fallbackExt = 'pdf'): string {
  const year = meta.year ? String(meta.year) : 'n.d.';
  const firstAuthor = (meta.authors[0] || 'Unknown').split(',')[0]!.trim();
  const authorSeg = sanitizeSegment(firstAuthor, MAX_AUTHOR);
  const more = meta.authors.length > 1 ? ' et al' : '';
  const authorPart = `${authorSeg}${more}`;

  const titleSeg = sanitizeSegment(meta.title, MAX_TITLE);

  let raw = `${authorPart} (${year}) ${titleSeg}.${fallbackExt}`;
  if (raw.length > MAX_TOTAL) {
    const over = raw.length - MAX_TOTAL;
    raw = `${authorPart} (${year}) ${titleSeg.slice(0, Math.max(0, titleSeg.length - over))}.${fallbackExt}`;
  }
  // Windows reserves the whole base name regardless of extension (CON.pdf is
  // still illegal); the per-segment guard above cannot see the final name.
  const finalExt = path.extname(raw);
  const finalBase = raw.slice(0, raw.length - finalExt.length);
  if (RESERVED_WIN.test(finalBase)) raw = '_' + raw;
  return raw;
}

export function dedupeFilename(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = filename;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
    if (n > 999) break;
  }
  return candidate;
}

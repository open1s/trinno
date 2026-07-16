import { defineTool, ok, err } from '@open1s/ezbos';
import { downloadPaper, listDownloadedPapers } from '../../../papers/downloader.js';
import type { PhaseWriter } from '../persistence/phase_writer.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveInWorkspace } from '../config/workspaceGuard.js';

export function createPapersTools(phaseWriter: PhaseWriter) {
  const downloadPaperTool = defineTool(
    'papers_download',
    'Download a paper by DOI, arXiv ID, PMID, or any URL (publisher, Zenodo, bioRxiv, ' +
    'file.scholarin.cn, pubscholar.cn, etc.). ',
  )
    .required('identifier', 'string', 'DOI, arXiv ID, PMID, or any URL (https://...) of the paper to download')
    .param('outputDir', 'string', 'Override output directory (defaults to <workspace>/06_References/, falls back to ~/.trinno/papers/ if unwritable)')
    .handle(async (args) => {
      const wsRoot = phaseWriter.getWorkspaceRoot() || process.cwd();
      let primary: string;
      if (args.outputDir?.trim()) {
        const guard = resolveInWorkspace(args.outputDir.trim(), wsRoot);
        if (guard.ok) {
          primary = guard.resolved;
        } else {
          primary = args.outputDir.trim();
        }
      } else {
        primary = defaultOutputDir(phaseWriter);
      }
      const candidates = uniqueDirs([primary, fallbackDir()]);

      const attempts: Array<{ dir: string; ok: boolean; error: string }> = [];

      let lastManualUrls: { label: string; url: string }[] | undefined;
      let lastMeta: any = undefined;

      for (const dir of candidates) {
        if (!dir) continue;
        const writable = await ensureWritable(dir);
        if (!writable.ok) {
          attempts.push({ dir, ok: false, error: writable.error });
          continue;
        }
        try {
          const result = await downloadPaper({ identifier: args.identifier, outputDir: dir });
          if (result.ok) {
            return ok({
              ok: true,
              filePath: result.filePath,
              source: result.source,
              format: result.format,
              bytes: result.bytes,
              meta: result.meta,
              usedFallback: dir !== primary,
              requestedDir: primary,
            });
          }
          if (result.manualUrls && result.manualUrls.length > 0) lastManualUrls = result.manualUrls;
          if (result.meta) lastMeta = result.meta;
          attempts.push({ dir, ok: false, error: result.error || 'unknown' });
        } catch (e: unknown) {
          attempts.push({ dir, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }

      return err(formatFailure(attempts, primary, candidates, lastManualUrls, lastMeta));
    });

  const listDownloadedTool = defineTool(
    'papers_list_downloaded',
    'List papers previously downloaded by Trinno.',
  )
    .param('outputDir', 'string', 'Override output directory (defaults to <workspace>/06_References/)')
    .handle((args) => {
      let primary: string;
      if (args.outputDir?.trim()) {
        const guard = resolveInWorkspace(args.outputDir.trim(), phaseWriter.getWorkspaceRoot() || process.cwd());
        if (!guard.ok) return err(guard.error);
        primary = guard.resolved;
      } else {
        primary = defaultOutputDir(phaseWriter);
      }
      const dirs = uniqueDirs([primary, fallbackDir()]);
      const seen = new Set<string>();
      const all: Array<{ filePath: string; size: number; mtime: number }> = [];
      for (const d of dirs) {
        if (!d) continue;
        const items = listDownloadedPapers(d);
        for (const item of items) {
          if (seen.has(item.filePath)) continue;
          seen.add(item.filePath);
          all.push(item);
        }
      }
      all.sort((a, b) => b.mtime - a.mtime);
      return ok({ count: all.length, directories: dirs, papers: all });
    });

  return [downloadPaperTool, listDownloadedTool];
}

function defaultOutputDir(phaseWriter: PhaseWriter): string {
  const root = phaseWriter.getWorkspaceRoot();
  if (root) return path.join(root, '06_References');
  return '';
}

function fallbackDir(): string {
  return path.join(os.homedir(), '.trinno', 'papers');
}

function uniqueDirs(dirs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of dirs) {
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

async function ensureWritable(dir: string): Promise<{ ok: boolean; error: string }> {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.trinno-write-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return { ok: true, error: '' };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function formatFailure(
  attempts: Array<{ dir: string; ok: boolean; error?: string }>,
  primary: string,
  candidates: string[],
  manualUrls?: { label: string; url: string }[],
  meta?: any,
): string {
  const lines: string[] = ['Download failed in all output directories.'];
  if (meta) {
    const m = meta as { title?: string; authors?: string[]; year?: number; venue?: string; doi?: string };
    if (m.title) {
      const authorYear = m.authors?.length
        ? `${m.authors[0]}${m.authors.length > 1 ? ' et al' : ''}${m.year ? ` (${m.year})` : ''}`
        : (m.year ? `(${m.year})` : '');
      lines.push(`Paper: ${m.title}${authorYear ? ` — ${authorYear}` : ''}${m.venue ? ` [${m.venue}]` : ''}`);
    }
  }
  if (primary) lines.push(`Requested: ${primary}`);
  lines.push('Attempts:');
  for (const a of attempts) {
    lines.push(`  - ${a.dir}: ${a.error || 'unknown error'}`);
  }
  const tried = candidates.filter(Boolean).join(', ');
  if (tried) lines.push(`Tried: ${tried}`);
  if (manualUrls && manualUrls.length > 0) {
    lines.push('');
    lines.push('Manual download URLs (no auto-fetch — open in a browser or paste into a download manager):');
    for (const m of manualUrls) {
      lines.push(`  - ${m.label}: ${m.url}`);
    }
  }
  lines.push('Hint: pass an explicit `outputDir` parameter pointing to a writable location.');
  return lines.join('\n');
}

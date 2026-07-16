import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';
import { downloadPaper } from '../../papers/downloader.js';
import * as path from 'path';

export const downloadCommand: SlashCommand = {
  name: 'download',
  description: 'Download a paper PDF by DOI / arXiv ID / PMID / URL',
  usage: '/download <identifier>',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const identifier = args.trim();
    if (!identifier) {
      emit('token', { tokenType: 'Text', text: 'Please provide a paper identifier.\n\nUsage: /download <DOI | arXiv ID | PMID | URL>\n\nExamples:\n  /download 10.1038/s41467-020-15478-4\n  /download arXiv:2201.12345\n  /download https://www.nature.com/articles/s41467-020-15478-4.pdf\n  /download sci-hub.st/10.1016/j.ijhydene.2025.01.033' });
      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: `Downloading **${identifier}**...\n\n` });

    const wsRoot = deps.phaseWriter.getWorkspaceRoot() || '';
    const outputDir = wsRoot ? path.join(wsRoot, '06_References') : '';

    let result;
    try {
      result = await downloadPaper({
        identifier,
        outputDir,
      });
    } catch (e: unknown) {
      result = { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }

    if (signal.aborted) {
      emit('token', { tokenType: 'Text', text: '\n_Download cancelled._' });
      emit('done', {});
      return;
    }

    if (result.ok) {
      const meta = result.meta;
      const title = meta?.title ? `**${meta.title}**` : identifier;
      const details: string[] = [];
      if (meta?.venue) details.push(meta.venue);
      if (meta?.year) details.push(String(meta.year));
      if (meta?.authors?.length) details.push(meta.authors.slice(0, 3).join(', ') + (meta.authors.length > 3 ? ' et al' : ''));
      emit('token', { tokenType: 'Text', text: `Downloaded ${title}\nSource: ${result.source}\nFormat: ${result.format}\nSize: ${result.bytes} bytes\nPath: \`${result.filePath}\`\n${details.length ? '\n' + details.join(' · ') : ''}` });
    } else {
      let msg = `Download failed.\n\n${result.error || 'No source could provide the file.'}`;
      if (result.manualUrls && result.manualUrls.length > 0) {
        msg += '\n\nManual download URLs:\n';
        for (const u of result.manualUrls) {
          msg += `- **${u.label}**: ${u.url}\n`;
        }
      }
      emit('token', { tokenType: 'Text', text: msg });
    }

    emit('done', {});
  },
};
import { defineTool, ok, err } from '@open1s/ezbos';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getTypstLspClient, LspDiagnostic } from '../lsp/typst_lsp.js';

export function createTypstTools(workspaceRoot: string) {
  const typstLint = defineTool(
    'typst_lint',
    'Check Typst file for syntax errors using LSP',
  )
    .required('filePath', 'string', 'Path to the .typ file to lint')
    .handle(async (args) => {
      const filePath = args.filePath as string;
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath);

      if (!fs.existsSync(resolvedPath)) {
        return err(`File not found: ${resolvedPath}`);
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const uri = `file://${resolvedPath.replace(/\\/g, '/')}`;

      try {
        const lsp = await getTypstLspClient(workspaceRoot);
        const diagnostics = await lsp.requestDiagnostics(uri, content, 5000);

        if (diagnostics.length > 0) {
          const formatted = diagnostics.map((d: LspDiagnostic) =>
            `line ${d.range.start.line + 1}:${d.range.start.character + 1} [${severityLabel(d.severity)}] ${d.message}`
          ).join('\n');
          return ok({
            filePath,
            source: 'tinymist-lsp',
            status: 'issues',
            issueCount: diagnostics.length,
            output: formatted,
          });
        }

        return ok({
          filePath,
          source: 'tinymist-lsp',
          status: 'clean',
          output: 'No diagnostic issues found',
        });
      } catch (lspErr: any) {
        console.error('[typst_lint] LSP failed, falling back to CLI:', lspErr.message);

        try {
          const result = execSync(`typst compile "${resolvedPath}"`, {
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 10 * 1024 * 1024,
          });
          return ok({ filePath, source: 'typst-cli', status: 'clean', output: result.trim() || 'Compiled successfully, no errors' });
        } catch (e: any) {
          const errText = e.stdout || e.stderr || e.message || '';
          if (e.status === 1 && errText.includes('error:')) {
            return ok({ filePath, source: 'typst-cli', status: 'issues', output: errText.trim() });
          }
          if (e.code === 127 || errText.includes('command not found')) {
            return err('typst not found. Install: brew install typst');
          }
          return err(`Lint failed (exit ${e.status || e.code}): ${errText.trim()}`);
        }
      }
    });

  const typstLspStatus = defineTool(
    'typst_lsp_status',
    'Check Typst LSP server health. Returns connection status and server info.',
  )
    .handle(async () => {
      try {
        const lsp = await getTypstLspClient(workspaceRoot);
        const isRunning = lsp.isInitialized;
        return ok({
          status: isRunning ? 'connected' : 'starting',
          source: 'tinymist-lsp',
          ready: isRunning,
        });
      } catch (e: any) {
        return err(`LSP not available: ${e.message}`);
      }
    });

  return [typstLint, typstLspStatus];
}

function severityLabel(severity: number): string {
  switch (severity) {
    case 1: return 'error';
    case 2: return 'warning';
    case 3: return 'info';
    case 4: return 'hint';
    default: return 'unknown';
  }
}
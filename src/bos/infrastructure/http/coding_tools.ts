import { defineTool, ok, err } from '@open1s/ezbos';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import { SandboxManager } from '../sandbox.js';
import { isWorkspacePath, isSecretPath, isDangerousCommand } from '../config/workspaceGuard.js';
import { createModuleLogger } from '../logging/logger.js';

const log = createModuleLogger('coding-tools');

const bgProcesses = new Map<string, ChildProcess>();

function killProcessGroup(pid: number, signal: NodeJS.Signals = 'SIGKILL') {
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* already dead */ }
  }
}

/**
 * Kill the background process spawned by the given tool call_id. Background
 * jobs return from the engine immediately, so the engine deregisters their
 * call_id and never forwards a cancel to onCancel; the worker calls this
 * directly as a fallback after publishing the bus cancel.
 */
export function cancelBackgroundJob(callId: string): boolean {
  const bg = bgProcesses.get(callId);
  if (bg && bg.pid) {
    log.debug({ callId, pid: bg.pid }, '[TOOL-STATUS] cancelBackgroundJob killing bg process');
    killProcessGroup(bg.pid);
    bgProcesses.delete(callId);
    return true;
  }
  return false;
}

type BgExitHandler = (toolName: string, pid: number, exitCode: number | null, signal: string | null) => void;
let onBgExit: BgExitHandler = () => {};

export function setOnBgExit(handler: BgExitHandler): void {
  onBgExit = handler;
}

type BgStartHandler = (toolName: string, callId: string, pid: number) => void;
let onBgStart: BgStartHandler = () => {};

export function setOnBgStart(handler: BgStartHandler): void {
  onBgStart = handler;
}

export function createCodingTools(workspaceRoot: string, sandboxEnabled?: boolean) {
  const sandbox = new SandboxManager({ enabled: sandboxEnabled !== false, workspaceRoot });
  // Cap each tool result to ~25K tokens to avoid exceeding LLM context window
  const MAX_TOOL_RESULT_CHARS = 100_000;

  const readFile = defineTool(
    'read_file',
    'Read partial contents of a file with line numbers. Defaults to 200 lines (page). Use startLine/endLine to paginate through large files. Capped at ~25K tokens (100K chars) per read.',
  )
    .required('filePath', 'string', 'Path to the file (relative to workspace root)')
    .param('startLine', 'number', 'Starting line number (1-indexed, default: 1)')
    .param('endLine', 'number', 'Ending line number (default: startLine + 999)')
    .handle(async (args) => {
      try {
        const filePath = path.resolve(workspaceRoot, args.filePath);
        if (!isWorkspacePath(args.filePath, workspaceRoot)) {
          return err('Access denied: file is outside workspace');
        }
        if (isSecretPath(filePath)) {
          return err('Access denied: file is protected');
        }
        if (!fs.existsSync(filePath)) {
          return err(`File not found: ${args.filePath}`);
        }

        const startLine = args.startLine || 1;
        const endLine = args.endLine || (startLine + 199);

        if (startLine < 1) return err('startLine must be >= 1');
        if (endLine < startLine) return err('endLine must be >= startLine');

        const rl = readline.createInterface({
          input: fs.createReadStream(filePath),
          crlfDelay: Infinity
        });

        const lines: string[] = [];
        let currentLine = 0;
        let accumulatedChars = 0;
        let truncated = false;

        for await (const line of rl) {
          currentLine++;
          if (currentLine >= startLine && currentLine <= endLine) {
            const numbered = `${currentLine}: ${line}`;
            accumulatedChars += numbered.length + 1; // +1 for newline
            if (accumulatedChars > MAX_TOOL_RESULT_CHARS) {
              truncated = true;
              rl.close();
              break;
            }
            lines.push(numbered);
          }
          if (currentLine >= endLine) {
            rl.close();
            break;
          }
        }

        let result = lines.join('\n');
        if (truncated) {
          result += `\n... (output truncated at ${MAX_TOOL_RESULT_CHARS} chars, reading stopped at line ${currentLine})`;
        }

        return ok({
          filePath: args.filePath,
          content: result,
          linesShown: `${startLine}-${Math.min(currentLine, endLine)}`,
          truncated,
        });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const writeFile = defineTool(
    'write_file',
    'Create a new file or overwrite an existing file with the given content.',
  )
    .required('filePath', 'string', 'Path to the file (relative to workspace root)')
    .required('content', 'string', 'Content to write to the file')
    .handle((args) => {
      try {
        const filePath = path.resolve(workspaceRoot, args.filePath);
        if (!isWorkspacePath(args.filePath, workspaceRoot)) {
          return err('Access denied: file is outside workspace');
        }
        if (isSecretPath(filePath)) {
          return err('Access denied: file is protected');
        }
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, args.content, 'utf-8');
        return ok({ filePath: args.filePath, bytesWritten: args.content.length, action: 'created' });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const LARGE_FILE_PATCH_BYTES = 1 * 1024 * 1024; // 1MB — prefer apply_patch above this

  function suggestPatch(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > LARGE_FILE_PATCH_BYTES) {
        return `File is ${(stat.size / 1024 / 1024).toFixed(1)}MB — too large for edit_file. Use \`apply_patch\` with a context diff instead: read_file the section, make changes, then apply_patch with a unified diff.`;
      }
    } catch { /* ignore stat errors */ }
    return null;
  }

  const editFile = defineTool(
    'edit_file',
    'Sed-like file edit. Append mode (append=true): append newString to end of file — use for streaming long content section by section (write as you generate, don\'t wait for full content). Line-range mode (startLine+endLine): replace entire range, or if oldString given, find/replace only within those lines. No-range mode (oldString only): global find/replace. For files >1MB, use apply_patch instead.',
  )
    .required('filePath', 'string', 'Path to the file (relative to workspace root)')
    .required('newString', 'string', 'Text to replace with, or content to append when append=true')
    .param('oldString', 'string', 'Exact text to find (required if startLine/endLine not given)')
    .param('startLine', 'number', 'Start line for range-scoped edit (1-indexed)')
    .param('endLine', 'number', 'End line for range-scoped edit (1-indexed, inclusive)')
    .param('replaceAll', 'boolean', 'Replace all occurrences within scope (default: false)')
    .param('append', 'boolean', 'Append newString to end of file (default: false)')
    .handle((args) => {
      try {
        const filePath = path.resolve(workspaceRoot, args.filePath);
        if (!isWorkspacePath(args.filePath, workspaceRoot)) {
          return err('Access denied: file is outside workspace');
        }
        if (isSecretPath(filePath)) {
          return err('Access denied: file is protected');
        }
        if (!fs.existsSync(filePath)) {
          return err(`File not found: ${args.filePath}`);
        }

        const patchSuggestion = suggestPatch(filePath);
        if (patchSuggestion && !args.startLine && !args.endLine && !args.append) {
          // Redirect full-file edits (no line range) to apply_patch for large files
          return err(patchSuggestion);
        }

        if (args.append) {
          // For append, only read last few bytes to check trailing newline
          const stat = fs.statSync(filePath);
          let needsSeparator = true;
          if (stat.size > 0) {
            const fd = fs.openSync(filePath, 'r');
            try {
              const buf = Buffer.alloc(Math.min(stat.size, 1));
              fs.readSync(fd, buf, 0, buf.length, stat.size - 1);
              needsSeparator = buf[0] !== 0x0a; // '\n'
            } finally {
              fs.closeSync(fd);
            }
          }
          const separator = needsSeparator ? '\n' : '';
          fs.writeFileSync(filePath, separator + args.newString, { encoding: 'utf-8', flag: 'a' });
          return ok({ filePath: args.filePath, action: 'append', warning: patchSuggestion || undefined });
        }

        const content = fs.readFileSync(filePath, 'utf-8');

        if (args.startLine !== undefined && args.endLine !== undefined) {
          const lines = content.split('\n');
          const start = args.startLine - 1;
          const end = args.endLine;
          if (start < 0 || end > lines.length || start > end) {
            return err(`Invalid line range: ${args.startLine}-${args.endLine} (file has ${lines.length} lines)`);
          }
          if (args.oldString !== undefined) {
            // sed-like: search oldString within range only
            const rangeContent = lines.slice(start, end).join('\n');
            if (!rangeContent.includes(args.oldString)) {
              return err(`oldString not found in lines ${args.startLine}-${args.endLine}`);
            }
            const replaced = args.replaceAll
              ? rangeContent.split(args.oldString).join(args.newString)
              : rangeContent.replace(args.oldString, args.newString);
            const replacedLines = replaced.split('\n');
            lines.splice(start, end - start, ...replacedLines);
            fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
            return ok({ filePath: args.filePath, action: 'sed_replace', lines: `${args.startLine}-${args.endLine}`, occurrences: args.replaceAll ? 'all' : 'first' });
          }
          // Replace entire range
          const newLines = args.newString === '' ? [] : args.newString.split('\n');
          lines.splice(start, end - start, ...newLines);
          fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
          return ok({ filePath: args.filePath, action: 'replaced_lines', lines: `${args.startLine}-${args.endLine}` });
        } else if (args.oldString !== undefined) {
          if (!content.includes(args.oldString)) {
            return err('oldString not found in file. Check exact whitespace and content.');
          }
          const newContent = args.replaceAll
            ? content.split(args.oldString).join(args.newString)
            : content.replace(args.oldString, args.newString);
          fs.writeFileSync(filePath, newContent, 'utf-8');
          return ok({ filePath: args.filePath, replaced: args.replaceAll ? 'all' : 'first' });
        } else {
          return err('Must provide oldString, startLine+endLine (+ optional oldString for sed-like find/replace), or append=true.');
        }
      } catch (e: any) {
        return err(e.message);
      }
    });

  const runningProcesses = new Map<string, ChildProcess>();

  /**
   * Spawn a foreground command. Captures stdout/stderr. The child is spawned
   * detached so it has its own process group, allowing the whole tree to be
   * killed by group pid. If timeoutMs is given, the group is SIGTERM'd at the
   * timeout, escalated to SIGKILL after a 3s grace period, and a fail-safe
   * resolution after a further 2s. Resolves on exit; rejects on spawn error.
   */
  function spawnCapture(
    callId: string,
    command: string,
    cwd: string,
    env?: Record<string, string | undefined>,
    timeoutMs?: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [], {
        cwd,
        shell: true,
        env: env ? { ...process.env, ...env } : undefined,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let timedOut = false;

      const killGroup = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        killProcessGroup(child.pid, signal);
      };

      let timeoutTimer: NodeJS.Timeout | undefined;
      let graceTimer: NodeJS.Timeout | undefined;
      let failSafeTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        runningProcesses.delete(callId);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (graceTimer) clearTimeout(graceTimer);
        if (failSafeTimer) clearTimeout(failSafeTimer);
      };

      const settleTimeout = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          stdout: Buffer.concat(stdout).toString('utf-8'),
          stderr: Buffer.concat(stderr).toString('utf-8'),
          exitCode: null,
          signal: 'SIGTERM',
          timedOut: true,
        });
      };

      if (timeoutMs !== undefined) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          killGroup('SIGTERM');
          // Grace period: escalate to SIGKILL after 3s.
          graceTimer = setTimeout(() => {
            killGroup('SIGKILL');
            // Fail-safe: resolve even if the process refuses to die.
            failSafeTimer = setTimeout(settleTimeout, 2000);
          }, 3000);
        }, timeoutMs);
      }

      child.stdout!.on('data', (chunk: Buffer) => { stdout.push(chunk); });
      child.stderr!.on('data', (chunk: Buffer) => { stderr.push(chunk); });

      child.on('error', (error) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      });

      child.on('close', (exitCode, signal) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({
            stdout: Buffer.concat(stdout).toString('utf-8'),
            stderr: Buffer.concat(stderr).toString('utf-8'),
            exitCode: exitCode ?? -1,
            signal: signal ?? null,
            timedOut,
          });
        }
      });

      runningProcesses.set(callId, child);
    });
  }

  const bash = defineTool(
    'bash',
    'Execute a shell command in the workspace directory. Returns stdout and stderr. Commands ending with "&" run in background (detached, killed on cancel). Supports cancellation.',
  )
    .required('command', 'string', 'Shell command to execute')
    .param('timeout', 'number', 'Max seconds to wait for a foreground command (5-3600, default 600). Ignored for background commands.')
    .cancelable()
    .onCancel((callId) => {
      const proc = runningProcesses.get(callId);
      if (proc && proc.pid) killProcessGroup(proc.pid);
      runningProcesses.delete(callId);
      const bg = bgProcesses.get(callId);
      if (bg && bg.pid) killProcessGroup(bg.pid);
      bgProcesses.delete(callId);
    })
    .handle(async (args) => {
      try {
        if (isDangerousCommand(args.command)) {
          return err('Command blocked: potentially dangerous operation');
        }
        const isBackground = /&\s*$/.test(args.command.trim());
        const cmd = isBackground ? args.command.trim().replace(/&\s*$/, '').trim() : args.command;
        const { command: safeCommand } = sandbox.wrapCommand(cmd);
        const env = sandbox.isEnabled() ? sandbox.getRestrictedEnv() : undefined;
        const callId = (args as any).__call_id__ || 'unknown';
        const timeoutSec = Math.min(3600, Math.max(5, args.timeout ?? 600));
        const timeoutMs = timeoutSec * 1000;

        if (isBackground) {
          const child = spawn(safeCommand, [], {
            cwd: workspaceRoot,
            shell: true,
            env: env ? { ...process.env, ...env } : undefined,
            stdio: 'ignore',
            detached: true,
          });
          child.unref();
          bgProcesses.set(callId, child);
          if (child.pid) {
            log.debug({ callId, pid: child.pid }, '[TOOL-STATUS] bash background job spawned');
            onBgStart('bash', callId, child.pid);
          }
          child.on('exit', (exitCode, signal) => {
            if (bgProcesses.get(callId) === child) bgProcesses.delete(callId);
            if (child.pid) onBgExit('bash', child.pid, exitCode, signal);
          });
          return ok({ pid: child.pid, background: true });
        }

        const result = await spawnCapture(callId, safeCommand, workspaceRoot, env, timeoutMs);
        if (result.timedOut) {
          const partial = result.stdout + result.stderr;
          const tail = partial ? '\nPartial output:\n' + partial.slice(-4000) : '';
          return err(`Command timed out after ${timeoutSec}s${tail}`);
        }
        if (result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
          return err('Command cancelled');
        }
        return ok({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const listDir = defineTool(
    'list_dir',
    'List contents of a directory. Shows files and subdirectories.',
  )
    .required('dirPath', 'string', 'Path to directory (relative to workspace root, default: ".")')
    .handle((args) => {
      try {
        const dirPath = path.resolve(workspaceRoot, args.dirPath || '.');
        if (!isWorkspacePath(args.dirPath || '.', workspaceRoot)) {
          return err('Access denied: directory is outside workspace');
        }
        if (!fs.existsSync(dirPath)) {
          return err(`Directory not found: ${args.dirPath || '.'}`);
        }
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
        return ok({ dirPath: args.dirPath || '.', items });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const grepSearch = defineTool(
    'grep_search',
    'Search file contents using regex. Returns matching lines with file and line numbers.',
  )
    .required('pattern', 'string', 'Regex pattern to search for')
    .param('include', 'string', 'File pattern to include (e.g., "*.ts", "*.{ts,tsx}")')
    .param('path', 'string', 'Directory to search in (default: workspace root)')
    .param('ignoreCase', 'boolean', 'Case-insensitive search (default: false)')
    .handle((args) => {
      try {
        const searchPath = args.path ? path.resolve(workspaceRoot, args.path) : workspaceRoot;
        if (args.path && !isWorkspacePath(args.path, workspaceRoot)) {
          return err('Access denied: path is outside workspace');
        }
        const rgArgs = ['--json', '--no-heading', '--line-number'];
        if (args.include) rgArgs.push('--glob', args.include);
        if (args.ignoreCase) rgArgs.push('--ignore-case');
        rgArgs.push(args.pattern, searchPath);
        const result = spawnSync('rg', rgArgs, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, cwd: workspaceRoot });
        const matches: any[] = [];
        for (const line of (result.stdout || '').trim().split('\n').filter(Boolean)) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'match') {
              matches.push({
                file: parsed.data.path.text,
                line: parsed.data.line_number,
                text: parsed.data.submatches[0]?.match.text || '',
              });
            }
          } catch { /* skip invalid JSON */ }
        }
        return ok({ pattern: args.pattern, matchCount: matches.length, matches: matches.slice(0, 100), truncated: matches.length > 100 });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const globFiles = defineTool(
    'glob_files',
    'Find files matching a glob pattern (supports **, braces, and gitignore). Returns list of file paths.',
  )
    .required('pattern', 'string', 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx", "{*.ts,*.js}")')
    .handle((args) => {
      try {
        const result = spawnSync('rg', ['--files', '--no-require-git', '-g', args.pattern], { encoding: 'utf-8', cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
        const files = (result.stdout || '').trim().split('\n').filter(Boolean);
        return ok({ pattern: args.pattern, fileCount: files.length, files: files.slice(0, 200) });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const astGrep = defineTool(
    'ast_grep',
    'Search code using AST patterns. Returns matches with file, line, and matched code. Use for structural code search.',
  )
    .required('pattern', 'string', 'AST pattern to match (e.g., "const $X = $Y" or "function $NAME($$$ARGS) { $$$ }")')
    .required('lang', 'string', 'Programming language (typescript, javascript, python, rust, go, java, etc.)')
    .param('path', 'string', 'File or directory to search (default: workspace root)')
    .param('rewrite', 'string', 'Optional rewrite template (e.g., "let $X = $Y")')
    .handle((args) => {
      try {
        const searchPath = args.path ? path.resolve(workspaceRoot, args.path) : workspaceRoot;
        if (args.path && !isWorkspacePath(args.path, workspaceRoot)) {
          return err('Access denied: path is outside workspace');
        }
        const sgArgs = ['run', '--pattern', args.pattern, '--lang', args.lang, '--json', 'compact'];
        if (args.rewrite) sgArgs.push('--rewrite', args.rewrite);
        sgArgs.push(searchPath);
        const result = spawnSync('sg', sgArgs, { encoding: 'utf-8', cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
        if (result.status !== 0) {
          return ok({ pattern: args.pattern, lang: args.lang, matchCount: 0, matches: [] });
        }
        const matches = JSON.parse(result.stdout || '[]');
        const formatted = matches.map((m: any) => ({
          file: m.file,
          line: m.line,
          matched: m.matched,
          replacement: m.replacement || null,
        }));
        return ok({ pattern: args.pattern, lang: args.lang, matchCount: formatted.length, matches: formatted.slice(0, 100) });
      } catch (e: any) {
        return err(e.message || 'ast-grep execution failed');
      }
    });

  const astEdit = defineTool(
    'ast_edit',
    'Rewrite code using AST patterns. Permanently modifies files in the workspace. Use for structural refactoring.',
  )
    .required('pattern', 'string', 'AST pattern to match')
    .required('rewrite', 'string', 'Rewrite template')
    .required('lang', 'string', 'Programming language')
    .param('path', 'string', 'File or directory to edit (default: workspace root)')
    .handle((args) => {
      try {
        const editPath = args.path ? path.resolve(workspaceRoot, args.path) : workspaceRoot;
        if (args.path && !isWorkspacePath(args.path, workspaceRoot)) {
          return err('Access denied: path is outside workspace');
        }
        const result = spawnSync('sg', ['rw', '--pattern', args.pattern, '--rewrite', args.rewrite, '--lang', args.lang, editPath], { encoding: 'utf-8', cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
        return ok({ result: (result.stdout || '').trim() || 'Successfully applied rewrites' });
      } catch (e: any) {
        return err(e.message || 'ast-grep rewrite failed');
      }
    });

  const applyPatch = defineTool(
    'apply_patch',
    'Apply a unified diff patch to a file. PREFERRED for files >1MB (the diff is far smaller than full content). Generate a context diff (diff -u old new) with surrounding lines. For large files, read_file the section first, construct the change, then apply the patch.',
  )
    .required('filePath', 'string', 'Path to the file to patch (relative to workspace root)')
    .required('patch', 'string', 'The unified diff patch content')
    .handle((args) => {
      try {
        const filePath = path.resolve(workspaceRoot, args.filePath);
        if (!isWorkspacePath(args.filePath, workspaceRoot)) {
          return err('Access denied: file is outside workspace');
        }
        if (isSecretPath(filePath)) {
          return err('Access denied: file is protected');
        }
        if (!fs.existsSync(filePath)) {
          return err(`File not found: ${args.filePath}`);
        }

        const patchContent = args.patch.endsWith('\n') ? args.patch : args.patch + '\n';

        const result = spawnSync('patch', ['-t', filePath], {
          cwd: workspaceRoot,
          input: patchContent,
          encoding: 'utf-8',
          timeout: 10000,
          maxBuffer: 10 * 1024 * 1024,
        });

        if (result.status !== 0) {
          const errorMessage = (result.stderr || result.stdout || '').trim();
          return err(`Patch failed (exit code ${result.status}):\n${errorMessage}`);
        }
        return ok({ filePath: args.filePath, result: (result.stdout || '').trim(), action: 'patched' });
      } catch (e: any) {
        return err(e.message);
      }
    });

  return [
    readFile,
    writeFile,
    editFile,
    bash,
    listDir,
    grepSearch,
    globFiles,
    astGrep,
    astEdit,
    applyPatch,
  ];
}

import { defineTool, ok, err } from '@open1s/ezbos';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as readline from 'readline';

const DANGEROUS_PATTERNS = [
  /^rm\s+-rf\s+\/$/,
  /^rm\s+-rf\s+\//,
  /^dd\s+if=/,
  /^mkfs/,
  /^:(){:|:&};:/,
  /^>\s*\/dev\/sda/,
  /^chmod\s+-R\s+777\s+\/$/,
];

function isWorkspacePath(filePath: string, workspaceRoot: string): boolean {
  const resolved = path.resolve(workspaceRoot, filePath);
  return resolved.startsWith(workspaceRoot);
}

function isDangerousCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(trimmed));
}

export function createCodingTools(workspaceRoot: string) {
  const readFile = defineTool(
    'read_file',
    'Read partial or full contents of a file with line numbers. Defaults to reading up to 1000 lines.',
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
        if (!fs.existsSync(filePath)) {
          return err(`File not found: ${args.filePath}`);
        }
        
        const startLine = args.startLine || 1;
        const endLine = args.endLine || (startLine + 999);
        
        if (startLine < 1) return err('startLine must be >= 1');
        if (endLine < startLine) return err('endLine must be >= startLine');

        const rl = readline.createInterface({
          input: fs.createReadStream(filePath),
          crlfDelay: Infinity
        });

        const lines: string[] = [];
        let currentLine = 0;

        for await (const line of rl) {
          currentLine++;
          if (currentLine >= startLine && currentLine <= endLine) {
            lines.push(`${currentLine}: ${line}`);
          }
          if (currentLine >= endLine) {
            rl.close();
            break;
          }
        }

        return ok({
          filePath: args.filePath,
          content: lines.join('\n'),
          linesShown: `${startLine}-${Math.min(currentLine, endLine)}`,
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

  const editFile = defineTool(
    'edit_file',
    'Apply an edit to a file. Supports exact search-and-replace (using oldString) or line-range replacement (using startLine and endLine).',
  )
    .required('filePath', 'string', 'Path to the file (relative to workspace root)')
    .required('newString', 'string', 'Text to replace with')
    .param('oldString', 'string', 'Exact text to find and replace (if not using line numbers)')
    .param('startLine', 'number', 'Starting line number for line-based replace (1-indexed)')
    .param('endLine', 'number', 'Ending line number for line-based replace (1-indexed, inclusive)')
    .param('replaceAll', 'boolean', 'Replace all occurrences of oldString (default: false)')
    .handle((args) => {
      try {
        const filePath = path.resolve(workspaceRoot, args.filePath);
        if (!isWorkspacePath(args.filePath, workspaceRoot)) {
          return err('Access denied: file is outside workspace');
        }
        if (!fs.existsSync(filePath)) {
          return err(`File not found: ${args.filePath}`);
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        
        if (args.startLine !== undefined && args.endLine !== undefined) {
          const lines = content.split('\n');
          const start = args.startLine - 1;
          const end = args.endLine;
          if (start < 0 || end > lines.length || start > end) {
            return err(`Invalid line range: ${args.startLine}-${args.endLine} (file has ${lines.length} lines)`);
          }
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
          return err('Must provide either oldString or both startLine and endLine.');
        }
      } catch (e: any) {
        return err(e.message);
      }
    });

  const bash = defineTool(
    'bash',
    'Execute a shell command in the workspace directory. Returns stdout and stderr.',
  )
    .required('command', 'string', 'Shell command to execute')
    .param('timeout', 'number', 'Timeout in milliseconds (default: 30000)')
    .handle((args) => {
      try {
        if (isDangerousCommand(args.command)) {
          return err('Command blocked: potentially dangerous operation');
        }
        const timeout = args.timeout || 30000;
        const result = execSync(args.command, {
          cwd: workspaceRoot,
          timeout,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        return ok({ stdout: result, exitCode: 0 });
      } catch (e: any) {
        if (e.signal === 'SIGTERM') {
          return err(`Command timed out after ${args.timeout || 30000}ms`);
        }
        return ok({ stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.status || 1 });
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
        let cmd = `rg --json --no-heading --line-number "${args.pattern}"`;
        if (args.include) cmd += ` --glob "${args.include}"`;
        if (args.ignoreCase) cmd += ' --ignore-case';
        cmd += ` "${searchPath}"`;
        const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, cwd: workspaceRoot });
        const matches: any[] = [];
        for (const line of output.trim().split('\n').filter(Boolean)) {
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
        return ok({ pattern: args.pattern, matchCount: matches.length, matches: matches.slice(0, 100) });
      } catch (e: any) {
        if (e.status === 1) return ok({ pattern: args.pattern, matchCount: 0, matches: [] });
        return err(e.message);
      }
    });

  const globFiles = defineTool(
    'glob_files',
    'Find files matching a glob pattern. Returns list of file paths.',
  )
    .required('pattern', 'string', 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx")')
    .handle((args) => {
      try {
        const cmd = `find . -path "./node_modules" -prune -o -path "./.git" -prune -o -name "${args.pattern.replace(/\*\*/g, '*')}" -print`;
        const output = execSync(cmd, { encoding: 'utf-8', cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
        const files = output.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
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
        let cmd = `sg run --pattern "${args.pattern.replace(/"/g, '\\"')}" --lang ${args.lang} --json compact`;
        if (args.rewrite) cmd += ` --rewrite "${args.rewrite.replace(/"/g, '\\"')}"`;
        cmd += ` "${searchPath}"`;
        const output = execSync(cmd, { encoding: 'utf-8', cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
        const matches = JSON.parse(output || '[]');
        const formatted = matches.map((m: any) => ({
          file: m.file,
          line: m.line,
          matched: m.matched,
          replacement: m.replacement || null,
        }));
        return ok({ pattern: args.pattern, lang: args.lang, matchCount: formatted.length, matches: formatted.slice(0, 100) });
      } catch (e: any) {
        if (e.status === 1) return ok({ pattern: args.pattern, lang: args.lang, matchCount: 0, matches: [] });
        return err(e.message || 'ast-grep execution failed');
      }
    });

  const applyPatch = defineTool(
    'apply_patch',
    'Apply a unified diff patch to a file. Useful for applying complex multi-line changes with context.',
  )
    .required('filePath', 'string', 'Path to the file to patch (relative to workspace root)')
    .required('patch', 'string', 'The unified diff patch content')
    .handle((args) => {
      try {
        const filePath = path.resolve(workspaceRoot, args.filePath);
        if (!isWorkspacePath(args.filePath, workspaceRoot)) {
          return err('Access denied: file is outside workspace');
        }
        if (!fs.existsSync(filePath)) {
          return err(`File not found: ${args.filePath}`);
        }
        
        // Ensure patch has newlines at the end
        const patchContent = args.patch.endsWith('\n') ? args.patch : args.patch + '\n';
        
        const cmd = `patch -t "${filePath}"`;
        const result = execSync(cmd, {
          cwd: workspaceRoot,
          input: patchContent,
          encoding: 'utf-8',
          timeout: 10000,
        });
        
        return ok({ filePath: args.filePath, result: result.trim(), action: 'patched' });
      } catch (e: any) {
        let errorMessage = e.message;
        if (e.stdout || e.stderr) {
          errorMessage = `${e.stdout || ''}\n${e.stderr || ''}`.trim();
        }
        return err(`Patch failed (exit code ${e.status}):\n${errorMessage}`);
      }
    });

  const execTool = defineTool(
    'exec_tool',
    'Execute a command with provided arguments. Useful for running binaries or scripts with structured arguments.',
  )
    .required('command', 'string', 'Command or binary to execute')
    .required('args', 'array', 'List of arguments to pass to the command')
    .param('timeout', 'number', 'Timeout in milliseconds (default: 30000)')
    .handle((args) => {
      try {
        const fullCommand = `${args.command} ${args.args.map((a: string) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`;
        if (isDangerousCommand(fullCommand)) {
          return err('Command blocked: potentially dangerous operation');
        }
        const timeout = args.timeout || 30000;
        const result = execSync(fullCommand, {
          cwd: workspaceRoot,
          timeout,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        });
        return ok({ stdout: result, exitCode: 0 });
      } catch (e: any) {
        if (e.signal === 'SIGTERM') {
          return err(`Command timed out after ${args.timeout || 30000}ms`);
        }
        return ok({ stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.status || 1 });
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
    applyPatch,
    execTool,
  ];
}

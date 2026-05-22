import { defineTool, ok, err } from '@open1s/ezbos';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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
    'Read contents of a file with line numbers. Use this to examine code, configs, or any text file.',
  )
    .required('filePath', 'string', 'Path to the file (relative to workspace root)')
    .param('startLine', 'number', 'Starting line number (1-indexed, default: 1)')
    .param('endLine', 'number', 'Ending line number (default: read all)')
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
        const lines = content.split('\n');
        const start = (args.startLine || 1) - 1;
        const end = args.endLine ? Math.min(args.endLine, lines.length) : lines.length;
        const sliced = lines.slice(start, end);
        const numbered = sliced.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
        return ok({
          filePath: args.filePath,
          totalLines: lines.length,
          content: numbered,
          linesShown: `${start + 1}-${end}`,
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
    'Apply a search-and-replace edit to a file. Use exact text from the file for oldString.',
  )
    .required('filePath', 'string', 'Path to the file (relative to workspace root)')
    .required('oldString', 'string', 'Exact text to find and replace (must match exactly)')
    .required('newString', 'string', 'Text to replace with')
    .param('replaceAll', 'boolean', 'Replace all occurrences (default: false)')
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
        if (!content.includes(args.oldString)) {
          return err('oldString not found in file. Check exact whitespace and content.');
        }
        const newContent = args.replaceAll
          ? content.split(args.oldString).join(args.newString)
          : content.replace(args.oldString, args.newString);
        fs.writeFileSync(filePath, newContent, 'utf-8');
        return ok({ filePath: args.filePath, replaced: args.replaceAll ? 'all' : 'first' });
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
    execTool,
  ];
}

import * as fs from 'fs';
import * as path from 'path';

const DANGEROUS_PATTERNS = [
  /^rm\s+-rf?\s+\/$/,
  /^rm\s+-rf?\s+\//,
  /^rm\s+-[rf]+\s+\//,
  /^rm\s+-[rf]+\s+\/$/,
  /^dd\s+if=/,
  /^mkfs/,
  /^:(){:|:&};:/,
  /^>\s*\/dev\/(sda|sdb|sdc|nvme|mmcblk)/,
  /^chmod\s+-R\s+777\s+\/$/,
  /^chmod\s+-R?\s+777\s+\//,
  /^(sudo|doas)\s+/,
  /^(curl|wget)\s+.+[\|;]\s*(sh|bash|zsh)\b/,
  /^python[23]?\s+-c\s+['"].*import.*os.*system/,
  /^eval\s+/,
  /^source\s+\/dev\/stdin/,
];

const SECRET_PATTERNS = [
  /[/\\]\.ssh[/\\]/,
  /[/\\]\.aws[/\\]/,
  /[/\\]\.config[/\\]gcloud[/\\]/,
  /[/\\]\.config[/\\]gh[/\\]/,
  /[/\\](?:^|[\\/])\.env(?:\.[a-zA-Z]+)?$/,
  /[/\\]id_rsa$/,
  /[/\\]id_ed25519$/,
  /[/\\]known_hosts$/,
  /[/\\]credentials?$/,
];

export function isDangerousCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(trimmed));
}

export function isSecretPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return SECRET_PATTERNS.some(pattern => pattern.test(normalized));
}

export function isWorkspacePath(filePath: string, workspaceRoot: string): boolean {
  const resolved = path.resolve(workspaceRoot, filePath);
  const normalizedRoot = path.resolve(workspaceRoot) + path.sep;
  return resolved === path.resolve(workspaceRoot) || resolved.startsWith(normalizedRoot);
}

export function resolveInWorkspace(
  filePath: string,
  workspaceRoot: string,
): { resolved: string; ok: true } | { ok: false; error: string } {
  try {
    const wsRoot = fs.realpathSync(path.resolve(workspaceRoot));
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(wsRoot, filePath);

    const resolved = resolveRealSafe(absPath);
    const normalizedRoot = wsRoot + path.sep;

    if (resolved === wsRoot || resolved.startsWith(normalizedRoot)) {
      return { resolved, ok: true };
    }

    return {
      ok: false,
      error: `PERMISSION_DENIED: Path "${filePath}" resolves to "${resolved}" which is outside the workspace "${wsRoot}"`,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: `Invalid path "${filePath}": ${e.message}`,
    };
  }
}

function resolveRealSafe(absPath: string): string {
  try {
    return fs.realpathSync(absPath);
  } catch {
    const parent = path.dirname(absPath);
    try {
      const realParent = fs.realpathSync(parent);
      return path.join(realParent, path.basename(absPath));
    } catch {
      return absPath;
    }
  }
}

export const TOOL_FILE_PARAMS: Record<string, string[]> = {
  read_file: ['filePath'],
  write_file: ['filePath'],
  edit_file: ['filePath'],
  apply_patch: ['filePath'],
  list_dir: ['dirPath'],
  grep_search: ['path'],
  ast_grep: ['path'],
  ast_edit: ['path'],
  typst_lint: ['filePath'],
  papers_download: ['outputDir'],
  papers_list_downloaded: ['outputDir'],
};

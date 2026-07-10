import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SandboxOptions {
  enabled: boolean;
  workspaceRoot?: string;
}

interface SandboxWrapper {
  prefixArgs: string[];
  wrapperType: 'sandbox-exec' | 'bwrap' | 'prlimit' | 'none';
}

function detectOS(): 'macos' | 'linux' | 'windows' | 'other' {
  const p = process.platform;
  if (p === 'darwin') return 'macos';
  if (p === 'linux') return 'linux';
  if (p === 'win32') return 'windows';
  return 'other';
}

function findWrapper(): SandboxWrapper {
  try {
    if (detectOS() === 'macos') {
      const result = execSync('which sandbox-exec 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (result) return { prefixArgs: [result], wrapperType: 'sandbox-exec' };
    }
    if (detectOS() === 'linux') {
      const result = execSync('which bwrap 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (result) return { prefixArgs: [result], wrapperType: 'bwrap' };
    }
  } catch {
    // wrapper not found
  }
  return { prefixArgs: [], wrapperType: 'none' };
}

function generateSeatbeltProfile(workspaceRoot: string): string {
  const wr = workspaceRoot || process.cwd();
  const tmpDir = os.tmpdir();
  return [
    '(version 1)',
    '(deny default)',
    `(allow file-read* (literal "${wr}") (subpath "${wr}"))`,
    `(allow file-write* (subpath "${wr}") (subpath "${tmpDir}"))`,
    '(allow process-exec (subpath "/bin") (subpath "/usr/bin") (subpath "/usr/local/bin"))',
    '(allow sysctl-read)',
    '(allow distributed-notification-post)',
    '(allow signal (target self))',
    '(import "system.sb")',
  ].join('\n');
}

function generateBubblewrapArgs(
  command: string,
  workspaceRoot: string,
): string[] {
  const wr = workspaceRoot || process.cwd();
  const tmpDir = os.tmpdir();
  const bindMounts = [
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--bind', wr, wr,
    '--bind', tmpDir, tmpDir,
    '--proc', '/proc',
    '--dev', '/dev',
  ];
  const args: string[] = [
    '--unshare-all',
    '--share-net',
    '--die-with-parent',
    '--setenv', 'PATH', '/usr/bin:/bin',
  ];
  const mounts: string[] = [];
  for (const m of bindMounts) {
    mounts.push(m);
  }
  args.push(...mounts, '--', '/bin/sh', '-c', command);
  return args;
}

export function getResourceLimits(): Record<string, number> {
  return {
    maxProcesses: 64,
    maxFileSize: 100 * 1024 * 1024,
    maxCpuTime: 60,
  };
}

export function detectSandboxType(): 'sandbox-exec' | 'bwrap' | 'none' {
  try {
    if (detectOS() === 'macos') {
      const result = execSync('which sandbox-exec 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (result) return 'sandbox-exec';
    }
    if (detectOS() === 'linux') {
      const result = execSync('which bwrap 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (result) return 'bwrap';
    }
  } catch { }
  return 'none';
}

export class SandboxManager {
  private enabled: boolean;
  private wrapper: SandboxWrapper;
  private workspaceRoot: string;
  private limits = getResourceLimits();

  constructor(options: SandboxOptions) {
    this.enabled = options.enabled;
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.wrapper = findWrapper();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getOsType(): string {
    return detectOS();
  }

  wrapCommand(command: string): { command: string; timeout: number } {
    if (!this.enabled) return { command, timeout: 30000 };

    const osType = detectOS();

    if (osType === 'macos' && this.wrapper.wrapperType === 'sandbox-exec') {
      const profile = generateSeatbeltProfile(this.workspaceRoot);
      const profilePath = path.join(os.tmpdir(), `trinno-sandbox-${Date.now()}.sb`);
      try {
        fs.writeFileSync(profilePath, profile, 'utf-8');
        setTimeout(() => {
          try { fs.unlinkSync(profilePath); } catch { }
        }, 60000);
      } catch {
        return { command, timeout: 30000 };
      }
      const wrapped = `sandbox-exec -f '${profilePath}' /bin/sh -c '${command.replace(/'/g, "'\\''")}'`;
      return { command: wrapped, timeout: 60000 };
    }

    if (osType === 'linux' && this.wrapper.wrapperType === 'bwrap') {
      const bwrapArgs = generateBubblewrapArgs(command, this.workspaceRoot);
      const wrapped = `bwrap ${bwrapArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
      return { command: wrapped, timeout: 60000 };
    }

    return { command, timeout: 30000 };
  }

  getSpawnOptions(): Record<string, any> {
    if (!this.enabled) return {};
    return { maxBuffer: 1024 * 1024 };
  }

  getRestrictedEnv(): Record<string, string | undefined> {
    return {
      PATH: '/usr/bin:/bin:/usr/local/bin',
      HOME: os.homedir(),
      TMPDIR: os.tmpdir(),
      USER: process.env.USER || '',
      NODE_NO_WARNINGS: '1',
    };
  }
}

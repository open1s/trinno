import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as jsbos from '@open1s/jsbos';
import { Writable } from 'stream';

const RE_STACK = /at\s+(?:(?:\S+)\s+)?\(?(.+?):(\d+):(\d+)\)?/;

function getCaller(): { file: string; line: number } | null {
  const stack = new Error().stack?.split('\n');
  if (!stack) return null;
  for (const frame of stack) {
    const m = frame.match(RE_STACK);
    if (!m) continue;
    const fp = m[1] || '';
    const bn = fp.split('/').pop() || '';
    if (!bn.endsWith('.ts') && !bn.endsWith('.js')) continue;
    if (bn === 'logger.ts' || bn === 'logger.js') continue;
    if (fp.includes('node_modules') || fp.includes('pino')) continue;
    return { file: bn, line: parseInt(m[2] || '0', 10) };
  }
  return null;
}

let _rootLogger: pino.Logger | null = null;

function resolveLogDir(): string {
  const envDir = process.env['TRINNO_LOG_DIR'];
  if (envDir) return envDir;

  const wsRoot: string | undefined = (globalThis as any).__TRP_WORKSPACE_ROOT;
  if (wsRoot) {
    const wsLogDir = path.join(wsRoot, '.bos', 'logs');
    return wsLogDir;
  }

  return path.join(os.homedir(), '.trinno', 'logs');
}

function resolveLogFile(): string {
  const dir = resolveLogDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    const fallback = path.join(os.tmpdir(), 'trinno-logs');
    fs.mkdirSync(fallback, { recursive: true });
    return path.join(fallback, 'trinno.log');
  }
  return path.join(dir, 'trinno.log');
}

function resolveLevel(): string {
  try {
    const loader = new jsbos.ConfigLoader();
    loader.discover();
    const config = JSON.parse(loader.loadSync());
    return config?.logging?.level || process.env['TRINNO_LOG_LEVEL'] || 'error';
  } catch {
    return process.env['TRINNO_LOG_LEVEL'] || 'error';
  }
}

function shouldLogToConsole(): boolean {
  const envForce = process.env['TRINNO_LOG_CONSOLE'];
  if (envForce === '1' || envForce === 'true') return true;
  if (envForce === '0' || envForce === 'false') return false;
  try {
    const loader = new jsbos.ConfigLoader();
    loader.discover();
    const config = JSON.parse(loader.loadSync());
    if (config?.logging?.console !== undefined) return config.logging.console;
    return true;
  } catch {
    return true;
  }
}

const _hostname = os.hostname();
const _pid = process.pid;

function syslogLine(line: string): string {
  try {
    const o = JSON.parse(line);
    const sev: Record<string, number> = { trace: 7, debug: 7, info: 6, warn: 4, error: 3, fatal: 2 };
    const pri = 14 * 8 + (sev[o.level] ?? 7);
    const d = new Date(o.time);
    const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
    const ts = `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
    const tag = o.module || o.name || 'trinno';
    const extras: string[] = [];
    if (o.file && o.line) extras.push(`${o.file}:${o.line}`);
    if (o.msgType) extras.push(`msgType=${o.msgType}`);
    if (o.config) extras.push(`config=${JSON.stringify(o.config)}`);
    if (o.effectiveModel) extras.push(`model=${o.effectiveModel}`);
    const extraStr = extras.length ? ` [${extras.join(' ')}]` : '';
    return `<${pri}>${ts} ${tag}[${_pid}]:${extraStr} ${o.msg || o.message || ''}`;
  } catch {
    return line;
  }
}

function syslogify(dest: any): Writable {
  let buf = '';
  return new Writable({
    write(chunk: Buffer, _enc: any, cb: Function) {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const ln of lines) {
        if (!ln.trim()) continue;
        dest.write(syslogLine(ln) + '\n');
      }
      cb();
    },
  } as any);
}

export function getLogger(): pino.Logger {
  if (_rootLogger) return _rootLogger;

  const logFile = resolveLogFile();
  const level = resolveLevel();

  const fileDest = pino.destination({
    dest: logFile,
    sync: true,
    mkdir: true,
    append: true,
  });

  const stderrDest = pino.destination({
    dest: 2,
    sync: true,
  });

  _rootLogger = pino(
    {
      level,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      mixin() {
        const c = getCaller();
        return c ? { file: c.file, line: c.line } : {};
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream([
      { stream: syslogify(fileDest), level: 'trace' },
      ...(shouldLogToConsole() ? [{ stream: syslogify(stderrDest), level: 'trace' }] : []),
    ]),
  );

  _rootLogger.info({ logFile, level }, 'logger initialized');
  return _rootLogger;
}

export function createModuleLogger(name: string): pino.Logger {
  return getLogger().child({ module: name });
}

export function setLogLevel(level: string): void {
  getLogger().level = level;
}

export function closeLogger(): void {
  if (_rootLogger) {
    _rootLogger.flush();
    _rootLogger = null;
  }
}
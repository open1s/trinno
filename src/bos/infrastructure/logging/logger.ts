import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as jsbos from '@open1s/jsbos';

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
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream([
      { stream: fileDest, level: 'trace' },
      ...(shouldLogToConsole() ? [{ stream: stderrDest, level: 'trace' }] : []),
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
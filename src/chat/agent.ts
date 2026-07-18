import * as childProcess from 'child_process';
import * as nodePath from 'path';
import { EventEmitter } from 'events';
import type { ExtToWebViewMessage } from './messages';
import { getChatConfig } from './settings';
import { DEFAULT_TOOL_PERMISSIONS } from '../bos/infrastructure/config/toolPermissions';
import { extractNotebookContext, insertCellAt, undoLastInsert, formatContextForPrompt } from './context';
import { createModuleLogger } from '../bos/infrastructure/logging/logger';

const log = createModuleLogger('chat-agent');

interface InsertedCell {
  notebookUri: string;
  cellIndex: number;
  timestamp: number;
}

type TokenCallback = (msg: ExtToWebViewMessage) => void;

function buildTokenMsg(raw: any): ExtToWebViewMessage {
  return {
    type: 'token' as const,
    role: 'assistant' as const,
    tokenType: raw.tokenType,
    text: raw.text,
    ...(raw.args !== undefined ? { args: raw.args } : {}),
    ...(raw.toolId !== undefined ? { toolId: raw.toolId } : {}),
    ...(raw.promptTokens !== undefined ? { promptTokens: raw.promptTokens } : {}),
    ...(raw.completionTokens !== undefined ? { completionTokens: raw.completionTokens } : {}),
    ...(raw.totalTokens !== undefined ? { totalTokens: raw.totalTokens } : {}),
  };
}

type DoneCallback = (data?: any) => void;
type ApprovalCallback = (id: string, toolName: string, args: Record<string, unknown>, metadata?: { description: string; dangerous: boolean; category: string }, bashIntent?: { action: string; target: string; risk: 'high' | 'medium' | 'low' }) => void;
type RateLimitedCallback = (retryAfter: number, error: string) => void;

export const agentEvents = new EventEmitter();
agentEvents.setMaxListeners(20);

export const AgentEvent = {
  McpStatus: 'mcp-status',
  LspStatus: 'lsp-status',
  TodoUpdate: 'todo-update',
  GoalProgress: 'goal-progress',
  SubagentStatus: 'subagent-status',
} as const;

let workerProcess: childProcess.ChildProcess | null = null;
let workerReady = false;
let currentCallbacks: { token: TokenCallback; done: DoneCallback; approval: ApprovalCallback | undefined; messageId?: string } | null = null;
let workerMessageHandler: ((chunk: Buffer) => void) | null = null;
let activeDataHandler: ((chunk: Buffer) => void) | null = null;
const insertStack: InsertedCell[] = [];

const SENSITIVE_ENV_PATTERNS = [
  /^AWS_/,
  /^AZURE_/,
  /^GOOGLE_/i,
  /^GCLOUD_/i,
  /^GITHUB_/i,
  /^GIT_/i,
  /^GH_/i,
  /^NPM_TOKEN/i,
  /^NPM_SECRET/i,
  /^NODE_PRE_GYP/i,
  /^NUGET_/i,
  /^TWILIO_/i,
  /^SLACK_/i,
  /^DIGITALOCEAN_/i,
  /^DO_/i,
  /^DBUS_/i,
  /^DISPLAY/i,
  /^LANG/i,
  /^LC_/i,
  /^TERM/i,
  /^XDG_/i,
  /^GIO_/i,
  /^GTK_/i,
  /^GNOME_/i,
  /^KDE_/i,
];

function sanitizeEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PATTERNS.some(pattern => pattern.test(key))) continue;
    safe[key] = value;
  }
  safe.NODE_NO_WARNINGS = '1';
  return safe;
}

// Track all spawned worker PIDs so cleanup is reliable regardless of argv
const spawnedWorkerPids = new Set<number>();

function spawnWorker(): childProcess.ChildProcess {
  const workerPath = process.env.TRINNO_WORKER_PATH
    || nodePath.resolve(__dirname, '..', '..', 'dist', 'bos', 'worker.js');
  const proc = childProcess.spawn(process.execPath, [workerPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: sanitizeEnv(),
  });
  if (proc.pid !== undefined) {
    spawnedWorkerPids.add(proc.pid);
    proc.on('exit', () => spawnedWorkerPids.delete(proc.pid!));
    proc.on('error', () => spawnedWorkerPids.delete(proc.pid!));
  }
  return proc;
}

export function killOrphanedWorkers(): void {
  for (const pid of spawnedWorkerPids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }
  spawnedWorkerPids.clear();
}

async function ensureWorker(): Promise<void> {
  if (workerProcess && workerReady) {
    // Process may have exited without us noticing (no exit listener on old process).
    // Check if it's still alive; if not, fall through to respawn.
    if (workerProcess.exitCode === null && workerProcess.signalCode === null && !workerProcess.killed) {
      return;
    }
    log.warn({ exitCode: workerProcess.exitCode, signalCode: workerProcess.signalCode, killed: workerProcess.killed }, 'bos worker dead but workerReady true — respawning');
    workerProcess = null;
    workerReady = false;
  }

  killOrphanedWorkers();

  if (workerProcess) {
    try { workerProcess.kill(); } catch { /* ignore */ }
    workerProcess = null;
    workerReady = false;
  }

  const proc = spawnWorker();
  workerProcess = proc;

  // Detect worker exit so subsequent calls can respawn a healthy worker.
  // Without this, a crashed/exited worker leaves workerReady=true and the
  // message pipeline silently hangs (e.g. /compact after an unhandled error).
  proc.on('exit', (code, signal) => {
    log.warn({ code, signal }, 'bos worker exited');
    if (workerProcess === proc) {
      workerProcess = null;
      workerReady = false;
    }
  });
  proc.on('error', (err) => {
    log.warn({ err }, 'bos worker spawn error');
    if (workerProcess === proc) {
      workerProcess = null;
      workerReady = false;
    }
  });

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      // Worker started but may have sent ready before we listened
      workerReady = true;
      resolve();
    }, 5000);
    proc.stdout?.once('data', (chunk: Buffer) => {
      clearTimeout(timeout);
      const text = chunk.toString();
      if (text.includes('"type":"ready"')) {
        workerReady = true;
        resolve();
      } else {
        // First data wasn't the ready signal — still mark ready (race with worker)
        workerReady = true;
        resolve();
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      log.warn({ stderr: chunk.toString() }, 'bos worker stderr');
    });
    proc.on('error', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  // Reset workerMessageHandler on each spawn so respawned workers get the
  // general message handler for mcp-status / lsp-status / todo-update events.
  workerMessageHandler = null;
  if (workerProcess) {
    let messageBuffer = '';
    workerMessageHandler = (chunk: Buffer) => {
      messageBuffer += chunk.toString();
      const lines = messageBuffer.split('\n');
      messageBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          // Defer status events to next tick so they don't block
          // the sendMessage handleData from processing token/done in the same chunk.
          if (msg.type === 'mcp-status') {
            const servers = msg.servers || [];
            setImmediate(() => agentEvents.emit(AgentEvent.McpStatus, servers));
          }
          if (msg.type === 'lsp-status') {
            setImmediate(() => agentEvents.emit(AgentEvent.LspStatus, msg));
          }
          if (msg.type === 'todo-update') {
            const todos = msg.todos || [];
            setImmediate(() => agentEvents.emit(AgentEvent.TodoUpdate, todos));
          }
          if (msg.type === 'goal-progress') {
            setImmediate(() => agentEvents.emit(AgentEvent.GoalProgress, msg));
          }
          if (msg.type === 'subagent-status') {
            const subagents = msg.subagents || [];
            setImmediate(() => agentEvents.emit(AgentEvent.SubagentStatus, subagents));
          }
        } catch { /* ignore non-JSON */ }
      }
    };
    workerProcess.stdout?.on('data', workerMessageHandler);
  }
}

export async function sendMessage(
  messageId: string,
  text: string,
  onToken: TokenCallback,
  onDone: DoneCallback,
  onError: (err: string) => void,
  onApproval?: ApprovalCallback,
  onRateLimited?: RateLimitedCallback,
  systemSummary?: string,
  sessionId?: string,
  brainOsSession?: string,
  skillContent?: string,
  modelConfig?: { model?: string; baseUrl?: string; apiKey?: string },
  workspaceRoot?: string
): Promise<void> {
  log.info({ messageId, textLength: text.length, sessionId }, 'sendMessage called');
  currentCallbacks = { token: onToken, done: onDone, approval: onApproval, messageId };

  await ensureWorker();
  log.debug({ workerReady }, 'ensureWorker done');

  if (!workerProcess || !workerReady) {
    log.warn('worker not available');
    onToken({ type: 'token', role: 'assistant', tokenType: 'Text', text: 'AI worker not available. Please ensure tsx is installed.' });
    onDone();
    return;
  }

  const ctx = extractNotebookContext();
  const config = getChatConfig();

  const effectiveModel = modelConfig?.model ?? config.global_model?.model ?? '';
  const effectiveBaseUrl = modelConfig?.baseUrl ?? config.global_model?.base_url ?? '';
  const effectiveApiKey = modelConfig?.apiKey ?? config.global_model?.api_key ?? '';
  log.warn({ config: { model: effectiveModel, baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey, hasModelConfig: !!modelConfig } }, 'model used for request');
  const payload = {
    type: 'chat',
    messageId,
    text,
    workspaceRoot: workspaceRoot || process.cwd(),
    context: (config.context?.auto_inject ?? true) ? formatContextForPrompt(ctx) : null,
    persona: {
      name: config.persona?.name ?? 'Research Assistant',
      prompt: config.persona?.prompt ?? '',
    },
    systemSummary: systemSummary || undefined,
    apiKey: effectiveApiKey || undefined,
    sessionId: sessionId || undefined,
    brainOsSession: brainOsSession || undefined,
    skillContent: skillContent || undefined,
    model: effectiveModel,
    baseUrl: effectiveBaseUrl,
    toolPermissions: config.tools?.permissions ?? DEFAULT_TOOL_PERMISSIONS,
    mcpServers: config.mcp?.servers ?? [],
    sandboxEnabled: config.sandbox?.enabled ?? true,
  };

  let dataBuffer = '';
  const drainRemainingLines = (buffer: string): void => {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'token') {
          onToken(buildTokenMsg(msg));
        }
      } catch { /* ignore non-JSON */ }
    }
  };
  const handleData = (chunk: Buffer) => {
    dataBuffer += chunk.toString();
    const lines = dataBuffer.split('\n');
    dataBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        switch (msg.type) {
          case 'token':
            onToken(buildTokenMsg(msg));
            break;
          case 'done':
            if (msg.messageId && msg.messageId !== payload.messageId) break;
            drainRemainingLines(dataBuffer);
            dataBuffer = '';
            log.trace({ traceId: payload.messageId }, '[TRACE] agent←worker: stream complete');
            cleanup();
            onDone(msg);
            break;
          case 'error':
            if (msg.messageId && msg.messageId !== payload.messageId) break;
            log.warn({ error: msg.error }, 'handleData got error');
            cleanup();
            onError(msg.error);
            break;
          case 'rate-limited':
            if (currentCallbacks?.done) {
              const doneCb = currentCallbacks.done;
              cleanup();
              doneCb({ rateLimited: true, retryAfter: msg.retryAfter, error: msg.error });
            } else {
              cleanup();
            }
            break;
          case 'insert-cell':
            insertCellAt(msg.content, msg.cellType, msg.position ?? 'cursor').then(result => {
              if (result) {
                insertStack.push({ ...result, timestamp: Date.now() });
              }
            }).catch(() => { });
            break;
          case 'tool-approval-needed':
            if (currentCallbacks?.approval) {
              currentCallbacks.approval(msg.id, msg.toolName, msg.args, msg.metadata, msg.bashIntent);
            }
            break;
        }
      } catch { /* ignore non-JSON */ }
    }
  };

  const cleanup = () => {
    if (workerProcess?.stdout && activeDataHandler === handleData) {
      workerProcess.stdout.removeListener('data', handleData);
      activeDataHandler = null;
    }
    currentCallbacks = null;
  };

  if (activeDataHandler) {
    workerProcess.stdout?.removeListener('data', activeDataHandler);
  }
  activeDataHandler = handleData;
  workerProcess.stdout?.on('data', handleData);
  log.trace({ traceId: payload.messageId, textLength: payload.text?.length, sessionId: payload.sessionId }, '[TRACE] agent→worker: forwarding chat message');
  workerProcess.stdin?.write(JSON.stringify(payload) + '\n');
  log.trace('[TRACE] agent→worker: stdin.write completed');
}

export function cancelGeneration(): void {
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'cancel' }) + '\n');
  }
  if (workerProcess?.stdout && activeDataHandler) {
    workerProcess.stdout.removeListener('data', activeDataHandler);
    activeDataHandler = null;
  }
  // NOTE: panel.ts calls finalizeCurrentMessage + processQueue explicitly
  // after cancelGeneration. Do NOT call currentCallbacks.done() here — it
  // would trigger onDone → processQueue → auto-drain before the panel has
  // a chance to handle in-flight removal and status updates.
  currentCallbacks = null;
}

export function sendToolApproval(id: string, approved: boolean, remember?: boolean): void {
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'tool-approval', id, approved, remember }) + '\n');
  }
}

export function sendClearSession(sessionId: string): void {
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'clear-session', sessionId }) + '\n');
  }
}

export function sendCompactResult(sessionId: string, summary: string): void {
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'compact-result', sessionId, summary }) + '\n');
  }
}

export function sendRecoverSession(sessionId: string, messages: { role: string; content: string }[]): void {
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'recover-session', sessionId, messages }) + '\n');
  }
}

export async function sendSetWorkspaceRoot(workspaceRoot: string): Promise<void> {
  await ensureWorker();
  const proc = workerProcess;
  const stdin = proc?.stdin;
  const stdout = proc?.stdout;
  if (!stdin || !stdout) return;

  return new Promise<void>((resolve) => {
    let buffer = '';
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      stdout.removeListener('data', handleData);
      clearTimeout(timer);
      resolve();
    };
    const handleData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'done' || msg.type === 'error') {
            finish();
            return;
          }
        } catch { /* ignore non-JSON */ }
      }
    };
    const timer = setTimeout(finish, 15000);
    stdout.on('data', handleData);
    stdin.write(JSON.stringify({
      type: 'chat',
      messageId: `set_workspace_${Date.now()}`,
      text: ' ',
      workspaceRoot,
    }) + '\n');
  });
}

export async function undoLastAiInsert(): Promise<boolean> {
  const last = insertStack.pop();
  if (!last) return false;
  return undoLastInsert(last.notebookUri, last.cellIndex);
}

export function getWelcomeContext(): { context: ReturnType<typeof extractNotebookContext>; personaName: string } {
  return {
    context: extractNotebookContext(),
    personaName: getChatConfig().persona?.name ?? 'Research Assistant',
  };
}

export async function initializeAgent(
  workspaceRoot?: string
): Promise<void> {
  await ensureWorker();
  const config = getChatConfig();
  log.debug({ workspaceRoot }, 'sending init message to worker');
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({
      type: 'init',
      workspaceRoot,
      apiKey: config.global_model?.api_key ?? undefined,
      toolPermissions: config.tools?.permissions ?? DEFAULT_TOOL_PERMISSIONS,
      sandboxEnabled: config.sandbox?.enabled ?? true,
    }) + '\n');
  }
}

export function disposeAgent(): void {
  // Kill all tracked workers (current + any orphaned PIDs).
  // Safe: only kills PIDs we explicitly spawned, not other VS Code instances.
  killOrphanedWorkers();

  if (workerProcess) {
    try { workerProcess.kill(); } catch { /* ignore */ }
    workerProcess = null;
    workerReady = false;
  }

  insertStack.length = 0;
  currentCallbacks = null;
  activeDataHandler = null;
  workerMessageHandler = null;
}

export interface CompactMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

export async function sendCompactRequest(
  messages: CompactMessage[],
  systemSummary: string | undefined,
  onToken: TokenCallback,
  onDone: DoneCallback,
  onError: (err: string) => void,
  modelConfig?: { model?: string; baseUrl?: string; apiKey?: string }
): Promise<void> {
  log.info({ messageCount: messages.length }, 'sendCompactRequest called');
  currentCallbacks = { token: onToken, done: onDone, approval: undefined };

  await ensureWorker();

  if (!workerProcess || !workerReady) {
    log.warn('worker not available for compact');
    onToken({ type: 'token', role: 'assistant', tokenType: 'Text', text: 'AI worker not available.' });
    onDone();
    return;
  }

  const config = getChatConfig();

  const effectiveModel = modelConfig?.model ?? config.global_model?.model ?? '';
  const effectiveBaseUrl = modelConfig?.baseUrl ?? config.global_model?.base_url ?? '';
  const effectiveApiKey = modelConfig?.apiKey ?? config.global_model?.api_key ?? '';

  const payload = {
    type: 'compact',
    messages,
    systemSummary: systemSummary || undefined,
    persona: {
      name: config.persona?.name ?? 'Research Assistant',
      prompt: config.persona?.prompt ?? '',
    },
    apiKey: effectiveApiKey || undefined,
    model: effectiveModel,
    baseUrl: effectiveBaseUrl,
  };

  let compactBuffer = '';
  const drainRemainingLines = (buffer: string): void => {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'token') {
          onToken(buildTokenMsg(msg));
        }
      } catch { /* ignore non-JSON */ }
    }
  };
  const handleData = (chunk: Buffer) => {
    compactBuffer += chunk.toString();
    const lines = compactBuffer.split('\n');
    compactBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        switch (msg.type) {
          case 'token':
            onToken(buildTokenMsg(msg));
            break;
          case 'done':
            drainRemainingLines(compactBuffer);
            compactBuffer = '';
            cleanup();
            onDone(msg);
            break;
          case 'error':
            cleanup();
            onError(msg.error);
            break;
        }
      } catch { /* ignore non-JSON */ }
    }
  };

  const cleanup = () => {
    if (workerProcess?.stdout && activeDataHandler === handleData) {
      workerProcess.stdout.removeListener('data', handleData);
      activeDataHandler = null;
    }
    currentCallbacks = null;
  };

  if (activeDataHandler) {
    workerProcess.stdout?.removeListener('data', activeDataHandler);
  }
  activeDataHandler = handleData;
  workerProcess.stdout?.on('data', handleData);
  workerProcess.stdin?.write(JSON.stringify(payload) + '\n');
}

export async function sendSlashRequest(
  messageId: string,
  text: string,
  onToken: TokenCallback,
  onDone: DoneCallback,
  onError: (err: string) => void,
  modelConfig?: { model?: string; baseUrl?: string; apiKey?: string },
  workspaceRoot?: string
): Promise<void> {
  log.info({ text }, 'sendSlashRequest called');
  currentCallbacks = { token: onToken, done: onDone, approval: undefined, messageId };

  await ensureWorker();

  if (!workerProcess || !workerReady) {
    onToken({ type: 'token', role: 'assistant', tokenType: 'Text', text: 'AI worker not available.' });
    onDone();
    return;
  }

  const config = getChatConfig();

  const effectiveModel = modelConfig?.model ?? config.global_model?.model ?? '';
  const effectiveBaseUrl = modelConfig?.baseUrl ?? config.global_model?.base_url ?? '';
  const effectiveApiKey = modelConfig?.apiKey ?? config.global_model?.api_key ?? '';

  const payload = {
    type: 'slash',
    messageId,
    text,
    workspaceRoot: workspaceRoot || process.cwd(),
    apiKey: effectiveApiKey || undefined,
    model: effectiveModel,
    baseUrl: effectiveBaseUrl,
  };

  let slashBuffer = '';
  const handleData = (chunk: Buffer) => {
    slashBuffer += chunk.toString();
    const lines = slashBuffer.split('\n');
    slashBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        switch (msg.type) {
          case 'token':
            onToken(buildTokenMsg(msg));
            break;
          case 'done':
            if (msg.messageId && msg.messageId !== payload.messageId) break;
            cleanup();
            onDone(msg);
            break;
          case 'error':
            if (msg.messageId && msg.messageId !== payload.messageId) break;
            cleanup();
            onError(msg.error);
            break;
        }
      } catch { /* ignore non-JSON */ }
    }
  };

  const cleanup = (): void => {
    if (workerProcess?.stdout && activeDataHandler === handleData) {
      workerProcess.stdout.removeListener('data', handleData);
      activeDataHandler = null;
    }
    currentCallbacks = null;
  };

  if (activeDataHandler) {
    workerProcess.stdout?.removeListener('data', activeDataHandler);
  }
  activeDataHandler = handleData;
  workerProcess.stdout?.on('data', handleData);
  workerProcess.stdin?.write(JSON.stringify(payload) + '\n');
}

export async function sendPaperRequest(
  prompt: string,
  onToken: TokenCallback,
  onDone: DoneCallback,
  onError: (err: string) => void,
  modelConfig?: { model?: string; baseUrl?: string; apiKey?: string }
): Promise<void> {
  currentCallbacks = { token: onToken, done: onDone, approval: undefined };

  await ensureWorker();

  if (!workerProcess || !workerReady) {
    onToken({ type: 'token', role: 'assistant', tokenType: 'Text', text: 'AI worker not available.' });
    onDone();
    return;
  }

  const config = getChatConfig();

  const effectiveModel = modelConfig?.model ?? config.global_model?.model ?? '';
  const effectiveBaseUrl = modelConfig?.baseUrl ?? config.global_model?.base_url ?? '';
  const effectiveApiKey = modelConfig?.apiKey ?? config.global_model?.api_key ?? '';

  const payload = {
    type: 'paper',
    prompt,
    persona: {
      name: config.persona?.name ?? 'Research Assistant',
      prompt: config.persona?.prompt ?? '',
    },
    apiKey: effectiveApiKey || undefined,
    model: effectiveModel,
    baseUrl: effectiveBaseUrl,
  };

  let paperBuffer = '';
  let writeFileCmd: { filePath?: string; content?: string; resolved?: boolean } = {};
  const drainPaperLines = (buffer: string): void => {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'token') {
          onToken(buildTokenMsg(msg));
        }
      } catch { /* ignore non-JSON */ }
    }
  };
  const handleData = (chunk: Buffer) => {
    paperBuffer += chunk.toString();
    const lines = paperBuffer.split('\n');
    paperBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        switch (msg.type) {
          case 'token':
            if (msg.tokenType === 'ToolCall' && msg.name === 'write_file' && msg.args?.filePath) {
              writeFileCmd = { filePath: String(msg.args.filePath), resolved: false };
            }
            if (msg.tokenType === 'ToolResult' && msg.toolId && !writeFileCmd.resolved) {
              const prev = writeFileCmd;
              if (!prev.filePath) {
                try {
                  const parsed = JSON.parse(typeof msg.result === 'string' ? msg.result : msg.text || '{}');
                  if (parsed && typeof parsed.filePath === 'string') {
                    writeFileCmd = { filePath: parsed.filePath, content: parsed.content ?? parsed.text ?? '', resolved: true };
                  }
                } catch { /* not structured */ }
              }
            }
            onToken(buildTokenMsg(msg));
            break;
          case 'done':
            drainPaperLines(paperBuffer);
            paperBuffer = '';
            cleanup();
            onDone({ ...msg, writeFilePath: writeFileCmd.filePath, writeFileContent: writeFileCmd.content });
            break;
          case 'error':
            cleanup();
            onError(msg.error);
            break;
        }
      } catch { /* ignore non-JSON */ }
    }
  };

  const cleanup = () => {
    if (workerProcess?.stdout && activeDataHandler === handleData) {
      workerProcess.stdout.removeListener('data', handleData);
      activeDataHandler = null;
    }
    currentCallbacks = null;
  };

  if (activeDataHandler) {
    workerProcess.stdout?.removeListener('data', activeDataHandler);
  }
  activeDataHandler = handleData;
  workerProcess.stdout?.on('data', handleData);
  workerProcess.stdin?.write(JSON.stringify(payload) + '\n');
}

export async function requestMcpStatus(): Promise<void> {
  await ensureWorker();
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'mcp-status-request' }) + '\n');
  }
}

export async function requestLspStatus(): Promise<void> {
  await ensureWorker();
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'lsp-status-request' }) + '\n');
  }
}

let _lastWsRoot = '';

export function setLastWorkspaceRoot(root: string): void {
  _lastWsRoot = root;
}

export async function requestTodoStatus(): Promise<void> {
  await ensureWorker();
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'todo-status-request', workspaceRoot: _lastWsRoot || undefined }) + '\n');
  }
}


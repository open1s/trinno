import * as childProcess from 'child_process';
import * as nodePath from 'path';
import type { ExtToWebViewMessage } from './messages';
import { getChatConfig, getApiKey } from './settings';
import { extractNotebookContext, insertCellAt, undoLastInsert, formatContextForPrompt } from './context';

interface InsertedCell {
  notebookUri: string;
  cellIndex: number;
  timestamp: number;
}

type TokenCallback = (msg: ExtToWebViewMessage) => void;

type DoneCallback = (data?: any) => void;
type ApprovalCallback = (id: string, toolName: string, args: Record<string, unknown>, metadata?: { description: string; dangerous: boolean; category: string }, bashIntent?: { action: string; target: string; risk: 'high' | 'medium' | 'low' }) => void;
type McpStatusCallback = (servers: { name: string; type: string; connected: boolean }[]) => void;
type RateLimitedCallback = (retryAfter: number, error: string) => void;

let workerProcess: childProcess.ChildProcess | null = null;
let workerReady = false;
let currentCallbacks: { token: TokenCallback; done: DoneCallback; approval: ApprovalCallback | undefined } | null = null;
let mcpStatusCallback: McpStatusCallback | null = null;
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

function spawnWorker(): childProcess.ChildProcess {
  const projectRoot = nodePath.resolve(__dirname, '..', '..');
  return childProcess.spawn('npx', ['tsx', 'src/bos/worker.ts'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: projectRoot,
    env: sanitizeEnv(),
  });
}

async function ensureWorker(): Promise<void> {
  if (workerProcess && workerReady) return;

  if (workerProcess) {
    try { workerProcess.kill(); } catch { /* ignore */ }
    workerProcess = null;
    workerReady = false;
  }

  const proc = spawnWorker();
  workerProcess = proc;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 5000);
    proc.stdout?.once('data', (chunk: Buffer) => {
      clearTimeout(timeout);
      const text = chunk.toString();
      if (text.includes('"type":"ready"')) {
        workerReady = true;
        resolve();
      } else {
        resolve();
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      console.error('[trinno-chat] bos worker stderr:', chunk.toString());
    });
    proc.on('error', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  if (workerProcess && !workerMessageHandler) {
    let messageBuffer = '';
    workerMessageHandler = (chunk: Buffer) => {
      messageBuffer += chunk.toString();
      const lines = messageBuffer.split('\n');
      messageBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'mcp-status' && mcpStatusCallback) {
            mcpStatusCallback(msg.servers || []);
          }
        } catch { /* ignore non-JSON */ }
      }
    };
    workerProcess.stdout?.on('data', workerMessageHandler);
  }
}

export function setMcpStatusCallback(cb: McpStatusCallback): void {
  mcpStatusCallback = cb;
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
  console.log('[trinno-chat] sendMessage called', { messageId, textLength: text.length, sessionId });
  currentCallbacks = { token: onToken, done: onDone, approval: onApproval };

  await ensureWorker();
  console.log('[trinno-chat] ensureWorker done, workerReady:', workerReady);

  if (!workerProcess || !workerReady) {
    console.log('[trinno-chat] worker not available');
    onToken({ type: 'token', role: 'assistant', tokenType: 'Text', text: 'AI worker not available. Please ensure tsx is installed.' });
    onDone();
    return;
  }

  const ctx = extractNotebookContext();
  const config = getChatConfig();
  const apiKey = await getApiKey();

  const effectiveModel = modelConfig?.model || config.model.name;
  const effectiveBaseUrl = modelConfig?.baseUrl || config.model.baseUrl;
  const effectiveApiKey = modelConfig?.apiKey || apiKey;

  const payload = {
    type: 'chat',
    messageId,
    text,
    workspaceRoot: workspaceRoot || process.cwd(),
    context: config.context.autoInject ? formatContextForPrompt(ctx) : null,
    persona: {
      name: config.persona.name,
      prompt: config.persona.prompt,
    },
    systemSummary: systemSummary || undefined,
    apiKey: effectiveApiKey || undefined,
    sessionId: sessionId || undefined,
    brainOsSession: brainOsSession || undefined,
    skillContent: skillContent || undefined,
    model: effectiveModel,
    baseUrl: effectiveBaseUrl,
    toolPermissions: config.tools.permissions,
    mcpServers: config.mcp.servers,
    sandboxEnabled: config.sandbox.enabled,
  };

  let dataBuffer = '';
  const drainRemainingLines = (buffer: string): void => {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'token') {
          onToken({ type: 'token', role: 'assistant', tokenType: msg.tokenType, text: msg.text });
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
        console.log('[trinno-chat] handleData received msg type:', msg.type);
        switch (msg.type) {
          case 'token':
            onToken({ type: 'token', role: 'assistant', tokenType: msg.tokenType, text: msg.text });
            break;
          case 'done':
            drainRemainingLines(dataBuffer);
            dataBuffer = '';
            console.log('[trinno-chat] handleData got done, cleaning up');
            cleanup();
            onDone(msg);
            break;
          case 'error':
            console.log('[trinno-chat] handleData got error:', msg.error);
            cleanup();
            onError(msg.error);
            break;
          case 'rate-limited':
            cleanup();
            if (currentCallbacks?.done) {
              currentCallbacks.done({ rateLimited: true, retryAfter: msg.retryAfter, error: msg.error });
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

  activeDataHandler = handleData;
  workerProcess.stdout?.on('data', handleData);
  console.log('[trinno-chat] about to write to stdin, payload sessionId:', payload.sessionId);
  workerProcess.stdin?.write(JSON.stringify(payload) + '\n');
  console.log('[trinno-chat] stdin.write completed');
}

export function cancelGeneration(): void {
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'cancel' }) + '\n');
  }
  if (workerProcess?.stdout && activeDataHandler) {
    workerProcess.stdout.removeListener('data', activeDataHandler);
    activeDataHandler = null;
  }
  if (currentCallbacks) {
    currentCallbacks.done();
    currentCallbacks = null;
  }
}

export function sendToolApproval(id: string, approved: boolean): void {
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'tool-approval', id, approved }) + '\n');
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
    personaName: getChatConfig().persona.name,
  };
}

export async function initializeAgent(onMcpStatus?: (servers: { name: string; type: string; connected: boolean }[]) => void): Promise<void> {
  if (onMcpStatus) {
    setMcpStatusCallback(onMcpStatus);
  }
  await ensureWorker();
  console.log('[trinno-chat] Sending init message to worker');
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'init' }) + '\n');
  }
}

export function disposeAgent(): void {
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
  console.log('[trinno-chat] sendCompactRequest called, message count:', messages.length);
  currentCallbacks = { token: onToken, done: onDone, approval: undefined };

  await ensureWorker();

  if (!workerProcess || !workerReady) {
    console.log('[trinno-chat] worker not available for compact');
    onToken({ type: 'token', role: 'assistant', tokenType: 'Text', text: 'AI worker not available.' });
    onDone();
    return;
  }

  const config = getChatConfig();
  const apiKey = await getApiKey();

  const effectiveModel = modelConfig?.model || config.model.name;
  const effectiveBaseUrl = modelConfig?.baseUrl || config.model.baseUrl;
  const effectiveApiKey = modelConfig?.apiKey || apiKey;

  const payload = {
    type: 'compact',
    messages,
    systemSummary: systemSummary || undefined,
    persona: {
      name: config.persona.name,
      prompt: config.persona.prompt,
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
          onToken({ type: 'token', role: 'assistant', tokenType: msg.tokenType, text: msg.text });
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
            onToken({ type: 'token', role: 'assistant', tokenType: msg.tokenType, text: msg.text });
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
  console.log('[trinno-chat] sendSlashRequest called, text:', text);
  currentCallbacks = { token: onToken, done: onDone, approval: undefined };

  await ensureWorker();

  if (!workerProcess || !workerReady) {
    onToken({ type: 'token', role: 'assistant', tokenType: 'Text', text: 'AI worker not available.' });
    onDone();
    return;
  }

  const config = getChatConfig();
  const apiKey = await getApiKey();

  const effectiveModel = modelConfig?.model || config.model.name;
  const effectiveBaseUrl = modelConfig?.baseUrl || config.model.baseUrl;
  const effectiveApiKey = modelConfig?.apiKey || apiKey;

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
            onToken({ type: 'token', role: 'assistant', tokenType: msg.tokenType, text: msg.text });
            break;
          case 'done':
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

  const cleanup = (): void => {
    if (workerProcess?.stdout && activeDataHandler === handleData) {
      workerProcess.stdout.removeListener('data', handleData);
      activeDataHandler = null;
    }
    currentCallbacks = null;
  };

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
  const apiKey = await getApiKey();

  const effectiveModel = modelConfig?.model || config.model.name;
  const effectiveBaseUrl = modelConfig?.baseUrl || config.model.baseUrl;
  const effectiveApiKey = modelConfig?.apiKey || apiKey;

  const payload = {
    type: 'paper',
    prompt,
    persona: {
      name: config.persona.name,
      prompt: config.persona.prompt,
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
          onToken({ type: 'token', role: 'assistant', tokenType: msg.tokenType, text: msg.text ?? msg.result ?? '' });
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
            onToken({ type: 'token', role: 'assistant', tokenType: msg.tokenType, text: msg.text ?? msg.result ?? '' });
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


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
const insertStack: InsertedCell[] = [];

function spawnWorker(): childProcess.ChildProcess {
  const projectRoot = nodePath.resolve(__dirname, '..', '..');
  return childProcess.spawn('npx', ['tsx', 'src/bos/worker.ts'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: projectRoot,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
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
  currentCallbacks = { token: onToken, done: onDone, approval: onApproval };

  await ensureWorker();

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
    mcp: config.mcp,
  };

  let dataBuffer = '';
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
            }).catch(() => {});
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
    if (workerProcess?.stdout) {
      workerProcess.stdout.removeListener('data', handleData);
    }
    currentCallbacks = null;
  };

  workerProcess.stdout?.on('data', handleData);
  workerProcess.stdin?.write(JSON.stringify(payload) + '\n');
}

export function cancelGeneration(): void {
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'cancel' }) + '\n');
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
    if (workerProcess?.stdout) {
      workerProcess.stdout.removeListener('data', handleData);
    }
    currentCallbacks = null;
  };

  workerProcess.stdout?.on('data', handleData);
  workerProcess.stdin?.write(JSON.stringify(payload) + '\n');
}

export async function requestMcpStatus(): Promise<void> {
  await ensureWorker();
  if (workerProcess?.stdin) {
    workerProcess.stdin.write(JSON.stringify({ type: 'mcp-status-request' }) + '\n');
  }
}

import * as vscode from 'vscode';
import { ExtToWebViewMessage } from './messages';
import { getChatConfig, getApiKey } from './settings';
import { extractNotebookContext, insertCellAt, undoLastInsert, formatContextForPrompt } from './context';

interface InsertedCell {
  notebookUri: string;
  cellIndex: number;
  timestamp: number;
}

type TokenCallback = (msg: ExtToWebViewMessage) => void;
type DoneCallback = (data?: any) => void;
type ApprovalCallback = (id: string, toolName: string, args: Record<string, unknown>) => void;
type McpStatusCallback = (servers: { name: string; type: string; connected: boolean }[]) => void;

let workerProcess: ReturnType<typeof import('child_process').spawn> | null = null;
let workerReady = false;
let currentCallbacks: { token: TokenCallback; done: DoneCallback; approval: ApprovalCallback | undefined } | null = null;
let mcpStatusCallback: McpStatusCallback | null = null;
let workerMessageHandler: ((chunk: Buffer) => void) | null = null;
const insertStack: InsertedCell[] = [];

function spawnWorker(): ReturnType<typeof import('child_process').spawn> {
  const { spawn } = require('child_process');
  const path = require('path');
  const projectRoot = path.resolve(__dirname, '..', '..');
  return spawn('npx', ['tsx', 'src/bos/worker.ts'], {
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
    workerMessageHandler = (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'mcp-status' && mcpStatusCallback) {
            console.log('[trinno-chat] Received mcp-status from worker:', JSON.stringify(msg.servers));
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
  systemSummary?: string,
  sessionId?: string,
  brainOsSession?: string,
  skillContent?: string,
  modelConfig?: { model?: string; baseUrl?: string; apiKey?: string }
): Promise<void> {
  console.log('[trinno-chat] sendMessage called:', text.slice(0, 50));
  currentCallbacks = { token: onToken, done: onDone, approval: onApproval };

  await ensureWorker();
  console.log('[trinno-chat] worker ready:', workerReady);

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

  console.log('[trinno-chat] payload toolPermissions:', JSON.stringify(payload.toolPermissions).slice(0, 200));

  const handleData = (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
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
          case 'insert-cell':
            insertCellAt(msg.content, msg.cellType, msg.position ?? 'cursor').then(result => {
              if (result) {
                insertStack.push({ ...result, timestamp: Date.now() });
              }
            }).catch(() => {});
            break;
          case 'tool-approval-needed':
            if (currentCallbacks?.approval) {
              currentCallbacks.approval(msg.id, msg.toolName, msg.args);
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

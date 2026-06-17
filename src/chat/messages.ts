import * as vscode from 'vscode';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  timestamp: number;
  status: 'complete' | 'streaming' | 'error';
  error?: string;
}

export interface ToolCall {
  name: string;
  args?: unknown;
  result?: string;
  status: 'called' | 'result' | 'error' | 'running' | 'done' | 'waiting';
}

export interface NotebookContext {
  notebookName: string | null;
  cellCount: number;
  cursorCell: number | null;
  cells: CellInfo[];
}

export interface CellInfo {
  index: number;
  type: string;
  content: string;
}

export type ExtToWebViewMessage =
  | { type: 'token'; role: 'assistant'; tokenType: TokenType; text: string; args?: unknown; toolId?: string; promptTokens?: number; completionTokens?: number; totalTokens?: number; promptTokensDetails?: unknown }
  | { type: 'done'; messageId: string }
  | { type: 'error'; messageId: string; error: string }
  | { type: 'welcome'; context: NotebookContext | null; personaName: string }
  | { type: 'streaming-start'; messageId: string }
  | { type: 'user-message'; message: ChatMessage }
  | { type: 'history-message'; message: ChatMessage }
  | { type: 'clearHistory' }
  | { type: 'context-update'; context: NotebookContext | null }
  | { type: 'session-updated'; sessionId: string; sessionTitle: string; sessions: SessionInfo[]; isCompacted: boolean }
  | { type: 'session-list-updated'; sessions: SessionInfo[] }
  | { type: 'session-title-updated'; sessionId: string; title: string }
  | { type: 'rate-limited'; messageId: string; retryAfter: number }
  | { type: 'rate-limited-tick'; messageId: string; remaining: number }
  | { type: 'insert-to-input'; attachment: { mode: 'inline' | 'reference'; filePath: string; lineRange: string | null; startLine?: number; endLine?: number; language: string; content: string } }
  | { type: 'agents-loaded'; agents: { name: string; description: string }[] }
  | { type: 'models-loaded'; models: { name: string; description?: string }[] }
  | { type: 'tool-approval-needed'; id: string; toolName: string; args: Record<string, unknown>; metadata?: { description: string; dangerous: boolean; category: string }; bashIntent?: { action: string; target: string; risk: 'high' | 'medium' | 'low' } }
  | { type: 'write-start'; filePath: string; fileType: string }
  | { type: 'write-progress'; filePath: string; content: string; totalChars: number }
  | { type: 'write-done'; filePath: string; totalChars: number }
  | { type: 'write-topic-prompt'; docType: 'paper' | 'patent'; originalText: string }
  | { type: 'file-list'; workspaceRoot: string; files: FileEntry[] }
  | { type: 'queue-state'; queue: QueuedMessage[] }
  | { type: 'queue-add'; message: QueuedMessage }
  | { type: 'queue-remove'; queueId: string }
  | { type: 'queue-status-change'; queueId: string; status: QueueItemStatus; error?: string };

export interface FileEntry {
  path: string;
  isDir: boolean;
}

export type QueueItemStatus = 'queued' | 'in-flight' | 'completed' | 'error' | 'rate-limited';

export interface QueuedMessage {
  queueId: string;
  text: string;
  timestamp: number;
  status: QueueItemStatus;
  error?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  isCompacted: boolean;
}

export type WebViewToExtMessage =
  | { type: 'userMessage'; text: string; attachments?: string[] }
  | { type: 'cancel' }
  | { type: 'undoInsert' }
  | { type: 'contextRequest' }
  | { type: 'insertCell'; cellType: 'code' | 'markdown'; content: string; position?: 'cursor' | 'end' }
  | { type: 'newSession' }
  | { type: 'switchSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'rate-limited-retry'; messageId: string }
  | { type: 'sendSelection' }
  | { type: 'sendFile' }
  | { type: 'chooseFile' }
  | { type: 'setAgent'; agent: string }
  | { type: 'setModel'; model: string }
  | { type: 'openSettings' }
  | { type: 'tool-approval'; id: string; approved: boolean; remember?: boolean }
  | { type: 'write-topic-confirm'; docType: 'paper' | 'patent'; topic: string; originalText: string }
  | { type: 'write-topic-cancel'; originalText: string }
  | { type: 'request-file-list' }
  | { type: 'queue-remove'; queueId: string }
  | { type: 'queue-force-execute'; queueId: string }
  | { type: 'trace'; message: string; textLength?: number; text?: string };

export type TokenType = 'Text' | 'ReasoningContent' | 'ToolCall' | 'ToolResult' | 'Usage';

let _idCounter = 0;
export function nextId(): string {
  return `msg_${Date.now()}_${++_idCounter}`;
}

export function createUserMessage(text: string): ChatMessage {
  return {
    id: nextId(),
    role: 'user',
    content: text,
    reasoning: '',
    toolCalls: [],
    timestamp: Date.now(),
    status: 'complete',
  };
}

export function createAssistantMessage(): ChatMessage {
  return {
    id: nextId(),
    role: 'assistant',
    content: '',
    reasoning: '',
    toolCalls: [],
    timestamp: Date.now(),
    status: 'streaming',
  };
}

export interface ChatHistory {
  messages: ChatMessage[];
  context: NotebookContext | null;
}

export function loadHistory(): ChatHistory {
  try {
    const uri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(''),
      '.vscode',
      'trinno-chat-history.json'
    );
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const raw = doc?.getText() ?? '';
    if (raw) {
      return JSON.parse(raw) as ChatHistory;
    }
  } catch { /* ignore */ }
  return { messages: [], context: null };
}

export async function saveHistory(history: ChatHistory): Promise<void> {
  try {
    const wsUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!wsUri) return;
    const uri = vscode.Uri.joinPath(wsUri, '.vscode', 'trinno-chat-history.json');
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: true });
    edit.insert(uri, new vscode.Position(0, 0), JSON.stringify(history, null, 2));
    await vscode.workspace.applyEdit(edit);
  } catch { /* ignore */ }
}
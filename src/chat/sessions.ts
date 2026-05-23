import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import type { ChatMessage } from './messages';

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  compactedSummary?: string;
  isCompacted: boolean;
  brainOsSession?: string;
}

export interface SessionMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isCompacted: boolean;
}

export interface SessionStore {
  sessions: SessionMetadata[];
  activeSessionId: string | null;
}



function getSessionBaseDir(): string {
  const wsUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (wsUri) {
    return path.join(wsUri.fsPath, '.bos', 'sessions');
  }
  return path.join(os.homedir(), '.bos', 'sessions', 'default');
}

function getSessionsUri(): vscode.Uri {
  return vscode.Uri.file(path.join(getSessionBaseDir(), 'sessions.json'));
}

function getSessionFileUri(sessionId: string): vscode.Uri {
  return vscode.Uri.file(path.join(getSessionBaseDir(), `${sessionId}.json`));
}

async function ensureSessionsDir(): Promise<void> {
  const dirUri = vscode.Uri.file(getSessionBaseDir());
  try {
    await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    await vscode.workspace.fs.createDirectory(dirUri);
  }
}

export async function loadSessionStore(): Promise<SessionStore> {
  try {
    await ensureSessionsDir();
    const uri = getSessionsUri();
    const data = await vscode.workspace.fs.readFile(uri);
    const store = JSON.parse(new TextDecoder().decode(data)) as SessionStore;
    return store;
  } catch {
    return { sessions: [], activeSessionId: null };
  }
}

export async function saveSessionStore(store: SessionStore): Promise<void> {
  await ensureSessionsDir();
  const uri = getSessionsUri();
  const data = new TextEncoder().encode(JSON.stringify(store, null, 2));
  await vscode.workspace.fs.writeFile(uri, data);
}

export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  const uri = getSessionFileUri(session.id);
  const data = new TextEncoder().encode(JSON.stringify(session, null, 2));
  await vscode.workspace.fs.writeFile(uri, data);
}

export async function loadSession(sessionId: string): Promise<Session | null> {
  try {
    await ensureSessionsDir();
    const uri = getSessionFileUri(sessionId);
    const data = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(new TextDecoder().decode(data)) as Session;
  } catch {
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await ensureSessionsDir();
    const uri = getSessionFileUri(sessionId);
    await vscode.workspace.fs.delete(uri);
  } catch {
    // ignore
  }
}

export function createSession(title?: string): Session {
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  return {
    id,
    title: title || 'New Chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    isCompacted: false,
  };
}

export function generateSessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.content.trim();
  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    return parts[0] || text;
  }
  return text.length > 50 ? text.slice(0, 47) + '...' : text;
}

export function updateSessionTimestamp(session: Session): void {
  session.updatedAt = Date.now();
}

export function sessionToMetadata(session: Session): SessionMetadata {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    isCompacted: session.isCompacted,
  };
}

export async function migrateOldHistory(): Promise<SessionStore> {
  const store = await loadSessionStore();
  if (store.sessions.length > 0) return store;

  try {
    const wsUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!wsUri) return store;

    const oldUri = vscode.Uri.joinPath(wsUri, '.vscode', 'trinno-chat-history.json');
    const data = await vscode.workspace.fs.readFile(oldUri);
    const oldHistory = JSON.parse(new TextDecoder().decode(data));

    if (oldHistory.messages && oldHistory.messages.length > 0) {
      const session = createSession(generateSessionTitle(oldHistory.messages));
      session.messages = oldHistory.messages;
      session.updatedAt = oldHistory.messages[oldHistory.messages.length - 1]?.timestamp ?? session.createdAt;

      store.sessions.push(sessionToMetadata(session));
      store.activeSessionId = session.id;
      await saveSessionStore(store);
      await saveSession(session);
    }
  } catch {
    // no old history to migrate
  }

  return store;
}

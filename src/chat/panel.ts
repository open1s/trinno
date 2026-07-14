import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createModuleLogger } from '../bos/infrastructure/logging/logger';
import { getChatConfig, openConfig } from './settings';
import * as jsbos from '@open1s/jsbos';

const log = createModuleLogger('chat-panel');
import type { CompactMessage } from './agent';
import { agentEvents, AgentEvent, sendMessage, cancelGeneration, undoLastAiInsert, initializeAgent, getWelcomeContext, sendToolApproval, sendCompactRequest, sendSlashRequest, requestMcpStatus, requestLspStatus, requestTodoStatus, sendSetWorkspaceRoot, sendClearSession, sendCompactResult, sendRecoverSession, setLastWorkspaceRoot } from './agent';
import type { ExtToWebViewMessage, WebViewToExtMessage, ChatMessage, FileEntry, QueuedMessage, QueueItemStatus } from './messages';
import { createUserMessage, createAssistantMessage } from './messages';
import { parseWriteIntent, slugifyPatentTitle } from './write_paper';
import { extractNotebookContext, insertCellAt, extractEditorSelection, extractNotebookCellSelection, extractWholeFile, extractWholeNotebook } from './context';
import { resolveCommandFileReference } from './fileReferences';
import type {
  Session,
  SessionStore
} from './sessions';
import {
  createSession,
  generateSessionTitle,
  updateSessionTimestamp,
  loadSessionStore,
  saveSessionStore,
  saveSession,
  loadSession,
  deleteSession,
  migrateOldHistory,
  sessionToMetadata,
} from './sessions';
import { buildContextWithSummary } from './compaction';

let chatView: vscode.WebviewView | null = null;
let sessionStore: SessionStore | null = null;
let currentSession: Session | null = null;
let currentStreamingId: string | null = null;
let currentStreamingMsg: ChatMessage | null = null;
let _streamingPromptTokens = 0;
let _streamingCompletionTokens = 0;
let isGenerating = false;
let messageQueue: QueuedMessage[] = [];
let autoDrainLock = false;
let currentQueueId: string | null = null;
let dequeuedItemText: string | null = null;
const MAX_QUEUE_SIZE = 20;

const CHAT_VIEW_TYPE = 'trinno.chatView';

let extensionContext: vscode.ExtensionContext | null = null;

interface SkillInfo {
  name: string;
  description: string;
  content: string;
}

function loadSkillsFromDir(dirPath: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  try {
    if (!fs.existsSync(dirPath)) return skills;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(dirPath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const content = fs.readFileSync(skillPath, 'utf-8');
      const descMatch = content.match(/description:\s*([^\n]+)/);
      const description = descMatch && descMatch[1] ? descMatch[1].trim().replace(/^["']|["']$/g, '') : `Apply ${entry.name} skill`;
      skills.push({ name: entry.name, description, content });
    }
  } catch {
    // ignore skill loading errors
  }
  return skills;
}

function loadSkillsFromHomeDir(): SkillInfo[] {
  const agentsSkills = loadSkillsFromDir(path.join(os.homedir(), '.agents', 'skills'));
  const bosSkills = loadSkillsFromDir(path.join(os.homedir(), '.bos', 'skills'));

  // Merge, .bos/skills takes precedence for duplicates
  const skillMap = new Map<string, SkillInfo>();
  for (const skill of agentsSkills) {
    skillMap.set(skill.name, skill);
  }
  for (const skill of bosSkills) {
    skillMap.set(skill.name, skill);
  }
  return Array.from(skillMap.values());
}

function loadSkillForSlashCommand(): SkillInfo[] {
  const commands = loadSkillsFromDir(path.join(os.homedir(), '.bos', 'commands'));

  const skillMap = new Map<string, SkillInfo>();
  for (const skill of commands) {
    skillMap.set(skill.name, skill);
  }
  return Array.from(skillMap.values());
}

const loadSkillSlashs = loadSkillForSlashCommand();

const loadedSkills = loadSkillsFromHomeDir();

function loadAgentsFromBosDir(): SkillInfo[] {
  const agents: SkillInfo[] = [];
  const dirPath = path.join(os.homedir(), '.bos', 'agents');
  try {
    if (!fs.existsSync(dirPath)) return agents;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(dirPath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const content = fs.readFileSync(skillPath, 'utf-8');
      const descMatch = content.match(/description:\s*([^\n]+)/);
      const description = descMatch && descMatch[1] ? descMatch[1].trim().replace(/^["']|["']$/g, '') : entry.name;
      agents.push({ name: entry.name, description, content });
    }
  } catch {
    // ignore errors
  }
  return agents;
}

import { downloadPaper, listDownloadedPapers } from '../papers/downloader';
import { searchOpenAlex, hitToIdentifier } from '../papers/search';
import type { SearchHit } from '../papers/search';

interface ModelConfig {
  name: string;
  description?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

function loadModelsFromConfig(): ModelConfig[] {
  const models: ModelConfig[] = [];
  try {
    const loader = new jsbos.ConfigLoader();
    loader.discover();
    const configJson = loader.loadSync();
    const config = JSON.parse(configJson);
    log.error({ cwd: process.cwd(), hasLlm: !!config.llm, llmKeys: config.llm ? Object.keys(config.llm) : [] }, 'DEBUG: loadModelsFromConfig: parsed config');

    const llmSection = config.llm;
    if (llmSection && typeof llmSection === 'object') {
      for (const [name, value] of Object.entries(llmSection)) {
        const v = value as any;
        const m: ModelConfig = { name };
        if (v.model) { m.model = v.model; m.description = v.model; }
        if (v.base_url) m.baseUrl = v.base_url;
        if (v.api_key) m.apiKey = v.api_key;
        models.push(m);
      }
    }
  } catch (e) {
    log.warn({ err: e }, 'Failed to load BOS config');
  }
  log.error({ count: models.length, names: models.map(m => m.name) }, 'DEBUG: loadModelsFromConfig: result');
  return models;
}

const loadedAgents = loadAgentsFromBosDir();
let selectedAgentContent: string | undefined;
const loadedModels = loadModelsFromConfig();
let selectedModelConfig: ModelConfig | undefined;
let pendingMcpStatus: { name: string; type: string; connected: boolean }[] | null = null;

function detectSkillCommand(text: string): { skill: SkillInfo; args: string } | null {
  const match = text.match(/^\/(\S+)\s*(.*)$/);
  if (!match) return null;
  const cmdName = match[1];
  const args = match[2] || '';
  const skill = loadSkillSlashs.find(s => s.name === cmdName);
  if (!skill) return null;
  return { skill, args };
}

function formatSkillMessage(skill: SkillInfo, args: string): string {
  const skillBody = skill.content.replace(/^---[\s\S]*?---\s*/, '').trim();
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `## Instructions:\n\n${skillBody}\n\n---\n\n==Current task: \n\n ${args || '(no specific task)'}\n\n${time}`;
}

const staticSlashCommands = [
  { name: 'init', description: 'Initialize a Trinno workspace (creates 8 phase folders + READMEs + AGENTS.md)' },
  { name: 'session', description: 'Manage sessions: list, select, delete, rename' },
  { name: 'new', description: 'Create a new chat session' },
  { name: 'compact', description: 'Compact current session: summarize old messages, reduce context' },
  { name: 'contradiction', description: 'Analyze technical contradictions using TRIZ matrix' },
  { name: 'search', description: 'Search patents, papers, and technical solutions' },
  { name: 's-curve', description: 'Technology maturity S-curve analysis with TRL' },
  { name: 'ideality', description: 'Evaluate system ideality (benefits/costs/harms)' },
  { name: 'principles', description: 'List or search the 40 TRIZ inventive principles' },
  { name: 'su-field', description: 'Substance-Field model analysis' },
  { name: 'patent', description: 'Incrementally write a patent document (LLM appends section by section)' },
  { name: 'download', description: 'Download a paper PDF by DOI / arXiv ID / PMID / URL' },
  { name: 'get', description: 'Search OpenAlex and auto-download the top match (or top 3 with "all")' },
  { name: 'papers', description: 'List downloaded papers in the output directory' },
  { name: 'help', description: 'Show all available commands' },
  { name: 'ping', description: 'Probe LLM model token limits (context window, max output, working limit)' },
  { name: 'goal', description: 'Set, view, edit, pause, resume, annotate, log, or clear a persistent research goal' },
  { name: 'undo', description: 'Undo the last AI prompt — jj abandon the change created before that prompt' },
  { name: 'auto', description: 'Start/continue an AutoResearch iteration loop: propose → act → evaluate → ratchet' },
  { name: 'recover', description: 'Recover from token limit: trim stale messages and large tool results. Use /recover keep <N>' },
];

const allSlashCommands = [...staticSlashCommands, ...loadSkillSlashs.map(s => ({ name: s.name, description: s.description }))];

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {
    extensionContext = context;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    void _context;
    void _token;
    log.debug('resolveWebviewView called');
    chatView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'chat', 'webview'),
      ],
    };

    webviewView.webview.html = getWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      handleWebViewMessage,
      undefined,
      this.context.subscriptions
    );

    agentEvents.on(AgentEvent.TodoUpdate, (todos: Array<{ content: string; status: string; priority: string }>) => {
      if (chatView) {
        chatView.webview.postMessage({ type: 'todo-update', todos } as any);
      }
    });

    agentEvents.on(AgentEvent.GoalProgress, (msg: { completed: number; total: number; items?: string[] }) => {
      if (chatView) {
        chatView.webview.postMessage({ type: 'goal-progress', completed: msg.completed, total: msg.total, items: msg.items } as any);
        sendGoalStatus();
      }
    });

    chatView.onDidChangeVisibility(() => {
      if (chatView?.visible) {
        this.sendWelcome();
      }
    });

    this.sendWelcome();
  }

  private async sendWelcome(): Promise<void> {
    try {
      if (!chatView) {
        log.error('DEBUG: sendWelcome: chatView is null, bailing');
        return;
      }
      log.error('DEBUG: sendWelcome: starting');

      if (!sessionStore) {
        log.error('DEBUG: sendWelcome: before migrateOldHistory');
        sessionStore = await migrateOldHistory();
        log.error('DEBUG: sendWelcome: after migrateOldHistory');
      }

      if (!currentSession && sessionStore.activeSessionId) {
        log.error('DEBUG: sendWelcome: before loadSession');
        currentSession = await loadSession(sessionStore.activeSessionId);
        log.error('DEBUG: sendWelcome: after loadSession');
      }

      if (!currentSession) {
        log.error('DEBUG: sendWelcome: creating session');
        const session = createSession();
        sessionStore.sessions.push(sessionToMetadata(session));
        sessionStore.activeSessionId = session.id;
        await saveSessionStore(sessionStore);
        await saveSession(session);
        currentSession = session;
        log.error('DEBUG: sendWelcome: session created');
      }

      log.error('DEBUG: sendWelcome: before welcome postMessage');
      chatView.webview.postMessage({
        type: 'welcome',
        context: getWelcomeContext().context,
        personaName: getChatConfig().persona?.name ?? 'Research Assistant',
        slashCommands: allSlashCommands,
        sessionId: currentSession.id,
        sessionTitle: currentSession.title,
        sessions: sessionStore.sessions,
        isCompacted: currentSession.isCompacted,
        sandboxEnabled: getChatConfig().sandbox?.enabled ?? true,
        tokenUsage: computeTokenUsage(),
      } as any);
      log.error('DEBUG: sendWelcome: after welcome postMessage');

      log.error('DEBUG: sendWelcome: before agents-loaded postMessage');
      chatView.webview.postMessage({
        type: 'agents-loaded',
        agents: [{ name: getChatConfig().persona?.name ?? 'Research Assistant', description: 'TRIZ research expert' }, ...loadedAgents.map(a => ({ name: a.name, description: a.description }))],
      } as any);
      log.error('DEBUG: sendWelcome: after agents-loaded postMessage');

      log.error({ modelCount: loadedModels.length }, 'DEBUG: sendWelcome: posting models-loaded');
      chatView.webview.postMessage({
        type: 'models-loaded',
        models: loadedModels,
      } as any);
      log.error('DEBUG: sendWelcome: after models-loaded postMessage');

    if (pendingMcpStatus) {
      chatView.webview.postMessage({ type: 'mcp-status', servers: pendingMcpStatus } as any);
    } else {
      requestMcpStatus();
    }
    requestLspStatus();
    setLastWorkspaceRoot(getDefaultWorkspaceRoot() || '');
    requestTodoStatus();

    if (currentSession.messages.length > 0) {
      for (const msg of currentSession.messages) {
        chatView.webview.postMessage({ type: 'history-message', message: msg } as any);
      }
    } else if (currentSession.isCompacted && currentSession.compactedSummary) {
      const summaryMsg = createAssistantMessage();
      summaryMsg.content = `## Session Compaction Summary\n\n${currentSession.compactedSummary}`;
      summaryMsg.status = 'complete';
      chatView.webview.postMessage({ type: 'history-message', message: summaryMsg } as any);
    }

    // Push full queue snapshot on connect/reconnect
    chatView.webview.postMessage({
      type: 'queue-state',
      queue: messageQueue,
    } as any);
  } catch (e) {
    log.error({ err: e, stack: (e as Error)?.stack }, 'DEBUG: sendWelcome: UNCAUGHT ERROR');
  }
  }
}

export function registerChatPanel(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_TYPE, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.open', () => {
      vscode.commands.executeCommand('workbench.view.extension.trinno-chat');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.undoInsert', async () => {
      await undoLastAiInsert();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.clearHistory', async () => {
      if (currentSession) {
        currentSession.messages = [];
        delete currentSession.compactedSummary;
        currentSession.isCompacted = false;
        updateSessionTimestamp(currentSession);
        await saveSession(currentSession);
        if (chatView) {
          chatView.webview.postMessage({ type: 'clearHistory' } as any);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.newSession', async () => {
      await createNewSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.sendSelection', async () => {
      const config = getChatConfig();
      const text = extractEditorSelection(config.context?.max_chars_per_attachment ?? 2000);
      if (!text) {
        vscode.window.showInformationMessage('Select text in an editor first, then use this command.');
        return;
      }
      if (chatView) {
        chatView.webview.postMessage({ type: 'insert-to-input', attachment: text } as any);
        await vscode.commands.executeCommand('trinno-chat.open');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.deleteSession', async (sessionId?: string) => {
      if (sessionId) {
        await deleteSessionById(sessionId);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.sendContext', async () => {
      const config = getChatConfig();
      let ctx = extractNotebookCellSelection(config.context?.max_chars_per_attachment ?? 2000);
      if (!ctx) {
        ctx = extractEditorSelection(config.context?.max_chars_per_attachment ?? 2000);
      }
      if (!ctx) {
        vscode.window.showInformationMessage('No text selected. Select text in an editor or notebook cell first.');
        return;
      }
      if (chatView) {
        chatView.webview.postMessage({ type: 'insert-to-input', attachment: ctx } as any);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.sendFile', async () => {
      const nbEditor = vscode.window.activeNotebookEditor;
      if (nbEditor) {
        const config = getChatConfig();
        const ctx = await extractWholeNotebook(nbEditor.notebook.uri, config.context?.max_chars_per_attachment ?? 2000);
        if (!ctx) {
          vscode.window.showInformationMessage('Notebook is empty.');
          return;
        }
        if (chatView) {
          chatView.webview.postMessage({ type: 'insert-to-input', attachment: ctx } as any);
        }
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No editor open.');
        return;
      }
      const config = getChatConfig();
      const ctx = await extractWholeFile(editor.document.uri, config.context?.max_chars_per_attachment ?? 2000);
      if (!ctx) {
        vscode.window.showInformationMessage('Could not read file.');
        return;
      }
      if (chatView) {
        chatView.webview.postMessage({ type: 'insert-to-input', attachment: ctx } as any);
      }
    })
  );

  agentEvents.on(AgentEvent.McpStatus, (servers: Array<{ name: string; type: string; connected: boolean }>) => {
    pendingMcpStatus = servers;
    if (chatView) {
      chatView.webview.postMessage({ type: 'mcp-status', servers } as any);
    }
  });
  initializeAgent(getDefaultWorkspaceRoot()).catch(() => { });

  agentEvents.on(AgentEvent.LspStatus, (status: { name: string; status: string; trackedFile: string | null }) => {
    if (chatView) {
      chatView.webview.postMessage({ type: 'lsp-status', ...status } as any);
    }
  });
}

async function createNewSession(title?: string): Promise<void> {
  if (!sessionStore) {
    sessionStore = await loadSessionStore();
  }

  const session = createSession(title);
  sessionStore.sessions.push(sessionToMetadata(session));
  sessionStore.activeSessionId = session.id;
  await saveSessionStore(sessionStore);
  await saveSession(session);
  currentSession = session;

  if (chatView) {
    chatView.webview.postMessage({ type: 'clearHistory' } as any);
    await (chatView as any).webview.postMessage({
      type: 'session-updated',
      sessionId: session.id,
      sessionTitle: session.title,
      sessions: sessionStore.sessions,
      isCompacted: false,
    } as ExtToWebViewMessage);
    sendGoalStatus();
  }
}

async function switchSession(sessionId: string): Promise<void> {
  // Cancel any ongoing generation before switching
  if (isGenerating) {
    cancelGeneration();
    finalizeCurrentMessage();
    clearQueue();
    // Give worker time to process cancellation
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  try {
    if (!sessionStore) {
      sessionStore = await loadSessionStore();
    }

    // Save current session before switching
    if (currentSession) {
      updateSessionTimestamp(currentSession);
      await saveSession(currentSession);
    }

    const session = await loadSession(sessionId);
    if (!session) {
      log.warn({ sessionId }, 'Session not found');
      if (chatView) {
        chatView.webview.postMessage({ type: 'error', messageId: '', error: `Session not found: ${sessionId}` } as any);
      }
      return;
    }

    sessionStore.activeSessionId = sessionId;
    currentSession = session;

    const sessionIndex = sessionStore.sessions.findIndex(s => s.id === sessionId);
    if (sessionIndex >= 0) {
      sessionStore.sessions[sessionIndex] = sessionToMetadata(session);
    } else {
      sessionStore.sessions.push(sessionToMetadata(session));
    }

    await saveSessionStore(sessionStore);

    if (chatView) {
      chatView.webview.postMessage({ type: 'clearHistory' } as any);
      for (const msg of session.messages) {
        chatView.webview.postMessage({ type: 'history-message', message: msg } as any);
      }
      chatView.webview.postMessage({
        type: 'session-updated',
        sessionId: session.id,
        sessionTitle: session.title,
        sessions: sessionStore.sessions,
        isCompacted: session.isCompacted,
      } as any);
      sendGoalStatus();
      // Send full queue snapshot
      chatView.webview.postMessage({
        type: 'queue-state',
        queue: messageQueue,
      } as any);
    }
  } catch (err) {
    log.warn({ err }, 'Error switching session');
    if (chatView) {
      chatView.webview.postMessage({ type: 'error', messageId: '', error: `Failed to switch session: ${err instanceof Error ? err.message : String(err)}` } as any);
    }
  }
}

async function deleteSessionById(sessionId: string): Promise<void> {
  if (!sessionStore) return;

  await deleteSession(sessionId);
  sessionStore.sessions = sessionStore.sessions.filter(s => s.id !== sessionId);

  if (sessionStore.activeSessionId === sessionId) {
    if (sessionStore.sessions.length > 0) {
      const lastSession = sessionStore.sessions[sessionStore.sessions.length - 1];
      if (lastSession) {
        sessionStore.activeSessionId = lastSession.id;
        await switchSession(lastSession.id);
      }
    } else {
      await createNewSession();
    }
  } else {
    await saveSessionStore(sessionStore);
    if (chatView) {
      chatView.webview.postMessage({
        type: 'session-list-updated',
        sessions: sessionStore.sessions,
      } as any);
    }
  }
}

async function renameSessionById(sessionId: string, title: string): Promise<void> {
  if (!sessionStore) return;
  const metadata = sessionStore.sessions.find(s => s.id === sessionId);
  if (!metadata) return;

  metadata.title = title;
  metadata.updatedAt = Date.now();
  await saveSessionStore(sessionStore);

  const session = await loadSession(sessionId);
  if (session) {
    session.title = title;
    session.updatedAt = Date.now();
    await saveSession(session);
  }

  if (chatView) {
    chatView.webview.postMessage({
      type: 'session-title-updated',
      sessionId,
      title,
    } as any);
    chatView.webview.postMessage({
      type: 'session-list-updated',
      sessions: sessionStore.sessions,
    } as any);
  }
}

function pushQueueState(): void {
  if (chatView) {
    chatView.webview.postMessage({
      type: 'queue-state',
      queue: messageQueue,
    } as any);
  }
}

function addToQueue(text: string): QueuedMessage | null {
  if (messageQueue.length >= MAX_QUEUE_SIZE) return null;
  const item: QueuedMessage = {
    queueId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text,
    timestamp: Date.now(),
    status: 'queued',
  };
  messageQueue.push(item);
  if (chatView) {
    chatView.webview.postMessage({ type: 'queue-add', message: item } as any);
  }
  return item;
}

function removeFromQueue(queueId: string): void {
  // Active (already-dequeued) item — cancel and clean up
  if (queueId === currentQueueId) {
    cancelGeneration();
    finalizeCurrentMessage();
    isGenerating = false;
    currentQueueId = null;
    dequeuedItemText = null;
    if (chatView) {
      chatView.webview.postMessage({ type: 'queue-remove', queueId } as any);
    }
    setImmediate(() => processQueue());
    return;
  }

  const idx = messageQueue.findIndex(q => q.queueId === queueId);
  if (idx < 0) return;

  // Pending item — just remove
  messageQueue.splice(idx, 1);
  if (chatView) {
    chatView.webview.postMessage({ type: 'queue-remove', queueId } as any);
  }
}

function forceExecuteQueueItem(queueId: string): void {
  const idx = messageQueue.findIndex(q => q.queueId === queueId);
  if (idx < 0) return;

  cancelGeneration();
  finalizeCurrentMessage();
  // In-flight item was already removed from extension queue
  // Webview still has it — tell it to remove
  if (currentQueueId) {
    if (chatView) {
      chatView.webview.postMessage({ type: 'queue-remove', queueId: currentQueueId } as any);
    }
    currentQueueId = null;
    dequeuedItemText = null;
  }
  isGenerating = false;

  // Move forced item to front
  const newIdx = messageQueue.findIndex(q => q.queueId === queueId);
  if (newIdx < 0) return;
  const item = messageQueue[newIdx]!;
  messageQueue.splice(newIdx, 1);
  messageQueue.unshift(item);

  processQueue();
}

function processQueue(): void {
  if (autoDrainLock) return;
  if (isGenerating) return;

  const nextIdx = messageQueue.findIndex(q => q.status === 'queued');
  if (nextIdx < 0) return;

  const item = messageQueue[nextIdx]!;
  messageQueue.splice(nextIdx, 1);
  dequeuedItemText = item.text;
  currentQueueId = item.queueId;
  if (chatView) {
    chatView.webview.postMessage({
      type: 'queue-status-change',
      queueId: item.queueId,
      status: 'in-flight',
    } as any);
  }

  handleUserMessage(item.text);
}

function markQueueCompleted(queueId: string): void {
  const item = messageQueue.find(q => q.queueId === queueId);
  if (item) {
    item.status = 'completed';
  }
  if (chatView) {
    chatView.webview.postMessage({
      type: 'queue-status-change',
      queueId,
      status: 'completed',
    } as any);
  }
}

function markQueueError(queueId: string, error: string): void {
  const item = messageQueue.find(q => q.queueId === queueId);
  if (item) {
    item.status = 'error';
    item.error = error;
  }
  if (chatView) {
    chatView.webview.postMessage({
      type: 'queue-status-change',
      queueId,
      status: 'error',
      error,
    } as any);
  }
}

function markQueueRateLimited(queueId: string): void {
  const item = messageQueue.find(q => q.queueId === queueId);
  if (item) {
    item.status = 'rate-limited';
  }
  if (chatView) {
    chatView.webview.postMessage({
      type: 'queue-status-change',
      queueId,
      status: 'rate-limited',
    } as any);
  }
}

function clearQueue(): void {
  messageQueue = [];
  autoDrainLock = false;
  currentQueueId = null;
  dequeuedItemText = null;
  if (chatView) {
    chatView.webview.postMessage({
      type: 'queue-state',
      queue: [],
    } as any);
  }
}

async function handleWebViewMessage(msg: WebViewToExtMessage & { sessionId?: string; sessionAction?: string }): Promise<void> {
  log.trace({ msgType: msg.type, textLength: 'text' in msg ? (msg as any).text?.length : undefined }, 'handleWebViewMessage');
  if (msg.type === 'trace') {
    log.trace({ textLength: msg.textLength, text: msg.text }, 'webview trace');
    return;
  }
  if (msg.type === 'userMessage') {
    await handleUserMessage(msg.text);
  } else if (msg.type === 'cancel') {
    cancelGeneration();
    finalizeCurrentMessage();
    isGenerating = false;
    if (currentQueueId) {
      if (chatView) {
        chatView.webview.postMessage({ type: 'queue-remove', queueId: currentQueueId } as any);
      }
      currentQueueId = null;
      dequeuedItemText = null;
    }
    clearQueue();
  } else if (msg.type === 'undoInsert') {
    await undoLastAiInsert();
  } else if (msg.type === 'contextRequest') {
    const ctx = extractNotebookContext();
    if (chatView) {
      chatView.webview.postMessage({ type: 'context-update', context: ctx } as ExtToWebViewMessage);
    }
  } else if (msg.type === 'insertCell') {
    await insertCellAt(msg.content, msg.cellType, msg.position ?? 'cursor');
  } else if (msg.type === 'newSession') {
    await createNewSession();
  } else if (msg.type === 'switchSession' && msg.sessionId) {
    await switchSession(msg.sessionId);
  } else if (msg.type === 'deleteSession' && msg.sessionId) {
    await deleteSessionById(msg.sessionId);
  } else if (msg.type === 'renameSession' && msg.sessionId && msg.title) {
    await renameSessionById(msg.sessionId, msg.title);
  } else if (msg.type === 'sendSelection') {
    await vscode.commands.executeCommand('trinno-chat.sendContext');
  } else if (msg.type === 'sendFile') {
    await vscode.commands.executeCommand('trinno-chat.sendFile');
  } else if (msg.type === 'chooseFile') {
    await handleChooseFile();
  } else if (msg.type === 'setAgent') {
    const agent = loadedAgents.find(a => a.name === msg.agent);
    selectedAgentContent = agent ? agent.content : undefined;
    log.debug({ agent: msg.agent, hasContent: !!selectedAgentContent }, 'Agent set');
  } else if (msg.type === 'setModel') {
    if (msg.model === 'Auto') {
      selectedModelConfig = undefined;
    } else {
      selectedModelConfig = loadedModels.find(m => m.name === msg.model);
    }
  } else if (msg.type === 'openSettings') {
    openConfig();
  } else if (msg.type === 'tool-approval') {
    sendToolApproval(msg.id, msg.approved, msg.remember);
  } else if (msg.type === 'rate-limited-retry') {
    log.info({ messageId: msg.messageId }, '[RATE-LIMIT] webview clicked Retry Now — check rateLimitRetryCallback exists and call it');
    handleRateLimitedRetry();
  } else if (msg.type === 'write-topic-confirm') {
    const topic = msg.topic.trim();
    if (!topic) {
      chatView?.webview.postMessage({
        type: 'user-message',
        message: createAssistantMessageForText('标题不能为空。请重新输入。'),
      } as any);
      return;
    }
    const phase = msg.docType === 'patent' ? '07_Patent' : '05_Deliver';
    const cmd = {
      title: topic,
      phase,
      writePath: `${phase}/${slugifyPatentTitle(topic)}.typ`,
    };
    await runSkillWrite(msg.docType, cmd, msg.originalText);
  } else if (msg.type === 'write-topic-cancel') {
    chatView?.webview.postMessage({
      type: 'user-message',
      message: createAssistantMessageForText('已取消撰写。如需重新开始，请提供标题，例如：write paper: <你的标题>'),
    } as any);
  } else if (msg.type === 'request-file-list') {
    const workspaceRoot = getDefaultWorkspaceRoot();
    if (!workspaceRoot) {
      chatView?.webview.postMessage({ type: 'file-list', workspaceRoot: '', files: [] } as ExtToWebViewMessage);
      return;
    }
    void sendFileList(workspaceRoot);
  } else if (msg.type === 'queue-remove' && msg.queueId) {
    removeFromQueue(msg.queueId);
  } else if (msg.type === 'queue-force-execute' && msg.queueId) {
    forceExecuteQueueItem(msg.queueId);
  }
}

async function handleChooseFile(): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Send to Chat',
  });
  if (!uris || uris.length === 0) return;

  const uri = uris[0];
  if (!uri) return;

  const config = getChatConfig();
  const isNotebook = uri.fsPath.endsWith('.ipynb');
  const ctx = isNotebook
    ? await extractWholeNotebook(uri, config.context?.max_chars_per_attachment ?? 2000)
    : await extractWholeFile(uri, config.context?.max_chars_per_attachment ?? 2000);
  if (!ctx) {
    vscode.window.showInformationMessage('Could not read file.');
    return;
  }
  if (chatView) {
    chatView.webview.postMessage({ type: 'insert-to-input', attachment: ctx } as any);
  }
}

async function handleSessionCommand(args: string): Promise<void> {
  if (!chatView || !currentSession || !sessionStore) return;

  const trimmed = args.trim().toLowerCase();

  if (!trimmed) {
    chatView.webview.postMessage({ type: 'showSessionDialog' } as any);
    return;
  }

  if (trimmed === 'list') {
    let text = `## Sessions\n\n`;
    const sorted = [...sessionStore.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const s of sorted) {
      const active = s.id === currentSession.id ? ' ◀ active' : '';
      const compacted = s.isCompacted ? ' 📦' : '';
      const time = new Date(s.updatedAt).toLocaleString();
      text += `${sorted.indexOf(s) + 1}. **${s.title}** (${s.messageCount} msgs)${compacted}${active}\n   \`${s.id.slice(0, 20)}...\` · ${time}\n\n`;
    }
    text += `\n**Usage:** \`/session new\` | \`/session select <id>\` | \`/session delete <id>\` | \`/session rename <title>\``;
    chatView.webview.postMessage({ type: 'user-message', message: createUserMessage('/session list') } as any);
    chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText(text) } as any);
    return;
  }

  if (trimmed === 'new') {
    chatView.webview.postMessage({ type: 'user-message', message: createUserMessage('/session new') } as any);
    await createNewSession();
    chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText(`**New session created.**\n\nSession: \`${currentSession.id.slice(0, 20)}...\`\nTitle: ${currentSession.title}`) } as any);
    return;
  }

  const selectMatch = trimmed.match(/^select\s+(.+)$/);
  if (selectMatch?.[1]) {
    const query = selectMatch[1].trim();
    const target = sessionStore.sessions.find(s => s.id.startsWith(query) || s.id === query);
    if (!target) {
      chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(`/session select ${query}`) } as any);
      chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText(`Session not found: \`${query}\`\n\nUse \`/session list\` to see available sessions.`) } as any);
      return;
    }
    chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(`/session select ${query}`) } as any);
    await switchSession(target.id);
    chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText(`**Switched to session:** ${target.title}\n\nMessages: ${target.messageCount}`) } as any);
    return;
  }

  const deleteMatch = trimmed.match(/^delete\s+(.+)$/);
  if (deleteMatch?.[1]) {
    const query = deleteMatch[1].trim();
    const target = sessionStore.sessions.find(s => s.id.startsWith(query) || s.id === query);
    if (!target) {
      chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(`/session delete ${query}`) } as any);
      chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText(`Session not found: \`${query}\``) } as any);
      return;
    }
    chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(`/session delete ${query}`) } as any);
    await deleteSessionById(target.id);
    chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText(`**Deleted session:** ${target.title}`) } as any);
    return;
  }

  const renameMatch = args.match(/^rename\s+(.+)$/i);
  if (renameMatch?.[1]) {
    const newTitle = renameMatch[1].trim();
    currentSession.title = newTitle;
    updateSessionTimestamp(currentSession);
    await saveSession(currentSession);
    chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(`/session rename ${newTitle}`) } as any);
    chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText(`**Session renamed to:** ${newTitle}`) } as any);
    chatView.webview.postMessage({
      type: 'session-title-updated',
      sessionId: currentSession.id,
      title: newTitle,
    } as any);
    return;
  }

  chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(`/session ${args}`) } as any);
  chatView.webview.postMessage({
    type: 'history-message',
    message: createAssistantMessageForText(`Unknown session command: \`${args}\`\n\n**Usage:**\n- \`/session list\` - List all sessions\n- \`/session new\` - Create new session\n- \`/session select <id>\` - Switch to session\n- \`/session delete <id>\` - Delete session\n- \`/session rename <title>\` - Rename current session`),
  } as any);
}

function createAssistantMessageForText(text: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_assistant`,
    role: 'assistant',
    content: text,
    reasoning: '',
    toolCalls: [],
    timestamp: Date.now(),
    status: 'complete',
  };
}

async function handleDownloadCommand(identifier: string): Promise<void> {
  if (!chatView) return;

  const trimmed = identifier.trim();
  if (!trimmed) {
    chatView.webview.postMessage({
      type: 'user-message',
      message: createUserMessage('/download'),
    } as any);
    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText(
        '**Usage:** `/download <DOI|arXiv ID|PMID|url>`\n\n' +
        'Examples:\n' +
        '- `/download 10.1038/nature12373`\n' +
        '- `/download arXiv:2401.01234`\n' +
        '- `/download 2401.01234`\n' +
        '- `/download https://doi.org/10.1126/science.aec6396`\n\n' +
        'PDFs are saved to `<workspace>/.trinno/papers/` (or `~/.trinno/papers/` outside a workspace).',
      ),
    } as any);
    return;
  }

  const echoText = `/download ${trimmed}`;
  chatView.webview.postMessage({
    type: 'user-message',
    message: createUserMessage(echoText),
  } as any);

  const onProgress = (p: { source: string; status: 'start' | 'fail' | 'success'; filePath?: string; error?: string }): void => {
    if (!chatView) return;
    const icon = p.status === 'success' ? '✅' : p.status === 'fail' ? '⚠️' : '⏳';
    const detail = p.error ? ` — ${p.error}` : p.filePath ? ` → \`${p.filePath}\`` : '';
    chatView.webview.postMessage({
      type: 'paper-progress',
      source: p.source,
      status: p.status,
      text: `${icon} ${p.source}${detail}`,
    } as any);
  };

  let result;
  try {
    const wsRoot = getDefaultWorkspaceRoot();
    result = await downloadPaper({ outputDir: wsRoot ? path.join(wsRoot, '06_References') : '', identifier: trimmed }, onProgress);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText(`**Download failed:** ${msg}`),
    } as any);
    return;
  }

  if (result.ok) {
    const meta = result.meta;
    const lines: string[] = [];
    lines.push(`**Downloaded** via \`${result.source}\``);
    if (meta) {
      if (meta.title) lines.push(`**Title:** ${meta.title}`);
      if (meta.authors.length > 0) lines.push(`**Authors:** ${meta.authors.join(', ')}`);
      if (meta.year) lines.push(`**Year:** ${meta.year}`);
      if (meta.venue) lines.push(`**Venue:** ${meta.venue}`);
      if (meta.doi) lines.push(`**DOI:** ${meta.doi}`);
    }
    if (result.filePath) lines.push(`**Saved to:** \`${result.filePath}\``);
    if (typeof result.bytes === 'number') lines.push(`**Size:** ${(result.bytes / 1024).toFixed(1)} KB`);
    if (result.format) lines.push(`**Format:** ${result.format}`);
    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText(lines.join('\n')),
    } as any);
  } else {
    const lines: string[] = [`**Download failed.**\n\n${result.error || 'Unknown error'}`];
    if (result.attempts && result.attempts.length > 0) {
      lines.push('\n**Source attempts:**');
      for (const a of result.attempts.slice(0, 8)) {
        lines.push(`- \`${a.source}\`: ${a.error}`);
      }
    }
    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText(lines.join('\n')),
    } as any);
  }
}

async function handleHelpCommand(_args: string): Promise<void> {
  const lines: string[] = ['## Available Commands', ''];
  for (const cmd of staticSlashCommands) {
    lines.push(`- \`/${cmd.name}\` — ${cmd.description}`);
  }
  const skillNames = loadedSkills.map(s => `\`/${s.name}\``);
  if (skillNames.length > 0) {
    lines.push('', '## Custom Skills', '', ...skillNames.map(n => `- ${n}`));
  }
  lines.push('', '_Tip: `/<name> <args>` runs the command. Slash commands are case-insensitive._');
  chatView?.webview.postMessage({
    type: 'history-message',
    message: createAssistantMessageForText(lines.join('\n')),
  } as any);
}

async function handlePapersCommand(args: string): Promise<void> {
  if (!chatView) return;
  const echoText = args ? `/papers ${args}` : '/papers';
  chatView.webview.postMessage({
    type: 'user-message',
    message: createUserMessage(echoText),
  } as any);

  const wsRoot = getDefaultWorkspaceRoot();
  const dir = wsRoot ? path.join(wsRoot, '06_References') : '';
  const items = listDownloadedPapers(dir);
  if (items.length === 0) {
    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText('No papers downloaded yet. Use `/download <DOI|arXiv ID|PMID|url>` to fetch one.'),
    } as any);
    return;
  }
  const lines: string[] = [`**Downloaded papers** (${items.length})`, ''];
  for (const item of items.slice(0, 20)) {
    const name = item.filePath.split(/[\\/]/).pop() || item.filePath;
    const sizeKb = (item.size / 1024).toFixed(1);
    const date = new Date(item.mtime).toLocaleString();
    lines.push(`- \`${name}\` — ${sizeKb} KB, ${date}`);
  }
  if (items.length > 20) lines.push(`\n_…and ${items.length - 20} more_`);
  chatView.webview.postMessage({
    type: 'history-message',
    message: createAssistantMessageForText(lines.join('\n')),
  } as any);
}

function formatHitHeader(hit: SearchHit, index: number, total: number): string {
  const authorStr = hit.authors.length > 0 ? hit.authors.slice(0, 3).join(', ') + (hit.authors.length > 3 ? ' et al' : '') : 'Unknown authors';
  const year = hit.year ?? 'n.d.';
  const venue = hit.venue ? ` — _${hit.venue}_` : '';
  const doi = hit.doi ? ` (DOI: \`${hit.doi}\`)` : hit.arxivId ? ` (arXiv: \`${hit.arxivId}\`)` : '';
  return `**[${index}/${total}]** ${hit.title}\n${authorStr}, ${year}${venue}${doi}`;
}

async function handleGetCommand(args: string): Promise<void> {
  if (!chatView) return;

  const trimmed = args.trim();
  if (!trimmed) {
    chatView.webview.postMessage({
      type: 'user-message',
      message: createUserMessage('/get'),
    } as any);
    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText(
        '**Usage:** `/get <query>` — search OpenAlex and auto-download the top match.\n\n' +
        'Add ` all` to download the top 3 matches:\n' +
        '- `/get lithium-ion battery cathode optimization`\n' +
        '- `/get attention is all you need all`',
      ),
    } as any);
    return;
  }

  let downloadAll = false;
  let query = trimmed;
  if (/\ball\b$/i.test(query)) {
    downloadAll = true;
    query = query.replace(/\s*\ball\b\s*$/i, '').trim();
  }
  if (!query) {
    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText('Empty query after stripping modifiers.'),
    } as any);
    return;
  }

  const limit = downloadAll ? 3 : 1;
  const echoText = `/get ${trimmed}`;
  chatView.webview.postMessage({
    type: 'user-message',
    message: createUserMessage(echoText),
  } as any);
  chatView.webview.postMessage({
    type: 'history-message',
    message: createAssistantMessageForText(`🔎 Searching OpenAlex for **${query}** (top ${limit})…`),
  } as any);

  const hits = await searchOpenAlex(query, limit);
  if (hits.length === 0) {
    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText(`No results for **${query}**.`),
    } as any);
    return;
  }

  const total = hits.length;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const lines: string[] = [`## Search results (${total} hit${total === 1 ? '' : 's'})`, ''];

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const identifier = hitToIdentifier(hit);

    lines.push(formatHitHeader(hit, i + 1, total));
    if (!identifier) {
      lines.push(`  ⛔ No DOI or arXiv ID — cannot download.`);
      lines.push('');
      skipped += 1;
      continue;
    }

    if (hit.pdfUrl) {
      lines.push(`  📎 OA PDF preview: ${hit.pdfUrl}`);
    }

    chatView.webview.postMessage({
      type: 'history-message',
      message: createAssistantMessageForText(`⏳ Downloading [${i + 1}/${total}] via \`${identifier}\`…`),
    } as any);

    let result;
    try {
      result = await downloadPaper({ outputDir: '', identifier: identifier.value }, () => { /* progress ignored per-hit */ });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      lines.push(`  ❌ Error: ${msg}`);
      lines.push('');
      failed += 1;
      continue;
    }

    if (result.ok) {
      const meta = result.meta;
      const sizeKb = result.bytes ? `${(result.bytes / 1024).toFixed(1)} KB` : '';
      const where = result.filePath ? ` → \`${result.filePath}\`` : '';
      const via = result.source ? ` via \`${result.source}\`` : '';
      const usedMetaTitle = meta?.title && meta.title !== hit.title ? ` (auto-renamed: ${meta.title})` : '';
      lines.push(`  ✅ Saved${sizeKb ? ` (${sizeKb})` : ''}${via}${where}${usedMetaTitle}`);
      downloaded += 1;
    } else {
      lines.push(`  ❌ ${result.error || 'No source could provide a PDF.'}`);
      failed += 1;
    }
    lines.push('');
  }

  const summary = downloaded === total
    ? `🎉 Auto-downloaded all ${total} match${total === 1 ? '' : 'es'}.`
    : downloaded > 0
      ? `⚠️ Downloaded ${downloaded} of ${total} (${failed} failed, ${skipped} skipped).`
      : `❌ Could not download any of the ${total} match${total === 1 ? '' : 'es'}.`;
  lines.push(`**${summary}**`);

  chatView.webview.postMessage({
    type: 'history-message',
    message: createAssistantMessageForText(lines.join('\n')),
  } as any);
}

let rateLimitTimer: ReturnType<typeof setInterval> | null = null;
let rateLimitRetryCallback: (() => void) | null = null;
let rateLimitRetryCount = 0;
const MAX_RATE_LIMIT_RETRIES = 3;

export function _resetRateLimitRetriesForTest(): void {
  rateLimitRetryCount = 0;
}

export function _getRateLimitRetryStateForTest(): { count: number; max: number } {
  return { count: rateLimitRetryCount, max: MAX_RATE_LIMIT_RETRIES };
}

function handleRateLimited(retryAfter: number, error: string): void {
  log.warn({ retryAfter, error }, '[RATE-LIMIT] LLM returned 429 — pausing generation');
  void error;
  if (!currentStreamingId) return;
  const messageId = currentStreamingId;
  const seconds = Math.max(1, Math.round(retryAfter)) * Math.pow(2, rateLimitRetryCount);

  if (chatView) {
    chatView.webview.postMessage({
      type: 'rate-limited',
      messageId,
      retryAfter: seconds,
    } as any);
    // Also notify queue panel about rate-limit pause
    if (currentQueueId) {
      chatView.webview.postMessage({
        type: 'queue-status-change',
        queueId: currentQueueId,
        status: 'rate-limited',
      } as any);
    }
  }

  if (rateLimitTimer) clearInterval(rateLimitTimer);

  let remaining = seconds;
  rateLimitTimer = setInterval(() => {
    remaining--;
    if (chatView) {
      chatView.webview.postMessage({
        type: 'rate-limited-tick',
        messageId,
        remaining,
      } as any);
    }
    if (remaining <= 0) {
      if (rateLimitTimer) clearInterval(rateLimitTimer);
      rateLimitTimer = null;
      // Auto-retry for both queued and direct messages
      log.trace({ remaining, hasCallback: !!rateLimitRetryCallback, hasQueueId: !!currentQueueId, hasDequeuedText: !!dequeuedItemText }, '[RATE-LIMIT] countdown expired');
      if (rateLimitRetryCallback) {
        rateLimitRetryCallback();
      } else if (currentQueueId && dequeuedItemText) {
        finalizeCurrentMessage();
        // Re-add to extension queue (was removed in processQueue)
        messageQueue.push({
          queueId: currentQueueId,
          text: dequeuedItemText,
          timestamp: Date.now(),
          status: 'queued',
        });
        // Webview still has the item; update its status back to queued
        if (chatView) {
          chatView.webview.postMessage({
            type: 'queue-status-change',
            queueId: currentQueueId,
            status: 'queued',
          } as any);
        }
        currentQueueId = null;
        dequeuedItemText = null;
        setImmediate(() => processQueue());
      }
    }
  }, 1000);

  rateLimitRetryCallback = () => {
    if (rateLimitTimer) clearInterval(rateLimitTimer);
    rateLimitTimer = null;
    rateLimitRetryCallback = null;
    if (rateLimitRetryCount >= MAX_RATE_LIMIT_RETRIES) {
      const mid = currentStreamingId;
      finalizeCurrentMessage();
      if (currentQueueId) markQueueError(currentQueueId, `已达到最大重试次数 (${MAX_RATE_LIMIT_RETRIES})。`);
      const savedQueueId2 = currentQueueId;
      currentQueueId = null;
      dequeuedItemText = null;
      if (chatView && mid) {
        chatView.webview.postMessage({
          type: 'error',
          messageId: mid,
          error: `已达到最大重试次数 (${MAX_RATE_LIMIT_RETRIES})。请稍后再试或检查 API 配额。`,
        } as any);
      }
      if (savedQueueId2) {
        setImmediate(() => processQueue());
      }
      return;
    }
    rateLimitRetryCount++;
    log.trace({ retryCount: rateLimitRetryCount, hasQueueId: !!currentQueueId, hasDequeuedText: !!dequeuedItemText, hasLastText: !!lastUserMessageText, hasChatView: !!chatView, hasSession: !!currentSession }, '[RATE-LIMIT] retry callback proceeding');

    if (!chatView || !currentSession) return;

    if (currentQueueId && dequeuedItemText) {
      // Queued message: re-add to queue and drain
      finalizeCurrentMessage();
      messageQueue.push({
        queueId: currentQueueId,
        text: dequeuedItemText,
        timestamp: Date.now(),
        status: 'queued',
      });
      chatView.webview.postMessage({
        type: 'queue-status-change',
        queueId: currentQueueId,
        status: 'queued',
      } as any);
      currentQueueId = null;
      dequeuedItemText = null;
      setImmediate(() => processQueue());
    } else if (lastUserMessageText) {
      // Direct message: resend — don't set isGenerating=true here,
      // handleUserMessage would see it and *queue* instead of send.
      finalizeCurrentMessage();
      handleUserMessage(lastUserMessageText);
    }
  };
}

function resetRateLimitRetries(): void {
  rateLimitRetryCount = 0;
}

let lastUserMessageText: string = '';

function handleRateLimitedRetry(): void {
  log.trace({ hasCallback: !!rateLimitRetryCallback, retryCount: rateLimitRetryCount }, '[RATE-LIMIT] handleRateLimitedRetry called');
  if (rateLimitRetryCallback) {
    rateLimitRetryCallback();
    rateLimitRetryCallback = null;
  }
}

let _autoCompactInProgress = false;

interface ModelProfile {
  maxInput?: number;
  workingLimit?: number;
}

function getEffectiveModelName(): string {
  const config = getChatConfig();
  return selectedModelConfig?.model ?? config.global_model?.model ?? '';
}

let _modelProfilesCache: Record<string, ModelProfile> | null = null;

function getModelProfile(modelName: string): ModelProfile | null {
  if (!_modelProfilesCache) {
    try {
      const cachePath = path.join(os.homedir(), '.trinno', 'model-profiles.json');
      _modelProfilesCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Record<string, ModelProfile>;
    } catch {
      _modelProfilesCache = {};
    }
  }
  return _modelProfilesCache[modelName] ?? null;
}

function getAutoCompactThreshold(modelName: string): number {
  const profile = getModelProfile(modelName);
  if (!profile) return 0;
  const limit = profile.workingLimit || profile.maxInput || 0;
  if (limit <= 0) return 0;
  return Math.round(limit * 0.9);
}

function isTrpWorkspaceRoot(p: string): boolean {
  const phaseDirs = ['01_Discover', '02_TRL', '03_Analyze', '04_Synthesize', '05_Deliver', '06_References', '07_Patent'];
  let hits = 0;
  try {
    for (const d of phaseDirs) {
      if (fs.existsSync(path.join(p, d))) hits += 1;
    }
  } catch { /* ignore */ }
  return hits >= 3;
}

function getTrpWorkspaceRoot(): string | undefined {
  const ed = vscode.window.activeTextEditor;
  const folders = vscode.workspace.workspaceFolders;
  const candidates: string[] = [];
  if (ed) {
    const active = vscode.workspace.getWorkspaceFolder(ed.document.uri)?.uri.fsPath;
    if (active) candidates.push(active);
  }
  if (folders) {
    for (const f of folders) candidates.push(f.uri.fsPath);
  }
  for (const root of candidates) {
    if (isTrpWorkspaceRoot(root)) return root;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const sub = path.join(root, e.name);
        if (isTrpWorkspaceRoot(sub)) return sub;
      }
    } catch { /* ignore */ }
  }

  return folders?.[0]?.uri.fsPath;
}

function getDefaultWorkspaceRoot(): string | undefined {
  return getTrpWorkspaceRoot();
}

function readGoalForPanel(): { text: string; status: string; note?: string; progress?: { completed: number; total: number } } | null {
  const root = getDefaultWorkspaceRoot();
  if (!root) return null;
  try {
    const fp = path.join(root, '.trinno', 'goal.json');
    const data = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.text === 'string' && typeof parsed.status === 'string') {
      const out: { text: string; status: string; note?: string; progress?: { completed: number; total: number } } = { text: parsed.text, status: parsed.status };
      if (typeof parsed.note === 'string') out.note = parsed.note;
      if (parsed.progress && typeof parsed.progress.completed === 'number' && typeof parsed.progress.total === 'number') {
        out.progress = { completed: parsed.progress.completed, total: parsed.progress.total };
      }
      return out;
    }
  } catch { /* no goal set */ }
  return null;
}

let _lastGoalStatus: string | null = null;

function sendGoalStatus(): void {
  if (!chatView) return;
  const goal = readGoalForPanel();
  if (!goal || !goal.text) {
    _lastGoalStatus = null;
    chatView.webview.postMessage({ type: 'goal-block', goal: null } as any);
    return;
  }
  const statusKey = `${goal.status}:${goal.text}:${goal.note ?? ''}:${goal.progress ? `${goal.progress.completed}/${goal.progress.total}` : ''}`;
  if (statusKey === _lastGoalStatus) return;
  chatView.webview.postMessage({
    type: 'goal-block',
    goal,
  } as any);
  _lastGoalStatus = statusKey;
}

async function sendFileList(workspaceRoot: string): Promise<void> {
  const MAX_FILES = 500;
  const excludedDirs = ['node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache', 'coverage', '.vscode', '.idea'];
  const files: FileEntry[] = [];
  try {
    const topEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(workspaceRoot));
    const queue: { uri: vscode.Uri; rel: string }[] = [];
    for (const [name, type] of topEntries) {
      if (excludedDirs.includes(name) || name.startsWith('.')) continue;
      const uri = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), name);
      if (type === vscode.FileType.Directory) {
        files.push({ path: name + '/', isDir: true });
        queue.push({ uri, rel: name });
      } else if (type === vscode.FileType.File) {
        files.push({ path: name, isDir: false });
      }
    }
    while (queue.length > 0 && files.length < MAX_FILES * 2) {
      const next = queue.shift()!;
      let children: [string, vscode.FileType][];
      try {
        children = await vscode.workspace.fs.readDirectory(next.uri);
      } catch {
        continue;
      }
      for (const [childName, childType] of children) {
        if (files.length >= MAX_FILES * 2) break;
        const childRel = `${next.rel}/${childName}`;
        const childUri = vscode.Uri.joinPath(next.uri, childName);
        if (childType === vscode.FileType.Directory) {
          files.push({ path: childRel + '/', isDir: true });
          queue.push({ uri: childUri, rel: childRel });
        } else {
          files.push({ path: childRel, isDir: false });
        }
      }
    }
  } catch (err) {
    log.warn({ err }, 'sendFileList error');
  }
  const trimmed = files.slice(0, MAX_FILES);
  chatView?.webview.postMessage({
    type: 'file-list',
    workspaceRoot,
    files: trimmed,
  } as ExtToWebViewMessage);
}

async function runSkillWrite(type: 'paper' | 'patent', cmd: { title: string; phase: string; writePath: string }, originalText: string): Promise<void> {
  const docLabel = type === 'patent' ? '专利' : '论文';
  const skillName = type === 'patent' ? 'patent-writer' : 'paper-writer';
  const workspaceRoot = getDefaultWorkspaceRoot();

  if (!workspaceRoot) {
    chatView?.webview.postMessage({
      type: 'user-message',
      message: createAssistantMessageForText('未找到工作区根目录。请先打开一个工作区文件夹。'),
    } as any);
    return;
  }

  const targetPath = path.join(workspaceRoot, cmd.writePath);
  try {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const existing = await fs.promises.readFile(targetPath, 'utf8').catch(() => '');
    if (!existing) {
      await fs.promises.writeFile(targetPath, `= ${cmd.title}\n\n开始撰写...\n`, 'utf8');
    }
  } catch (bootErr) {
    chatView?.webview.postMessage({
      type: 'user-message',
      message: createAssistantMessageForText(
        `初始化文件失败: ${bootErr instanceof Error ? bootErr.message : String(bootErr)}`
      ),
    } as any);
    return;
  }

  try {
    await sendSetWorkspaceRoot(workspaceRoot);
  } catch { /* best-effort priming */ }

  const userMsg = createUserMessage(originalText);
  chatView?.webview.postMessage({ type: 'user-message', message: userMsg } as any);

  const docAssistantMsg = createAssistantMessage();
  isGenerating = true;
  currentStreamingId = docAssistantMsg.id;
  currentStreamingMsg = docAssistantMsg;
  _streamingPromptTokens = 0;
  _streamingCompletionTokens = 0;
  chatView?.webview.postMessage({ type: 'streaming-start', messageId: docAssistantMsg.id } as any);

  const skillPrompt = `请加载并遵循 ${skillName} 技能来撰写${docLabel}。"${cmd.title}"，目标文件: \`${cmd.writePath}\`，工作区根目录: ${workspaceRoot}。`;

  await sendMessage(
    docAssistantMsg.id,
    skillPrompt,
    (tokenMsg) => {
      if (tokenMsg.type === 'token') {
        if (tokenMsg.tokenType === 'ReasoningContent') {
          currentStreamingMsg!.reasoning += tokenMsg.text;
        } else if (tokenMsg.tokenType === 'Text') {
          currentStreamingMsg!.content += tokenMsg.text;
        }
      }
      if (chatView) chatView.webview.postMessage(tokenMsg);
    },
    () => {
      finalizeCurrentMessage();
      isGenerating = false;
      currentStreamingId = null;
      currentStreamingMsg = null;
      if (chatView) chatView.webview.postMessage({ type: 'done', messageId: docAssistantMsg.id } as any);
      // Process next queued message if any
      if (!isGenerating) { processQueue(); }
    },
    (err) => {
      finalizeCurrentMessage();
      isGenerating = false;
      currentStreamingId = null;
      currentStreamingMsg = null;
      if (chatView) chatView.webview.postMessage({ type: 'error', messageId: docAssistantMsg.id, error: err } as any);
      if (!isGenerating) { processQueue(); }
    },
    (id, toolName, args, metadata, bashIntent) => {
      if (chatView) chatView.webview.postMessage({
        type: 'tool-approval-needed',
        id,
        toolName,
        args,
        ...(metadata ? { metadata } : {}),
        ...(bashIntent ? { bashIntent } : {}),
      } as any);
    },
    undefined,
    undefined,
    currentSession?.brainOsSession,
    undefined,
    undefined,
    selectedModelConfig,
    workspaceRoot,
  );
}

async function triggerAutoCompactOnThreshold(retryText: string): Promise<void> {
  const session = currentSession;
  const view = chatView;
  if (_autoCompactInProgress || !session || !view) return;
  _autoCompactInProgress = true;

  const compactMsg = createAssistantMessage();
  currentStreamingId = compactMsg.id;
  currentStreamingMsg = compactMsg;
  _streamingPromptTokens = 0;
  _streamingCompletionTokens = 0;
  isGenerating = true;
  view.webview.postMessage({ type: 'streaming-start', messageId: compactMsg.id } as any);
  view.webview.postMessage({
    type: 'error',
    messageId: currentStreamingId ?? '',
    error: 'Token threshold reached — auto-compacting and retrying...',
  } as ExtToWebViewMessage);

  const compactMsgs: CompactMessage[] = session.messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  return new Promise<void>((resolve, reject) => {
    sendCompactRequest(
      compactMsgs,
      session.compactedSummary || undefined,
      (tokenMsg) => { chatView?.webview.postMessage(tokenMsg); },
      async () => {
        if (!currentSession || !currentStreamingMsg) return;
        const llmSummary = currentStreamingMsg.content.trim();
        const messagesCount = currentSession.messages.length;
        currentSession.compactedSummary = llmSummary;
        currentSession.isCompacted = true;
        currentSession.totalInputTokens = 0;
        currentSession.totalOutputTokens = 0;
        const compactSummaryMsg = createAssistantMessage();
        compactSummaryMsg.content = `## Session Compacted\n\n**${messagesCount}** messages summarized:\n\n${llmSummary}`;
        compactSummaryMsg.status = 'complete';
        currentSession.messages = [compactSummaryMsg];
        updateSessionTimestamp(currentSession);
        await saveSession(currentSession);
        if (sessionStore) {
          const metaIndex = sessionStore.sessions.findIndex(s => s.id === currentSession!.id);
          if (metaIndex >= 0) {
            sessionStore.sessions[metaIndex] = sessionToMetadata(currentSession);
          }
          saveSessionStore(sessionStore).catch(() => { });
        }
        sendClearSession(currentSession.id);
        sendCompactResult(currentSession.id, llmSummary);
        currentStreamingMsg = null;
        isGenerating = false;
        currentStreamingId = null;
        if (chatView) {
          chatView.webview.postMessage({ type: 'clearHistory' } as any);
          const summaryMsg = createAssistantMessage();
          summaryMsg.content = `## Session Compacted\n\n**${messagesCount}** messages summarized:\n\n${llmSummary}`;
          summaryMsg.status = 'complete';
          chatView.webview.postMessage({ type: 'history-message', message: summaryMsg } as any);
          chatView.webview.postMessage({
            type: 'session-updated',
            sessionId: currentSession.id,
            sessionTitle: currentSession.title,
            sessions: sessionStore?.sessions ?? [],
            isCompacted: true,
          } as any);
          chatView.webview.postMessage({ type: 'done', messageId: compactMsg.id } as any);
        }
        await new Promise(r => setTimeout(r, 500));
        await handleUserMessage(retryText);
        _autoCompactInProgress = false;
        resolve();
      },
      (compactErr) => {
        _autoCompactInProgress = false;
        if (chatView) chatView.webview.postMessage({ type: 'error', messageId: currentStreamingId ?? '', error: `Auto-compact failed: ${compactErr}` } as ExtToWebViewMessage);
        reject(compactErr);
      },
      selectedModelConfig,
    );
  });
}

async function handleUserMessage(text: string): Promise<void> {
  log.trace({ textLength: text.length, text: text.slice(0, 300) }, '[TRACE] user→panel: user pressed enter');
  if (!chatView || !currentSession) {
    return;
  }
  if (!text.trim()) return;

  // 400 auto-compact: if retrying after compaction, reset the stream state
  if (_autoCompactInProgress) {
    _autoCompactInProgress = false;
    isGenerating = false;
    currentStreamingId = null;
    currentStreamingMsg = null;
  }

  lastUserMessageText = text;

  const sessionMatch = text.match(/^\/session\s*(.*)$/i);
  if (sessionMatch) {
    await handleSessionCommand(sessionMatch[1]?.trim() ?? '');
    return;
  }

  const downloadMatch = text.match(/^\/download\s*(.*)$/i);
  if (downloadMatch) {
    await handleDownloadCommand(downloadMatch[1]?.trim() ?? '');
    return;
  }

  const getMatch = text.match(/^\/get\s+(.+)$/i);
  if (getMatch) {
    await handleGetCommand(getMatch[1] ?? '');
    return;
  }

  if (text.trim().toLowerCase() === '/papers' || text.trim().toLowerCase().startsWith('/papers ')) {
    await handlePapersCommand(text.trim().slice(7).trim());
    return;
  }

  if (text.trim().toLowerCase() === '/new' || text.trim().toLowerCase().startsWith('/new ')) {
    const titleArg = text.trim().slice(4).trim();
    chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(text.trim()) } as any);
    await createNewSession(titleArg || undefined);
    return;
  }

  if (text.trim().toLowerCase() === '/compact') {
    chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(text.trim()) } as any);

    const beforeCount = currentSession.messages.length;
    if (beforeCount < 6) {
      chatView.webview.postMessage({
        type: 'user-message',
        message: createAssistantMessageForText(`Session has only ${beforeCount} messages. Compaction works best with 6+ messages.`),
      } as any);
      return;
    }

    const userMsg = createUserMessage(text);
    currentSession.messages.push(userMsg);

    const assistantMsg = createAssistantMessage();
    currentStreamingId = assistantMsg.id;
    currentStreamingMsg = assistantMsg;
    isGenerating = true;

    chatView.webview.postMessage({ type: 'streaming-start', messageId: assistantMsg.id } as any);
    currentSession.messages.push(assistantMsg);

    const messagesForLLM = currentSession.messages.map(m => {
      const msg: CompactMessage = {
        role: m.role as 'user' | 'assistant',
        content: m.content,
      };
      if (m.reasoning) {
        msg.reasoning = m.reasoning;
      }
      return msg;
    });

    await sendCompactRequest(
      messagesForLLM,
      currentSession.compactedSummary || undefined,
      (tokenMsg) => {
        if (chatView) {
          chatView.webview.postMessage(tokenMsg);
        }
        if (currentStreamingMsg && tokenMsg.type === 'token') {
          if (tokenMsg.tokenType === 'ReasoningContent') {
            currentStreamingMsg.reasoning += tokenMsg.text;
          } else if (tokenMsg.tokenType === 'Text') {
            currentStreamingMsg.content += tokenMsg.text;
          } else if (tokenMsg.tokenType === 'Usage') {
            _streamingPromptTokens = tokenMsg.promptTokens ?? 0;
            _streamingCompletionTokens = tokenMsg.completionTokens ?? 0;
            chatView?.webview.postMessage({
              type: 'token-usage',
              usage: {
                input: tokenMsg.promptTokens ?? 0,
                output: tokenMsg.completionTokens ?? 0,
                total: (tokenMsg.promptTokens ?? 0) + (tokenMsg.completionTokens ?? 0),
              },
            } as any);
          } else if (tokenMsg.tokenType === 'ToolCall') {
            (currentStreamingMsg.toolCalls as any[]).push({ name: tokenMsg.text, status: 'running', result: '', ...(tokenMsg.args !== undefined ? { args: tokenMsg.args } : {}) });
          } else if (tokenMsg.tokenType === 'ToolResult') {
            const lastTool = [...(currentStreamingMsg.toolCalls as any[])].reverse().find(t => t.status === 'running');
            if (lastTool) {
              lastTool.result = tokenMsg.text || 'Completed';
              lastTool.status = 'done';
            }
          }
        }
      },
      async (_) => {
        if (chatView) {
          chatView.webview.postMessage({ type: 'done', messageId: assistantMsg.id } as any);
        }

        if (!currentSession) return;

        if (currentStreamingMsg) {
          const llmSummary = currentStreamingMsg.content.trim();
          currentStreamingMsg.status = 'complete';
          currentStreamingMsg = null;

          const summaryMsg = createAssistantMessage();
          summaryMsg.content = `## Session Compacted\n\n**${beforeCount}** messages summarized:\n\n${llmSummary}`;
          summaryMsg.status = 'complete';
          currentSession.messages = [summaryMsg];
          currentSession.compactedSummary = llmSummary;
          currentSession.isCompacted = true;
          delete currentSession.brainOsSession;
          updateSessionTimestamp(currentSession);
          await saveSession(currentSession);

          isGenerating = false;
          currentStreamingId = null;

          if (sessionStore) {
            const metaIndex = sessionStore.sessions.findIndex(s => s.id === currentSession!.id);
            if (metaIndex >= 0) {
              sessionStore.sessions[metaIndex] = sessionToMetadata(currentSession);
            }
            saveSessionStore(sessionStore).catch(() => { });
          }

          sendClearSession(currentSession.id);
          sendCompactResult(currentSession.id, llmSummary);

          if (chatView) {
            chatView.webview.postMessage({ type: 'clearHistory' } as any);
            const summaryMsg = createAssistantMessage();
            summaryMsg.content = `## Session Compacted\n\n**${beforeCount}** messages summarized:\n\n${llmSummary}`;
            summaryMsg.status = 'complete';
            chatView.webview.postMessage({ type: 'history-message', message: summaryMsg } as any);
            chatView.webview.postMessage({
              type: 'session-updated',
              sessionId: currentSession.id,
              sessionTitle: currentSession.title,
              sessions: sessionStore?.sessions ?? [],
              isCompacted: currentSession.isCompacted,
            } as any);
          }
        }
      },
      (err) => {
        if (currentStreamingMsg) {
          currentStreamingMsg.status = 'error';
          currentStreamingMsg.error = err;
        }
        finalizeCurrentMessage();
        if (chatView) {
          chatView.webview.postMessage({
            type: 'error',
            messageId: currentStreamingId ?? '',
            error: err,
          } as ExtToWebViewMessage);
        }
      },
      selectedModelConfig,
    );
    return;
  }

  const helpMatch = text.match(/^\/help\s*(.*)$/i);
  if (helpMatch) {
    await handleHelpCommand(helpMatch[1]?.trim() ?? '');
    return;
  }

  const patentMatch = text.match(/^\/patent\s+(.+)$/i);
  if (patentMatch) {
    const title = patentMatch[1]!.trim();
    const cmd = {
      title,
      phase: '07_Patent',
      writePath: `07_Patent/${slugifyPatentTitle(title)}.typ`,
    };
    await runSkillWrite('patent', cmd, text);
    return;
  }

  // /goal: cancel active stream first to prevent duplicate listeners
  const goalMatch = text.match(/^\/(goal|g)\b(.*)$/i);
  if (goalMatch) {
    if (isGenerating) {
      cancelGeneration();
      finalizeCurrentMessage();
      isGenerating = false;
      currentStreamingId = null;
      currentStreamingMsg = null;
    }
    // fall through to unknownSlash dispatch below
  }

  const recoverMatch = text.match(/^\/recover\s*(.*)$/i);
  if (recoverMatch) {
    const arg = recoverMatch[1]?.trim() ?? '';
    const userMsg = createUserMessage(text);
    chatView.webview.postMessage({ type: 'user-message', message: userMsg } as any);

    if (!arg) {
      const count = currentSession.messages.length;
      const estimatedTokens = Math.round(currentSession.messages.reduce((sum, m) => sum + m.content.length + m.reasoning.length, 0) / 4);
      chatView.webview.postMessage({
        type: 'history-message', message: createAssistantMessageForText(
          `## Session Stats\n\n**Messages:** ${count}\n**Estimated tokens:** ~${estimatedTokens}\n\nUse \`/recover keep <N>\` to keep the last N message pairs and discard older ones.`,
        )
      } as any);
      return;
    }

    const keepMatch = arg.match(/^keep\s+(\d+)$/i);
    if (keepMatch) {
      const keep = parseInt(keepMatch[1]!, 10);
      if (keep <= 0) {
        chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText('N must be a positive number.') } as any);
        return;
      }

      const messages = currentSession.messages;

      // Find cutoff: keep last N user-assistant pairs
      let userCount = 0;
      let cutIndex = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') {
          userCount++;
          if (userCount === keep) {
            cutIndex = i;
            break;
          }
        }
      }
      const keptMessages = messages.slice(cutIndex);

      // Trim large tool results (>= 1000 chars)
      for (const msg of keptMessages) {
        if (msg.toolCalls) {
          for (const tool of msg.toolCalls) {
            if (tool.result && tool.result.length >= 1000) {
              tool.result = tool.result.slice(0, 1000) + '\n...[truncated by /recover]';
            }
          }
        }
      }

      // Dedup exact-match tool results (remove if same as previous turn)
      for (let i = 1; i < keptMessages.length; i++) {
        const prev = keptMessages[i - 1];
        const curr = keptMessages[i];
        if (curr?.toolCalls && prev?.toolCalls) {
          for (let j = 0; j < curr.toolCalls.length && j < prev.toolCalls.length; j++) {
            if (curr.toolCalls[j]?.result && prev.toolCalls[j]?.result && curr.toolCalls[j]!.result === prev.toolCalls[j]!.result) {
              curr.toolCalls[j]!.result = '[duplicate tool result removed by /recover]';
            }
          }
        }
      }

      // Save truncated session
      currentSession.messages = keptMessages;
      updateSessionTimestamp(currentSession);
      await saveSession(currentSession);
      if (sessionStore) {
        const metaIndex = sessionStore.sessions.findIndex(s => s.id === currentSession!.id);
        if (metaIndex >= 0) {
          sessionStore.sessions[metaIndex] = sessionToMetadata(currentSession);
        }
        saveSessionStore(sessionStore).catch(() => { });
      }

      // Re-render webview
      chatView.webview.postMessage({ type: 'clearHistory' } as any);
      for (const msg of keptMessages) {
        chatView.webview.postMessage({ type: 'history-message', message: msg } as any);
      }
      chatView.webview.postMessage({ type: 'history-message', message: createAssistantMessageForText(`Session recovered. Kept last **${keep}** message pair${keep > 1 ? 's' : ''}. Tool results trimmed and duplicates removed.`) } as any);

      // Send recovered session to worker
      const recoverMsgs = keptMessages.map(m => ({ role: m.role, content: m.content }));
      sendRecoverSession(currentSession.id, recoverMsgs);

      // Update token display
      chatView.webview.postMessage({
        type: 'token-usage',
        usage: computeTokenUsage(),
      } as any);

      // Update session metadata
      chatView.webview.postMessage({
        type: 'session-updated',
        sessionId: currentSession.id,
        sessionTitle: currentSession.title,
        sessions: sessionStore?.sessions ?? [],
        isCompacted: false,
      } as any);

      return;
    }
  }

  const unknownSlash = text.match(/^\/([a-zA-Z][\w-]*)(\s+.*)?$/);
  if (unknownSlash) {
    const userMsg = createUserMessage(text);
    currentSession.messages.push(userMsg);
    updateSessionTimestamp(currentSession);
    chatView.webview.postMessage({ type: 'user-message', message: userMsg } as any);

    const assistantMsg = createAssistantMessage();
    currentStreamingId = assistantMsg.id;
    currentStreamingMsg = assistantMsg;
    _streamingPromptTokens = 0;
    _streamingCompletionTokens = 0;
    isGenerating = true;
    chatView.webview.postMessage({ type: 'streaming-start', messageId: assistantMsg.id } as any);
    currentSession.messages.push(assistantMsg);

    await sendSlashRequest(
      assistantMsg.id,
      text,
      (tokenMsg) => {
        if (chatView) chatView.webview.postMessage(tokenMsg);
        if (currentStreamingMsg && tokenMsg.type === 'token') {
          if (tokenMsg.tokenType === 'ReasoningContent') {
            currentStreamingMsg.reasoning += tokenMsg.text;
          } else if (tokenMsg.tokenType === 'Text') {
            currentStreamingMsg.content += tokenMsg.text;
          } else if (tokenMsg.tokenType === 'Usage') {
            _streamingPromptTokens = tokenMsg.promptTokens ?? 0;
            _streamingCompletionTokens = tokenMsg.completionTokens ?? 0;
            chatView?.webview.postMessage({
              type: 'token-usage',
              usage: { input: _streamingPromptTokens, output: _streamingCompletionTokens, total: _streamingPromptTokens + _streamingCompletionTokens },
            } as any);
          }
        }
      },
      () => {
        if (chatView) chatView.webview.postMessage({ type: 'done', messageId: assistantMsg.id } as any);
        if (chatView) {
          chatView.webview.postMessage({
            type: 'token-usage',
            usage: { input: _streamingPromptTokens, output: _streamingCompletionTokens, total: _streamingPromptTokens + _streamingCompletionTokens },
          } as any);
        }
        if (text.trim() === '/ping') _modelProfilesCache = null;
        finalizeCurrentMessage();
        sendGoalStatus();

        // Codex: when /goal <text> sets a new goal, auto-start working immediately
        // Skip for: /goal alone (view), /goal pause/resume/clear
        const isNewGoal = text.match(/^\/goal\s+(.+)$/i) && !text.match(/^\/goal\s+(pause|resume|clear|log|edit\s|status\s)/i);
        if (isNewGoal) {
          const goal = readGoalForPanel();
          if (goal && goal.status === 'active') {
            processQueue();
            setImmediate(() => {
              handleUserMessage(`Decompose this goal into sub-tasks and acceptance criteria. Use todowrite to track each sub-task with embedded acceptance criteria. For each sub-task, define what observable artifact proves it done (file written, test passes, code compiles, output matches spec). Then execute one sub-task per turn, verifying each criterion before marking it verified. Only call update_goal complete when EVERY sub-task is verified.\n\nGoal: ${goal.text}`).catch(() => { });
            });
            return;
          }
        }
        processQueue();
      },
      (err) => {
        if (currentStreamingMsg) {
          currentStreamingMsg.status = 'error';
          currentStreamingMsg.error = err;
        }
        finalizeCurrentMessage();
        if (currentQueueId) markQueueError(currentQueueId, err);
        const savedQueueId2 = currentQueueId;
        currentQueueId = null;
        dequeuedItemText = null;
        setImmediate(() => processQueue());
        if (chatView) {
          chatView.webview.postMessage({
            type: 'error',
            messageId: assistantMsg.id,
            error: err,
          } as ExtToWebViewMessage);
        }
      },
      selectedModelConfig,
      getDefaultWorkspaceRoot(),
    );
    return;
  }

  // Write-paper / write-patent: incremental LLM-driven writing (file on disk, edit_file per turn)
  const writeIntent = parseWriteIntent(text);
  if (writeIntent?.kind === 'needs-topic') {
    chatView.webview.postMessage({ type: 'user-message', message: createUserMessage(text) } as any);
    chatView.webview.postMessage({
      type: 'write-topic-prompt',
      docType: writeIntent.type,
      originalText: text,
    } as any);
    return;
  }
  const writeAny = writeIntent?.kind === 'match' ? writeIntent : null;
  if (writeAny) {
    await runSkillWrite(writeAny.type, writeAny.cmd, text);
    return;
  }

  if (isGenerating) {
    log.debug('isGenerating=true, queuing');
    const item = addToQueue(text);
    if (!item) {
      chatView?.webview.postMessage({
        type: 'user-message',
        message: createAssistantMessageForText(`Queue is full (max ${MAX_QUEUE_SIZE} messages). Please wait for current message to complete or remove a queued message.`),
      } as any);
    }
    return;
  }

  const skillMatch = detectSkillCommand(text);
  let displayText = text;
  let skillContentForLLM: string | undefined;

  if (skillMatch) {
    displayText = formatSkillMessage(skillMatch.skill, skillMatch.args);
    skillContentForLLM = skillMatch.skill.content;
  } else if (selectedAgentContent) {
    skillContentForLLM = selectedAgentContent;
  }

  const userMsg = createUserMessage(displayText);
  currentSession.messages.push(userMsg);
  updateSessionTimestamp(currentSession);

  if (currentSession.title === 'New Chat') {
    currentSession.title = generateSessionTitle(currentSession.messages);
  }

  chatView.webview.postMessage({ type: 'user-message', message: userMsg } as any);

  const assistantMsg = createAssistantMessage();
  currentStreamingId = assistantMsg.id;
  currentStreamingMsg = assistantMsg;
  _streamingPromptTokens = 0;
  _streamingCompletionTokens = 0;
  isGenerating = true;

  chatView.webview.postMessage({ type: 'streaming-start', messageId: assistantMsg.id } as any);
  currentSession.messages.push(assistantMsg);

  const { systemSummary } = buildContextWithSummary(
    currentSession.messages,
    currentSession.compactedSummary,
  );

  if (systemSummary && systemSummary !== currentSession.compactedSummary) {
    currentSession.compactedSummary = systemSummary;
    currentSession.isCompacted = true;
  }

  const defaultWorkspaceRoot = getDefaultWorkspaceRoot();
  const fileReferenceTarget = resolveCommandFileReference(text, defaultWorkspaceRoot);
  const messageText = fileReferenceTarget?.text ?? text;
  const workspaceRoot = fileReferenceTarget?.workspaceRoot ?? defaultWorkspaceRoot;

  log.trace({ traceId: assistantMsg.id, textLength: messageText.length, sessionId: currentSession?.id, text: messageText.slice(0, 200) }, '[TRACE] panel→agent: user message entering pipeline');
  await sendMessage(
    assistantMsg.id,
    messageText,
    (tokenMsg) => {
      if (chatView) {
        chatView.webview.postMessage(tokenMsg);
      }
      if (currentStreamingMsg && tokenMsg.type === 'token') {
        if (tokenMsg.tokenType === 'ReasoningContent') {
          currentStreamingMsg.reasoning += tokenMsg.text;
        } else if (tokenMsg.tokenType === 'Text') {
          currentStreamingMsg.content += tokenMsg.text;
        } else if (tokenMsg.tokenType === 'Usage') {
          _streamingPromptTokens = tokenMsg.promptTokens ?? 0;
          _streamingCompletionTokens = tokenMsg.completionTokens ?? 0;
          chatView?.webview.postMessage({
            type: 'token-usage',
            usage: { input: _streamingPromptTokens, output: _streamingCompletionTokens, total: _streamingPromptTokens + _streamingCompletionTokens },
          } as any);
        }
      }
    },
    (doneData) => {
      log.trace({ traceId: assistantMsg.id, responseLength: currentStreamingMsg?.content?.length ?? 0, hasReasoning: !!currentStreamingMsg?.reasoning?.length }, '[TRACE] panel→agent: full response received');
      if (doneData?.rateLimited) {
        if (currentQueueId) markQueueRateLimited(currentQueueId);
        isGenerating = false;
        handleRateLimited(doneData.retryAfter ?? 60, doneData.error ?? '');
        return;
      }
      rateLimitRetryCount = 0;
      if (currentQueueId) markQueueCompleted(currentQueueId);
      currentQueueId = null;
      dequeuedItemText = null;
      const inputTokens = doneData?.inputTokens ?? 0;
      const outputTokens = doneData?.outputTokens ?? 0;

      // Accumulate per-message token usage into session BEFORE sending token-usage and saving
      if (currentSession) {
        currentSession.totalInputTokens = (currentSession.totalInputTokens ?? 0) + inputTokens;
        currentSession.totalOutputTokens = (currentSession.totalOutputTokens ?? 0) + outputTokens;
      }

      if (chatView) {
        chatView.webview.postMessage({ type: 'done', messageId: assistantMsg.id } as any);
        log.trace({ sessionId: currentSession?.id, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, '[TOKEN] panel: stream done');
        chatView.webview.postMessage({
          type: 'token-usage',
          usage: { input: _streamingPromptTokens, output: _streamingCompletionTokens, total: _streamingPromptTokens + _streamingCompletionTokens },
        } as any);
      }
      finalizeCurrentMessage();
      sendGoalStatus();

      // Proactive auto-compact: fire when accumulated tokens approach model's limit
      if (currentSession && !_autoCompactInProgress && currentSession.messages.length >= 6 && !currentQueueId) {
        const accTotal = (currentSession.totalInputTokens ?? 0) + (currentSession.totalOutputTokens ?? 0);
        if (accTotal > 0) {
          const threshold = getAutoCompactThreshold(getEffectiveModelName());
          if (threshold > 0 && accTotal >= threshold) {
            triggerAutoCompactOnThreshold(lastUserMessageText || '').catch(() => { });
            return;
          }
        }
      }

      // Auto-drain next queued message
      processQueue();
    },
    (err) => {
      log.warn({ err }, 'onError callback');
      const isOverflow = err.includes('context length') || err.includes('reduce the length') || err.includes('input tokens') || err.includes('maximum context') || err.includes('too many tokens') || err.includes('400');

      if (isOverflow && currentSession && chatView && !_autoCompactInProgress) {
        _autoCompactInProgress = true;

        if (currentStreamingMsg) {
          currentStreamingMsg.status = 'error';
          currentStreamingMsg.error = err;
        }
        finalizeCurrentMessage();

        chatView.webview.postMessage({ type: 'error', messageId: currentStreamingId ?? '', error: 'Context overflow — auto-compacting and retrying...' } as ExtToWebViewMessage);

        const compactMsg = createAssistantMessage();
        currentStreamingId = compactMsg.id;
        currentStreamingMsg = compactMsg;
        _streamingPromptTokens = 0;
        _streamingCompletionTokens = 0;
        isGenerating = true;
        chatView.webview.postMessage({ type: 'streaming-start', messageId: compactMsg.id } as any);

        const compactMsgs: CompactMessage[] = currentSession.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        sendCompactRequest(compactMsgs, currentSession.compactedSummary || undefined,
          (tokenMsg) => { chatView?.webview.postMessage(tokenMsg); },
          async () => {
            if (!currentSession || !currentStreamingMsg) return;
            const llmSummary = currentStreamingMsg.content.trim();
            const messagesCount = currentSession.messages.length;
            currentSession.compactedSummary = llmSummary;
            currentSession.isCompacted = true;
            const compactSummaryMsg = createAssistantMessage();
            compactSummaryMsg.content = `## Session Compacted\n\n**${messagesCount}** messages summarized:\n\n${llmSummary}`;
            compactSummaryMsg.status = 'complete';
            currentSession.messages = [compactSummaryMsg];
            updateSessionTimestamp(currentSession);
            await saveSession(currentSession);
            if (sessionStore) {
              const metaIndex = sessionStore.sessions.findIndex(s => s.id === currentSession!.id);
              if (metaIndex >= 0) {
                sessionStore.sessions[metaIndex] = sessionToMetadata(currentSession);
              }
              saveSessionStore(sessionStore).catch(() => { });
            }
            sendClearSession(currentSession.id);
            sendCompactResult(currentSession.id, llmSummary);
            currentStreamingMsg = null;
            isGenerating = false;
            currentStreamingId = null;
            if (chatView) {
              chatView.webview.postMessage({ type: 'clearHistory' } as any);
              const summaryMsg = createAssistantMessage();
              summaryMsg.content = `## Session Compacted\n\n**${messagesCount}** messages summarized:\n\n${llmSummary}`;
              summaryMsg.status = 'complete';
              chatView.webview.postMessage({ type: 'history-message', message: summaryMsg } as any);
              chatView.webview.postMessage({
                type: 'session-updated',
                sessionId: currentSession.id,
                sessionTitle: currentSession.title,
                sessions: sessionStore?.sessions ?? [],
                isCompacted: true,
              } as any);
              chatView.webview.postMessage({ type: 'done', messageId: compactMsg.id } as any);
            }
            await new Promise(r => setTimeout(r, 500));
            await handleUserMessage(text);
          },
          (compactErr) => {
            _autoCompactInProgress = false;
            if (chatView) chatView.webview.postMessage({ type: 'error', messageId: currentStreamingId ?? '', error: `Auto-compact failed: ${compactErr}` } as ExtToWebViewMessage);
          },
          selectedModelConfig,
        );
        return;
      }

      if (currentStreamingMsg) {
        currentStreamingMsg.status = 'error';
        currentStreamingMsg.error = err;
      }
      if (currentQueueId) markQueueError(currentQueueId, err);
      const savedQueueId = currentQueueId;
      currentQueueId = null;
      dequeuedItemText = null;
      finalizeCurrentMessage();
      // Skip errored item, auto-drain to next
      if (savedQueueId) {
        setImmediate(() => processQueue());
      }
      if (chatView) {
        chatView.webview.postMessage({
          type: 'error',
          messageId: currentStreamingId ?? '',
          error: err,
        } as ExtToWebViewMessage);
      }
    },
    (id, toolName, args, metadata, bashIntent) => {
      if (chatView) {
        chatView.webview.postMessage({ type: 'tool-approval-needed', id, toolName, args, metadata, bashIntent } as ExtToWebViewMessage);
      }
    },
    undefined,
    systemSummary || undefined,
    currentSession?.id,
    currentSession?.brainOsSession,
    skillContentForLLM,
    selectedModelConfig,
    workspaceRoot,
  );
}

function finalizeCurrentMessage(): void {
  isGenerating = false;
  currentStreamingId = null;

  if (currentStreamingMsg) {
    currentStreamingMsg.status = 'complete';
    currentStreamingMsg = null;
  }

  if (currentSession) {
    updateSessionTimestamp(currentSession);
    saveSession(currentSession).catch(() => { });

    if (sessionStore) {
      const metaIndex = sessionStore.sessions.findIndex(s => s.id === currentSession!.id);
      if (metaIndex >= 0) {
        sessionStore.sessions[metaIndex] = sessionToMetadata(currentSession);
      }
      saveSessionStore(sessionStore).catch(() => { });
    }

    if (chatView) {
      chatView.webview.postMessage({
        type: 'session-list-updated',
        sessions: sessionStore?.sessions ?? [],
      } as any);

      if (currentSession.title !== 'New Chat') {
        chatView.webview.postMessage({
          type: 'session-title-updated',
          sessionId: currentSession.id,
          title: currentSession.title,
        } as any);
      }
    }
  }
}

function computeTokenUsage(): { input: number; output: number; total: number } {
  if (!currentSession) return { input: 0, output: 0, total: 0 };
  const realInput = currentSession.totalInputTokens ?? 0;
  const realOutput = currentSession.totalOutputTokens ?? 0;
  if (realInput > 0 || realOutput > 0) {
    return { input: realInput, output: realOutput, total: realInput + realOutput };
  }
  // Estimate from message content when real token data isn't accumulated yet
  let estimatedInput = 0;
  let estimatedOutput = 0;
  for (const msg of currentSession.messages) {
    if (msg.role === 'user') {
      estimatedInput += Math.ceil(msg.content.length / 4);
      if (msg.reasoning) estimatedOutput += Math.ceil(msg.reasoning.length / 4);
    } else if (msg.role === 'assistant') {
      estimatedOutput += Math.ceil(msg.content.length / 4) + Math.ceil((msg.reasoning ?? '').length / 4);
    }
  }
  if (estimatedInput > 0 || estimatedOutput > 0) {
    return { input: estimatedInput, output: estimatedOutput, total: estimatedInput + estimatedOutput };
  }
  return { input: 0, output: 0, total: 0 };
}

function getWebviewHtml(webview: vscode.Webview): string {
  const extUri = extensionContext?.extensionUri ?? vscode.Uri.file(__dirname);
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, 'dist', 'chat', 'webview', 'styles.css')
  ).toString();

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, 'dist', 'chat', 'webview', 'chat.js')
  ).toString();

  const markedUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, 'dist', 'chat', 'webview', 'lib', 'marked.min.js')
  ).toString();

  const mermaidUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, 'dist', 'chat', 'webview', 'lib', 'mermaid.min.js')
  ).toString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${getChatConfig().persona?.name ?? 'Research Assistant'}</title>
  <link rel="stylesheet" href="${styleUri}">
  <script src="${markedUri}"></script>
  <script src="${mermaidUri}"></script>
</head>
<body>
  <div id="app">
    <div id="messages" class="messages"></div>
    <div id="todo-pinned" class="todo-pinned" style="display:none"></div>
    <div id="tools-status-bar" class="tools-status-bar" style="display:none"></div>
    <div class="input-area">
      <div id="attachments" class="attachments"></div>
      <div class="input-container">
        <div class="input-wrapper">
          <textarea id="input" placeholder="Ask about your notebook, research, or any topic..." rows="1"></textarea>
          <div id="toolbar" class="toolbar">
            <button id="btn-attach" class="toolbar-btn" title="Add attachments">+</button>
            <div class="toolbar-sep"></div>
            <button id="btn-agent" class="toolbar-btn" title="Select agent">
              <span class="toolbar-icon">&lt;/&gt;</span>
              <span id="agent-label" class="toolbar-label">Research</span>
            </button>
            <div class="toolbar-sep"></div>
            <button id="btn-model" class="toolbar-btn" title="Select model">
              <span id="model-label" class="toolbar-label">Auto</span>
            </button>
            <div class="toolbar-sep"></div>
            <button id="btn-settings" class="toolbar-btn" title="Settings">⚙</button>
          </div>
        </div>
        <button id="btn-send" class="send-btn">➤</button>
      </div>
      <div id="attach-menu" class="attach-menu" style="display:none">
        <div class="attach-menu-item" data-action="selection">📝 Send Selection</div>
        <div class="attach-menu-item" data-action="file">📄 Send Current File</div>
        <div class="attach-menu-item" data-action="choose">📂 Choose File...</div>
      </div>
      <div id="agent-menu" class="dropdown-menu" style="display:none"></div>
      <div id="model-menu" class="dropdown-menu" style="display:none"></div>
    </div>
    <div class="status-bar">
      <span id="status-session" class="status-item"></span>
      <span id="status-messages" class="status-item"></span>
      <div id="status-mcp" class="status-item mcp-status-wrapper"></div>
      <span id="status-sandbox" class="status-item"></span>
    </div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

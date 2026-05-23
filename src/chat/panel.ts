import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getChatConfig } from './settings';
import type { CompactMessage} from './agent';
import { sendMessage, cancelGeneration, undoLastAiInsert, initializeAgent, getWelcomeContext, sendToolApproval, sendCompactRequest, requestMcpStatus } from './agent';
import type { ExtToWebViewMessage, WebViewToExtMessage, ChatMessage} from './messages';
import { createUserMessage, createAssistantMessage } from './messages';
import { extractNotebookContext, insertCellAt, extractEditorSelection, extractNotebookCellSelection, extractWholeFile, extractWholeNotebook } from './context';
import type {
  Session,
  SessionStore} from './sessions';
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
let isGenerating = false;

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

import * as jsbos from '@open1s/jsbos';

interface ModelConfig {
  name: string;
  description?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

let globalModelConfig: ModelConfig | undefined;

function loadModelsFromConfig(): ModelConfig[] {
  const models: ModelConfig[] = [];
  try {
    const loader = new jsbos.ConfigLoader();
    loader.discover();
    const configJson = loader.loadSync();
    const config = JSON.parse(configJson);
    
    const gm = config.global_model || {};
    if (gm.model || gm.base_url || gm.api_key) {
      globalModelConfig = { name: 'global' };
      if (gm.model) { globalModelConfig.model = gm.model; globalModelConfig.description = gm.model; }
      if (gm.base_url) globalModelConfig.baseUrl = gm.base_url;
      if (gm.api_key) globalModelConfig.apiKey = gm.api_key;
    }
    
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
    console.error('[trinno-chat] Failed to load BOS config:', e);
  }
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
  { name: 'session', description: 'Manage sessions: list, select, delete, rename' },
  { name: 'new', description: 'Create a new chat session' },
  { name: 'compact', description: 'Compact current session: summarize old messages, reduce context' },
  { name: 'ai-research', description: 'AI-driven research: auto-extracts keywords, searches, summarizes, TRIZ report' },
  { name: 'research', description: 'Full TRIZ research: contradiction + prior art + S-curve + TRL' },
  { name: 'contradiction', description: 'Analyze technical contradictions using TRIZ matrix' },
  { name: 'search', description: 'Search patents, papers, and technical solutions' },
  { name: 's-curve', description: 'Technology maturity S-curve analysis with TRL' },
  { name: 'ideality', description: 'Evaluate system ideality (benefits/costs/harms)' },
  { name: 'principles', description: 'List or search the 40 TRIZ inventive principles' },
  { name: 'su-field', description: 'Substance-Field model analysis' },
  { name: 'help', description: 'Show all available commands' },
];

const allSlashCommands = [...staticSlashCommands, ...loadedSkills.map(s => ({ name: s.name, description: s.description }))];

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
    console.log('[trinno-chat] resolveWebviewView called');
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

    chatView.onDidChangeVisibility(() => {
      if (chatView?.visible) {
        this.sendWelcome();
      }
    });

    this.sendWelcome();
  }

  private async sendWelcome(): Promise<void> {
    if (!chatView) return;

    if (!sessionStore) {
      sessionStore = await migrateOldHistory();
    }

    if (!currentSession && sessionStore.activeSessionId) {
      currentSession = await loadSession(sessionStore.activeSessionId);
    }

    if (!currentSession) {
      const session = createSession();
      sessionStore.sessions.push(sessionToMetadata(session));
      sessionStore.activeSessionId = session.id;
      await saveSessionStore(sessionStore);
      await saveSession(session);
      currentSession = session;
    }

    chatView.webview.postMessage({
      type: 'welcome',
      context: getWelcomeContext().context,
      personaName: getChatConfig().persona.name,
      slashCommands: allSlashCommands,
      sessionId: currentSession.id,
      sessionTitle: currentSession.title,
      sessions: sessionStore.sessions,
      isCompacted: currentSession.isCompacted,
    } as any);

    chatView.webview.postMessage({
      type: 'agents-loaded',
      agents: [{ name: 'Research Assistant', description: 'TRIZ research expert' }, ...loadedAgents.map(a => ({ name: a.name, description: a.description }))],
    } as any);

    chatView.webview.postMessage({
      type: 'models-loaded',
      models: loadedModels,
    } as any);

    if (pendingMcpStatus) {
      chatView.webview.postMessage({ type: 'mcp-status', servers: pendingMcpStatus } as any);
    } else {
      requestMcpStatus();
    }

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
    vscode.commands.registerCommand('trinno-chat.deleteSession', async (sessionId?: string) => {
      if (sessionId) {
        await deleteSessionById(sessionId);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trinno-chat.sendContext', async () => {
      const config = getChatConfig();
      let ctx = extractNotebookCellSelection(config.context.maxCharsPerAttachment);
      if (!ctx) {
        ctx = extractEditorSelection(config.context.maxCharsPerAttachment);
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
        const ctx = await extractWholeNotebook(nbEditor.notebook.uri, config.context.maxCharsPerAttachment);
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
      const ctx = await extractWholeFile(editor.document.uri, config.context.maxCharsPerAttachment);
      if (!ctx) {
        vscode.window.showInformationMessage('Could not read file.');
        return;
      }
      if (chatView) {
        chatView.webview.postMessage({ type: 'insert-to-input', attachment: ctx } as any);
      }
    })
  );

  initializeAgent((servers) => {
    console.log('[trinno-chat] MCP status callback:', JSON.stringify(servers));
    pendingMcpStatus = servers;
    if (chatView) {
      console.log('[trinno-chat] Posting mcp-status to webview immediately');
      chatView.webview.postMessage({ type: 'mcp-status', servers } as any);
    } else {
      console.log('[trinno-chat] chatView not ready yet, pendingMcpStatus set');
    }
  }).catch(() => {});
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
  }
}

async function switchSession(sessionId: string): Promise<void> {
  // Cancel any ongoing generation before switching
  if (isGenerating) {
    cancelGeneration();
    finalizeCurrentMessage();
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
      console.error('[trinno-chat] Session not found:', sessionId);
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
    }
  } catch (err) {
    console.error('[trinno-chat] Error switching session:', err);
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

async function handleWebViewMessage(msg: WebViewToExtMessage & { sessionId?: string; sessionAction?: string }): Promise<void> {
  if (msg.type === 'userMessage') {
    await handleUserMessage(msg.text);
  } else if (msg.type === 'cancel') {
    cancelGeneration();
    finalizeCurrentMessage();
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
    console.log('[trinno-chat] Agent set to:', msg.agent, 'has content:', !!selectedAgentContent);
  } else if (msg.type === 'setModel') {
    if (msg.model === 'Auto') {
      selectedModelConfig = undefined;
    } else {
      selectedModelConfig = loadedModels.find(m => m.name === msg.model);
    }
  } else if (msg.type === 'openSettings') {
    vscode.commands.executeCommand('workbench.action.openSettings', 'chat.');
  } else if (msg.type === 'tool-approval') {
    sendToolApproval(msg.id, msg.approved);
  } else if (msg.type === 'rate-limited-retry') {
    handleRateLimitedRetry();
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
    ? await extractWholeNotebook(uri, config.context.maxCharsPerAttachment)
    : await extractWholeFile(uri, config.context.maxCharsPerAttachment);
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

let rateLimitTimer: ReturnType<typeof setInterval> | null = null;
let rateLimitRetryCallback: (() => void) | null = null;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleRateLimited(retryAfter: number, _error: string): void {
  void _error;
  if (!chatView || !currentStreamingId) return;

  const messageId = currentStreamingId;
  const seconds = Math.max(1, Math.round(retryAfter));

  chatView.webview.postMessage({
    type: 'rate-limited',
    messageId,
    retryAfter: seconds,
  } as any);

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
    }
  }, 1000);

  rateLimitRetryCallback = () => {
    if (rateLimitTimer) clearInterval(rateLimitTimer);
    rateLimitTimer = null;
    rateLimitRetryCallback = null;
    if (chatView && currentSession && isGenerating) {
      finalizeCurrentMessage();
      handleUserMessage(lastUserMessageText || '');
    }
  };
}

let lastUserMessageText: string = '';

function handleRateLimitedRetry(): void {
  if (rateLimitRetryCallback) {
    rateLimitRetryCallback();
    rateLimitRetryCallback = null;
  }
}

async function handleUserMessage(text: string): Promise<void> {
  console.log('[trinno-chat] handleUserMessage:', text.slice(0, 50));
  if (!chatView || !currentSession) {
    return;
  }
  if (!text.trim()) return;

  lastUserMessageText = text;

  const sessionMatch = text.match(/^\/session\s*(.*)$/i);
  if (sessionMatch) {
    await handleSessionCommand(sessionMatch[1]?.trim() ?? '');
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
        } else if (tokenMsg.tokenType === 'ToolCall') {
          (currentStreamingMsg.toolCalls as any[]).push({ name: tokenMsg.text, status: 'running', result: '' });
        } else if (tokenMsg.tokenType === 'ToolResult') {
          const lastTool = [...(currentStreamingMsg.toolCalls as any[])].reverse().find(t => t.status === 'running');
          if (lastTool) {
            lastTool.result = tokenMsg.text ? `${lastTool.name}: ${tokenMsg.text}` : `${lastTool.name}: Completed`;
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

          currentSession.messages = [];
          currentSession.compactedSummary = llmSummary;
          currentSession.isCompacted = true;
          updateSessionTimestamp(currentSession);
          await saveSession(currentSession);

          isGenerating = false;
          currentStreamingId = null;

          if (sessionStore) {
            const metaIndex = sessionStore.sessions.findIndex(s => s.id === currentSession!.id);
            if (metaIndex >= 0) {
              sessionStore.sessions[metaIndex] = sessionToMetadata(currentSession);
            }
            saveSessionStore(sessionStore).catch(() => {});
          }

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
      selectedModelConfig || globalModelConfig,
    );
    return;
  }

  if (isGenerating) {
    cancelGeneration();
    finalizeCurrentMessage();
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

  await sendMessage(
    assistantMsg.id,
    text,
    (tokenMsg) => {
      if (chatView) {
        chatView.webview.postMessage(tokenMsg);
      }
      if (currentStreamingMsg && tokenMsg.type === 'token') {
        if (tokenMsg.tokenType === 'ReasoningContent') {
          currentStreamingMsg.reasoning += tokenMsg.text;
        } else if (tokenMsg.tokenType === 'Text') {
          currentStreamingMsg.content += tokenMsg.text;
        }
      }
    },
    (doneData) => {
      if (chatView) {
        chatView.webview.postMessage({ type: 'done', messageId: assistantMsg.id } as any);
        let inputTokens = doneData?.inputTokens ?? 0;
        let outputTokens = doneData?.outputTokens ?? 0;
        if (inputTokens === 0 && outputTokens === 0 && currentStreamingMsg && currentSession) {
          outputTokens = Math.ceil((currentStreamingMsg.content.length + currentStreamingMsg.reasoning.length) / 4);
          const contextText = currentSession.messages.slice(0, -1).map(m => m.content + (m.reasoning || '')).join(' ');
          inputTokens = Math.ceil(contextText.length / 4);
        }
        chatView.webview.postMessage({
          type: 'token-usage',
          usage: {
            input: inputTokens,
            output: outputTokens,
            total: inputTokens + outputTokens,
          },
        } as any);
      }
      if (currentSession && doneData?.brainOsSession) {
        currentSession.brainOsSession = doneData.brainOsSession;
      }
      finalizeCurrentMessage();
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
    (id, toolName, args) => {
      if (chatView) {
        chatView.webview.postMessage({ type: 'tool-approval-needed', id, toolName, args } as ExtToWebViewMessage);
      }
    },
    undefined,
    systemSummary || undefined,
    currentSession?.id,
    currentSession?.brainOsSession,
    skillContentForLLM,
    selectedModelConfig || globalModelConfig,
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
    saveSession(currentSession).catch(() => {});

    if (sessionStore) {
      const metaIndex = sessionStore.sessions.findIndex(s => s.id === currentSession!.id);
      if (metaIndex >= 0) {
        sessionStore.sessions[metaIndex] = sessionToMetadata(currentSession);
      }
      saveSessionStore(sessionStore).catch(() => {});
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

function getWebviewHtml(webview: vscode.Webview): string {
  const extUri = extensionContext?.extensionUri ?? vscode.Uri.file(__dirname);
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, 'dist', 'chat', 'webview', 'styles.css')
  ).toString();

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, 'dist', 'chat', 'webview', 'chat.js')
  ).toString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Research Assistant</title>
  <link rel="stylesheet" href="${styleUri}">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body>
  <div id="app">
    <div id="messages" class="messages"></div>
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
    </div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

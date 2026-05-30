import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getChatConfig } from './settings';
import type { CompactMessage} from './agent';
import { sendMessage, cancelGeneration, undoLastAiInsert, initializeAgent, getWelcomeContext, sendToolApproval, sendCompactRequest, sendSlashRequest, requestMcpStatus, sendIncrementalSectionRequest, sendSetWorkspaceRoot, sendClearSession, sendCompactResult } from './agent';
import type { IncrementalTurnResult } from './agent';
import type { ExtToWebViewMessage, WebViewToExtMessage, ChatMessage, FileEntry} from './messages';
import { createUserMessage, createAssistantMessage } from './messages';
import { parseWriteIntent, slugifyPatentTitle } from './write_paper';
import { bootstrapFile, readFileTail, readFullFile, buildContinuePrompt, buildBootstrapPrompt, isComplete, detectDoneInText, hasAnchor } from './incremental_writer';
import { extractNotebookContext, insertCellAt, extractEditorSelection, extractNotebookCellSelection, extractWholeFile, extractWholeNotebook } from './context';
import { resolveCommandFileReference } from './fileReferences';
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
  { name: 'init', description: 'Initialize a Trinno workspace (creates 7 phase folders + README)' },
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
      agents: [{ name: getChatConfig().persona.name, description: 'TRIZ research expert' }, ...loadedAgents.map(a => ({ name: a.name, description: a.description }))],
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
    pendingMcpStatus = servers;
    if (chatView) {
      chatView.webview.postMessage({ type: 'mcp-status', servers } as any);
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
  console.log('[trinno-chat] panel: handleWebViewMessage type:', msg.type);
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
      writePath: `${phase}/${slugifyPatentTitle(topic)}.md`,
    };
    await runIncrementalWrite(msg.docType, cmd, msg.originalText);
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
    result = await downloadPaper({ outputDir: '', identifier: trimmed }, onProgress);
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

  const items = listDownloadedPapers('');
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
    if (rateLimitRetryCount >= MAX_RATE_LIMIT_RETRIES) {
      isGenerating = false;
      if (chatView && currentStreamingId) {
        chatView.webview.postMessage({
          type: 'error',
          messageId: currentStreamingId,
          error: `已达到最大重试次数 (${MAX_RATE_LIMIT_RETRIES})。请稍后再试或检查 API 配额。`,
        } as any);
        currentStreamingId = null;
      }
      return;
    }
    rateLimitRetryCount++;
    if (chatView && currentSession && isGenerating) {
      finalizeCurrentMessage();
      handleUserMessage(lastUserMessageText || '');
    }
  };
}

function resetRateLimitRetries(): void {
  rateLimitRetryCount = 0;
}

let lastUserMessageText: string = '';

function handleRateLimitedRetry(): void {
  if (rateLimitRetryCallback) {
    rateLimitRetryCallback();
    rateLimitRetryCallback = null;
  }
}

let _autoCompactInProgress = false;

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

function expandHome(p: string): string {
  return p.startsWith('~') || p.startsWith('$HOME')
    ? path.join(os.homedir(), p.replace(/^~|\$HOME/, ''))
    : p;
}

function getTrpWorkspaceRoot(): string | undefined {
  const configured = vscode.workspace.getConfiguration('trinno').get<string>('chat.trpWorkspace');
  if (configured) {
    const expanded = path.isAbsolute(configured) ? configured : expandHome(configured);
    if (isTrpWorkspaceRoot(expanded)) return expanded;
  }

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
    console.error('[trinno-chat] sendFileList error:', err);
  }
  const trimmed = files.slice(0, MAX_FILES);
  chatView?.webview.postMessage({
    type: 'file-list',
    workspaceRoot,
    files: trimmed,
  } as ExtToWebViewMessage);
}

async function runIncrementalWrite(type: 'paper' | 'patent', cmd: { title: string; phase: string; writePath: string }, originalText: string): Promise<void> {
  chatView?.webview.postMessage({ type: 'user-message', message: createUserMessage(originalText) } as any);
  const workspaceRoot = getDefaultWorkspaceRoot();
  if (!workspaceRoot) {
    chatView?.webview.postMessage({
      type: 'user-message',
      message: createAssistantMessageForText('未找到工作区根目录。请先打开一个工作区文件夹。'),
    } as any);
    return;
  }

  const absFilePath = path.join(workspaceRoot, cmd.writePath);
  const docLabel = type === 'patent' ? '专利' : '论文';

  const plan = {
    type,
    title: cmd.title,
    phase: cmd.phase,
    writePath: cmd.writePath,
    filePath: absFilePath,
  };

  try {
    await bootstrapFile(plan, workspaceRoot);
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

  const MAX_TURNS = 20;
  let turn = 0;
  let finished = false;
  let stopReason = 'unknown';
  let lastLlmText = '';

  const announceTurn = (idx: number, total: number, action: string) => {
    chatView?.webview.postMessage({
      type: 'user-message',
      message: createAssistantMessageForText(
        `[${docLabel}增量写作] 第 ${idx}/${total} 轮：${action}`
      ),
    } as any);
  };

  isGenerating = true;
  announceTurn(0, MAX_TURNS, `开始撰写《${cmd.title}》 → ${cmd.writePath}`);

  while (!finished && turn < MAX_TURNS) {
    turn += 1;
    const fileTail = await readFileTail(absFilePath, 800).catch(() => '');
    const isFirst = turn === 1;
    const prompt = isFirst
      ? buildBootstrapPrompt(plan)
      : buildContinuePrompt(plan, fileTail);

    const turnStreamingId = `incr_${type}_${turn}_${Date.now()}`;
    currentStreamingId = turnStreamingId;
    const turnMsg = createAssistantMessage();
    currentStreamingMsg = turnMsg;
    chatView?.webview.postMessage({ type: 'streaming-start', messageId: turnStreamingId } as any);

    const llmText = await new Promise<IncrementalTurnResult>((resolveTurn, rejectTurn) => {
      sendIncrementalSectionRequest(
        prompt,
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
        (result) => {
          if (chatView) chatView.webview.postMessage({ type: 'done', messageId: turnStreamingId } as any);
          finalizeCurrentMessage();
          resolveTurn(result);
        },
        (err) => {
          if (chatView) chatView.webview.postMessage({ type: 'error', messageId: turnStreamingId, error: err } as any);
          finalizeCurrentMessage();
          rejectTurn(new Error(err));
        },
        selectedModelConfig || globalModelConfig,
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
      );
    });

    lastLlmText = llmText.llmText;
    const charsShown = llmText.usedWriteFile
      ? (await readFullFile(absFilePath).catch(() => '')).length
      : (llmText.appendedText || '').length;
    announceTurn(turn, MAX_TURNS, `完成 ${charsShown} 字符`);

    if (llmText.usedWriteFile) {
      finished = true;
      stopReason = 'llm-used-write-file';
      break;
    }

    if (!llmText.usedEditFile) {
      finished = true;
      stopReason = 'llm-did-not-use-edit-file';
      chatView?.webview.postMessage({
        type: 'user-message',
        message: createAssistantMessageForText(
          `⚠️ LLM 本轮未调用 edit_file，无法继续增量。已中止。`
        ),
      } as any);
      break;
    }

    const fileContent = await readFullFile(absFilePath).catch(() => '');
    if (isComplete(fileContent, type) || detectDoneInText(llmText.llmText) || !hasAnchor(fileContent)) {
      finished = true;
      stopReason = isComplete(fileContent, type)
        ? 'file-complete-marker'
        : detectDoneInText(llmText.llmText)
          ? 'text-complete-signal'
          : 'anchor-replaced';
      break;
    }
  }

  if (!finished && turn >= MAX_TURNS) {
    stopReason = 'max-turns';
    chatView?.webview.postMessage({
      type: 'user-message',
      message: createAssistantMessageForText(
        `已达 ${MAX_TURNS} 轮上限，自动停止。请检查文件或继续发送 "继续" 增量写作。`
      ),
    } as any);
  }

  isGenerating = false;
  currentStreamingId = null;
  currentStreamingMsg = null;

  try {
    const finalContent = await readFullFile(absFilePath);
    chatView?.webview.postMessage({
      type: 'user-message',
      message: createAssistantMessageForText(
        `${docLabel}撰写完成（${finalContent.length} 字符，${turn} 轮，结束原因: ${stopReason}）。文件: \`${cmd.writePath}\`\n\n${lastLlmText || ''}`.trim()
      ),
    } as any);
  } catch {
    // best-effort final summary
  }
}

async function handleUserMessage(text: string): Promise<void> {
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

  resetRateLimitRetries();
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
            saveSessionStore(sessionStore).catch(() => {});
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
      selectedModelConfig || globalModelConfig,
    );
    return;
  }

  const helpMatch = text.match(/^\/help\s*(.*)$/i);
  if (helpMatch) {
    await handleHelpCommand(helpMatch[1]?.trim() ?? '');
    return;
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
          }
        }
      },
      () => {
        if (chatView) chatView.webview.postMessage({ type: 'done', messageId: assistantMsg.id } as any);
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
            messageId: assistantMsg.id,
            error: err,
          } as ExtToWebViewMessage);
        }
      },
      selectedModelConfig || globalModelConfig,
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
    await runIncrementalWrite(writeAny.type, writeAny.cmd, text);
    return;
  }

  if (isGenerating) {
    console.log('[trinno-chat] panel: isGenerating=true, cancelling');
    cancelGeneration();
    finalizeCurrentMessage();
  }

  console.log('[trinno-chat] panel: handleUserMessage, text length:', text.length, 'sessionId:', currentSession?.id);

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

  const defaultWorkspaceRoot = getDefaultWorkspaceRoot();
  const fileReferenceTarget = resolveCommandFileReference(text, defaultWorkspaceRoot);
  const messageText = fileReferenceTarget?.text ?? text;
  const workspaceRoot = fileReferenceTarget?.workspaceRoot ?? defaultWorkspaceRoot;

  console.log('[trinno-chat] panel: calling sendMessage for messageId:', assistantMsg.id);
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
        }
      }
    },
    (doneData) => {
      console.log('[trinno-chat] panel: onDone callback, doneData:', JSON.stringify(doneData));
      if (doneData?.rateLimited) {
        handleRateLimited(doneData.retryAfter ?? 60, doneData.error ?? '');
        return;
      }
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
      console.log('[trinno-chat] panel: onError callback:', JSON.stringify(err));
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
              saveSessionStore(sessionStore).catch(() => {});
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
      selectedModelConfig || globalModelConfig,
    );
    return;
  }

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
    selectedModelConfig || globalModelConfig,
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
  <title>${getChatConfig().persona.name}</title>
  <link rel="stylesheet" href="${styleUri}">
  <script src="${markedUri}"></script>
  <script src="${mermaidUri}"></script>
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

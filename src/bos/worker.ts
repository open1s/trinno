/**
 * BOS Worker - ESM entry point for TRIZ research orchestration.
 * Run with: tsx src/bos/worker.ts
 *
 * Protocol (JSON over stdio):
 *   Extension → Worker: { type: 'chat', text: string, context?: string, persona?: { name, prompt } }
 *   Extension → Worker: { type: 'cancel' }
 *   Extension → Worker: { type: 'tool-approval', id: string, approved: boolean }
 *   Worker → Extension: { type: 'ready' }
 *   Worker → Extension: { type: 'token', tokenType: 'Text'|'ReasoningContent'|'ToolCall'|'ToolResult', text: string }
 *   Worker → Extension: { type: 'tool-approval-needed', id: string, toolName: string, args: object }
 *   Worker → Extension: { type: 'done' }
 *   Worker → Extension: { type: 'error', error: string }
 *
 * Internal async job control uses @open1s/ezbos pub/sub:
 *   Topics:
 *     - trinno:job:{id}:command   - Job commands (start, cancel)
 *     - trinno:job:{id}:status    - Job status updates (progress, complete, error)
 */

import { composeRoot } from './infrastructure/config/di.js';
import { streamAgent } from './infrastructure/ai/streaming.js';
import { getAgentFactory, initAgentFactory } from './infrastructure/agent-factory.js';
import { createSlashCommandRegistry, SlashCommand } from './slash-commands/index.js';
import { searchMemories, listMemories, addMemory } from '../chat/memory.js';
import {
  contradictionCommand,
  searchCommand,
  sCurveCommand,
  idealityCommand,
  principlesCommand,
  suFieldCommand,
  initCommand,
} from './slash-commands/index.js';
import { ToolPermissionConfig, McpServerConfig } from './infrastructure/config/toolPermissions.js';
import { initApprovalBus, sendApprovalResponse, setApprovalEmitter, cancelAllPendingApprovals } from './infrastructure/config/toolPermissionHook.js';
import { getTypstLspClient, closeTypstLspClient } from './infrastructure/lsp/typst_lsp.js';
import { createModuleLogger } from './infrastructure/logging/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const log = createModuleLogger('worker');

interface TodoEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

function readExistingTodos(workspaceRoot: string): TodoEntry[] | null {
  try {
    const filePath = path.join(workspaceRoot, '.bos', 'memory', 'todo-store.json');
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.todos)) return parsed.todos as TodoEntry[];
  } catch { /* ignore */ }
  return null;
}

const HIDDEN_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'load_skill',
  'list_dir', 'grep_search', 'glob_files', 'ast_grep', 'ast_edit', 'apply_patch',
  'todoread', 'todowrite', 'memory_search', 'memory_store',
]);

function shouldEmitTool(name: string, context: 'call' | 'result'): boolean {
  const trimmedName = name.trim();
  const isHidden = HIDDEN_TOOLS.has(trimmedName);
  if (isHidden) {
    log.debug({ context, trimmedName }, 'hiding tool');
  }
  return !isHidden;
}

function shouldEmitToolCall(name: string): boolean {
  return shouldEmitTool(name, 'call');
}

function shouldEmitToolResult(toolId: string, name?: string): boolean {
  if (name) return shouldEmitTool(name, 'result');
  const tracked = toolCallNames.get(toolId);
  return shouldEmitTool(tracked ?? '', 'result');
}

const toolCallNames = new Map<string, string>();

const prevTokens = new Map<string, { input: number; output: number }>();

let abortController: AbortController | null = null;
let deps: Awaited<ReturnType<typeof composeRoot>> | null = null;
let brain: any = null;
let depsInitPromise: Promise<void> | null = null;
let currentJobId = 0;
let currentAgent: any = null;
let currentSessionIdForCancel: string | null = null;
const activeAgents = new Map<string, { started: any; agent: any }>();
const FALLBACK_PERSONA = 'You are Research Master, a self-directed, tool-first agent that proactively drives tasks end-to-end and outputs structured 7-phase (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution) artifacts using TRIZ/PRISMA/SWOT/PEST/5W1H/PICO, prioritizing importance-weighted KPIs, evidence scoring, and decision factors, driving contradictions→solutions, experiments, risks, and ≤3-day executable tasks, keeping text ≤4 lines and always producing copy-ready documents or files. Use tools whenever possible, and ask for user input only when necessary. Always think step by step, and break down complex problems into smaller parts. If you are unsure about something, use the `websearch` tool to find more information. All tool output is capped at 2000 lines/50KB — if truncated, use grep to find sections (do NOT re-read full output). For large files: read in 500+ line chunks with offset/limit, never tiny slices.`;';

const slashRegistry = createSlashCommandRegistry();

slashRegistry.register(contradictionCommand, ['c', 'contra']);
slashRegistry.register(searchCommand, ['s', 'find']);
slashRegistry.register(sCurveCommand, ['sc', 'scurve']);
slashRegistry.register(idealityCommand, ['i', 'ideal']);
slashRegistry.register(principlesCommand, ['p', 'princ']);
slashRegistry.register(suFieldCommand, ['sf', 'sufield']);
slashRegistry.register(initCommand, ['setup', 'new']);

let pendingSlashOutput: string | null = null;

function loadSkillsFromDir(dirPath: string): void {
  try {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(dirPath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const content = fs.readFileSync(skillPath, 'utf-8');
      const descMatch = content.match(/description:\s*([^\n]+)/);
      const description = descMatch ? descMatch[1]!.trim().replace(/^["']|["']$/g, '') : `Apply ${entry.name} skill`;
      const cmd: SlashCommand = {
        name: entry.name,
        description,
        usage: `/${entry.name}`,
        async execute(args, _deps, emit, _signal) {
          emit('token', {
            tokenType: 'Text',
            text: `Skill \`${entry.name}\` activated.`,
          });
          emit('done', { skillContent: content, skillArgs: args.trim() || undefined });
        },
      };
      slashRegistry.register(cmd);
    }
  } catch {
    // ignore skill loading errors
  }
}

function loadSkillsFromHomeDir(): void {
  loadSkillsFromDir(path.join(os.homedir(), '.agents', 'skills'));
  loadSkillsFromDir(path.join(os.homedir(), '.bos', 'skills'));
}

loadSkillsFromHomeDir();

function chdirToWorkspace(): void {
  const root: string | undefined = (globalThis as any).__TRP_WORKSPACE_ROOT;
  if (root && typeof root === 'string' && root.length > 0) {
    try {
      process.chdir(root);
    } catch {
      // ignore chdir errors
    }
  }
}

process.on('uncaughtException', (err) => {
  try { fs.writeSync(2, `[bos-worker] UNCAUGHT: ${err.message}\n${err.stack}\n`); } catch { }
  try { process.exit(1); } catch { }
});

process.stdout.on('error', (err) => {
  try { fs.writeSync(2, `[bos-worker] stdout error: ${err.message}\n`); } catch { }
});
process.stderr.on('error', (err) => {
  try { fs.writeSync(2, `[bos-worker] stderr error: ${err.message}\n`); } catch { }
});

process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

function emit(type: string, data: any): void {
  if (abortController?.signal.aborted && type !== 'done' && type !== 'error') return;
  const line = JSON.stringify({ type, ...data }) + '\n';
  if (emitQueue.length < EMIT_QUEUE_MAX) {
    emitQueue.push(line);
    scheduleDrain();
  } else {
    droppedEmits++;
    if (droppedEmits === 1 || droppedEmits % 100 === 0) {
      log.warn({ droppedEmits, type }, 'emit queue saturated');
    }
  }
}

const emitQueue: string[] = [];
const EMIT_QUEUE_HIGH = 500;
const EMIT_QUEUE_MAX = 100000;
let droppedEmits = 0;
let drainScheduled = false;
let isDraining = false;

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  setImmediate(drainEmitQueue);
}

function drainEmitQueue(): void {
  drainScheduled = false;
  isDraining = true;
  while (emitQueue.length > 0) {
    const line = emitQueue.shift()!;
    const ok = process.stdout.write(line);
    if (!ok) {
      process.stdout.once('drain', scheduleDrain);
      isDraining = false;
      return;
    }
  }
  isDraining = false;
}

function drainEmitQueueSync(): void {
  while (emitQueue.length > 0) {
    const line = emitQueue.shift()!;
    try {
      const ok = process.stdout.write(line);
      if (!ok) {
        process.stdout.once('drain', scheduleDrain);
        return;
      }
    } catch {
      try { fs.writeSync(1, line); } catch { }
    }
  }
}

function flushEmitQueueSync(): void {
  while (emitQueue.length > 0) {
    const line = emitQueue.shift()!;
    try { process.stdout.write(line); } catch { }
  }
}

process.on('exit', flushEmitQueueSync);
process.on('SIGTERM', () => { flushEmitQueueSync(); process.exit(0); });
process.on('SIGINT', () => { flushEmitQueueSync(); process.exit(0); });

setApprovalEmitter(emit);

async function initBrain(): Promise<any> {
  if (!brain) {
    const { BrainOS } = await import('@open1s/ezbos');
    brain = new BrainOS();
    await brain.start();
  }
  return brain;
}

async function runJobWithPubSub(
  jobId: string,
  handler: (signal: AbortSignal, emit: (type: string, data: any) => void) => Promise<void>
): Promise<void> {
  const localBrain = await initBrain();
  const commandTopic = `trinno:job:${jobId}:command`;
  const statusTopic = `trinno:job:${jobId}:status`;

  const statusPub = await localBrain.publisher(statusTopic);
  const commandSub = await localBrain.subscriber(commandTopic);

  const localAbort = new AbortController();
  abortController = localAbort;

  const localEmit = (type: string, data: any) => {
    if (localAbort.signal.aborted && type !== 'done' && type !== 'error') return;
    statusPub.text(JSON.stringify({ type, ...data })).catch(() => { });
    emit(type, data);
  };

  commandSub.runJson(async (msg: any) => {
    if (msg.type === 'cancel') {
      localAbort.abort();
      await commandSub.stop();
    }
  }).catch(() => { });

  try {
    await handler(localAbort.signal, localEmit);
  } catch (err) {
    if (!localAbort.signal.aborted) {
      await localEmit('error', { error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    await commandSub.stop();
  }
}

function formatUnknownSlash(text: string): string {
  const cmdName = text.trim().split(/\s+/)[0] ?? '';
  const suggestions = slashRegistry.suggest(text, 3);
  if (suggestions.length > 0) {
    return `Unknown command: \`${cmdName}\`. Did you mean: ${suggestions.map(s => `\`/${s}\``).join(', ')}? Type \`/help\` to see all commands.`;
  }
  return `Unknown command: \`${cmdName}\`. Type \`/help\` to see available commands.`;
}

async function handleSlashCommand(text: string, signal: AbortSignal, localEmit: (type: string, data: any) => void): Promise<boolean> {
  const match = slashRegistry.match(text);
  if (!match) return false;

  if (depsInitPromise) await depsInitPromise;
  if (!deps) {
    const wsRoot = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
    deps = await composeRoot({ workspaceRoot: wsRoot });
    // Init factory with tools so the chat agent path also benefits (fixes race condition)
    await initApprovalBus(deps.brain);
    initAgentFactory(deps.brain, {
      defaultTools: deps.tools,
      defaultHooks: [deps.toolPermissionHook, deps.afterToolHook],
    });
    // Start Typst LSP eagerly so first lint call is fast
    getTypstLspClient(wsRoot).catch(() => { });
  }

  const { command, args } = match;

  let capturedOutput = '';
  const capturingEmit: typeof localEmit = (type, data) => {
    if (type === 'token' && data.tokenType === 'Text') {
      capturedOutput += data.text;
    }
    localEmit(type, data);
  };

  try {
    await command.execute(args, deps, capturingEmit, signal);
  } catch (err) {
    if (!signal.aborted) {
      localEmit('error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (capturedOutput) {
    pendingSlashOutput = capturedOutput;
  }

  return true;
}

async function handleChat(text: string, context?: string | null, persona?: { name: string; prompt: string }, apiKey?: string, systemSummary?: string, sessionId?: string, brainOsSession?: string, skillContent?: string, model?: string, baseUrl?: string, toolPermissions?: ToolPermissionConfig, mcpServers?: McpServerConfig[], sandboxEnabled?: boolean): Promise<void> {
  log.trace({ sessionId, textLength: text.length, text: text.slice(0, 200) }, '[TRACE] worker recv chat message');
  abortController = new AbortController();
  const signal = abortController.signal;

  if (depsInitPromise) await depsInitPromise;
  if (!deps) {
    const brainOptions: any = { workspaceRoot: (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd() };
    if (apiKey) brainOptions.apiKey = apiKey;
    if (toolPermissions) brainOptions.toolPermissions = toolPermissions;
    if (sandboxEnabled) brainOptions.sandboxEnabled = sandboxEnabled;
    deps = await composeRoot(brainOptions);
    await initApprovalBus(deps.brain);
    initAgentFactory(deps.brain, {
      defaultTools: deps.tools,
      defaultHooks: [deps.toolPermissionHook, deps.afterToolHook],
    });
    getTypstLspClient(brainOptions.workspaceRoot).catch(() => { });
  }

  const slashList = slashRegistry.list().map(c => '- /' + c.name + ': ' + c.description).join('\n');
  const personaPrompt = persona && typeof persona.prompt === 'string' && persona.prompt.trim()
    ? persona.prompt.trim()
    : FALLBACK_PERSONA;
  const methodologyPrompt = buildMethodologyPrompt(slashList);
  const basePrompt = `${personaPrompt}\n\n${methodologyPrompt}`;

  let systemPrompt = systemSummary
    ? `${basePrompt}\n\n## Conversation History Summary\n\n${systemSummary}`
    : basePrompt;

  // Inject Typst LSP diagnostics for all .typ files in workspace
  const typstWsRoot = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
  const typstDiags2 = await collectTypstDiagnostics(typstWsRoot);
  if (typstDiags2) {
    systemPrompt += typstDiags2;
  }

  // Inject relevant memories from the memory store
  const ws = (globalThis as any).__TRP_WORKSPACE_ROOT;
  if (ws) {
    try {
      // Strip skill/agent wrappers for cleaner search query
      const cleanText = text.replace(/<\/?trinno_skill>/g, '').replace(/<\/?user_input>/g, '').trim();
      const byQuery = searchMemories(ws, cleanText, { limit: 6 });
      const memoriesText = byQuery.length > 0
        ? byQuery.map((m: any) => `- [${m.type}] ${m.content}`).join('\n')
        : listMemories(ws, { limit: 4, type: 'summary' }).map((m: any) => `- [summary] ${m.content}`).join('\n');
      if (memoriesText) {
        systemPrompt += `\n\n## Relevant Memories\n${memoriesText}\n\nUse \`memory_search\` for deeper queries, \`memory_store\` to persist important findings.`;
      }
    } catch (e) {
      // memory store unavailable, proceed without it
    }
  }

  let effectiveMcp = mcpServers;
  if (!effectiveMcp || effectiveMcp.length === 0) {
    effectiveMcp = getAgentFactory().getDefaultMcpServers();
  }

  emit('mcp-status', {
    servers: (effectiveMcp || []).map((s: any) => ({ name: s.name, type: s.type, connected: true })),
  });

  try {
    const lsp = await getTypstLspClient((globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd());
    emit('lsp-status', { name: 'tinymist', status: lsp.isInitialized ? 'connected' : 'starting', trackedFile: _trackedTypFile || null });
  } catch { emit('lsp-status', { name: 'tinymist', status: 'disconnected', trackedFile: null }); }

  log.info({ sessionId }, 'creating fresh agent');
  const f = getAgentFactory();
  const agent = f.create({
    name: 'trinno-chat',
    systemPrompt,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    mcpServers: effectiveMcp,
  });

  log.debug('about to call agent.start()');
  const started = await agent.start();
  log.debug('agent.start() done');

  if (sessionId) {
    // Check if the factory has a more recent session for this sessionId
    const factorySession = getAgentFactory().getSessionContext(sessionId);
    const sessionToImport = factorySession?.brainOsSession || brainOsSession;
    log.debug({ hasSessionToImport: !!sessionToImport, sessionLen: sessionToImport?.length }, 'importSession check');
    if (sessionToImport) {
      try {
        started.importSession(sessionToImport);
        log.debug('importSession done');
      } catch (e) {
        log.warn({ err: e }, 'importSession error');
        // ignore import errors, start fresh
      }
    }
  } else if (brainOsSession) {
    try {
      started.importSession(brainOsSession);
    } catch {
      // ignore import errors, start fresh
    }
  }

  let userMessage = text;
  if (skillContent) {
    userMessage = `<trinno_skill>\n${skillContent}\n</trinno_skill>\n\n<user_input>\n${text}\n</user_input>`;
  }

  if (skillContent) {
    const wr2 = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
    const existingTodos2 = readExistingTodos(wr2);
    if (existingTodos2 && existingTodos2.length > 0) {
      const todoSummary2 = existingTodos2
        .map(t => `- [${t.status}] ${t.content} (${t.priority})`)
        .join('\n');
      userMessage = userMessage + `\n\n<system_context>\nExisting todos from disk (resume from first incomplete):\n${todoSummary2}\n</system_context>`;
    }
  }

  currentAgent = started;
  currentSessionIdForCancel = sessionId || null;

  try {
    log.trace({ sessionId, userMessageLen: userMessage.length }, '[TRACE] worker→LLM: starting stream');
    let hasRealContent = false;
    let streamDone = false;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    const HEARTBEAT_TIMEOUT_MS = 45000;

    const clearHeartbeatTimer = () => {
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    let doResolve: () => void = () => { };

    const resetHeartbeatTimer = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        if (streamDone) return;
        log.warn('stream heartbeat timeout — no real content in 45s, aborting');
        clearHeartbeatTimer();
        emit('rate-limited', { retryAfter: 15, error: 'Upstream timeout (heartbeat only stream)' });
        streamDone = true;
        doResolve();
      }, HEARTBEAT_TIMEOUT_MS);
    };

    resetHeartbeatTimer();

    let responseCharCount = 0;
    let responseSizeWarningEmitted = false;
    const RESPONSE_SIZE_THRESHOLD = 3000; // chars, roughly ~750 tokens

    await new Promise<void>((resolve) => {
      doResolve = resolve;
      started.stream(userMessage, (token: any) => {
        if (streamDone) return;
        if (signal.aborted) {
          started.stop().catch(() => { });
          streamDone = true;
          resolve();
          return;
        }

        switch (token.type) {
          case 'ReasoningContent':
            if (token.text && token.text.length > 0) {
              hasRealContent = true;
              resetHeartbeatTimer();
              responseCharCount += token.text.length;
            }
            emit('token', { tokenType: 'ReasoningContent', text: token.text });
            if (emitQueue.length > EMIT_QUEUE_HIGH) drainEmitQueueSync();
            break;
          case 'Text':
            if (token.text && token.text.length > 0) {
              if (!hasRealContent) {
                log.trace({ sessionId, firstTokenLen: token.text.length }, '[TRACE] worker←LLM: first text token received');
              }
              hasRealContent = true;
              resetHeartbeatTimer();
              responseCharCount += token.text.length;
              // Warn if approaching size limit
              if (!responseSizeWarningEmitted && responseCharCount > RESPONSE_SIZE_THRESHOLD) {
                responseSizeWarningEmitted = true;
                emit('token', {
                  tokenType: 'Text',
                  text: '\n\n⚠️ **Response approaching size limit** (~' + Math.round(responseCharCount / 100) + ' chars). Follow .instructions.md patterns: break into smaller tasks, mark progress with todo list.',
                });
              }
            }
            emit('token', { tokenType: 'Text', text: token.text });
            if (emitQueue.length > EMIT_QUEUE_HIGH) drainEmitQueueSync();
            break;
          case 'ToolCall':
            if (token.name) {
              hasRealContent = true;
              resetHeartbeatTimer();
              responseCharCount += (token.name?.length ?? 0) + 20;
            }
            if (token.id && token.name) toolCallNames.set(token.id, token.name);
            if (token.name === 'write_file' && token.args?.filePath && String(token.args.filePath).endsWith('.typ')) {
              trackTypFile(String(token.args.filePath));
            } else if (token.name === 'edit_file' && token.args?.filePath && String(token.args.filePath).endsWith('.typ')) {
              trackTypFile(String(token.args.filePath));
            }
            if (shouldEmitToolCall(token.name)) {
              emit('token', { tokenType: 'ToolCall', text: token.name, toolId: token.id, ...(token.args ? { args: token.args } : {}) });
            }
            if (emitQueue.length > EMIT_QUEUE_HIGH) drainEmitQueueSync();
            break;
          case 'ToolResult':
            log.trace({ name: token.name, id: token.id, hasResult: !!token.result }, 'ToolResult token');
            if (token.result || token.text) {
              hasRealContent = true;
              resetHeartbeatTimer();
              const resultStr = (token.result || token.text || '');
              responseCharCount += resultStr.length;
            }
            if (toolCallNames.get(token.id ?? '') === 'todowrite') {
              emitTodoUpdate();
            }
            if (shouldEmitToolResult(token.id, token.name)) {
              emit('token', {
                tokenType: 'ToolResult',
                text: token.result || token.text || '',
                toolId: token.id,
                status: 'completed'
              });
            }
            if (emitQueue.length > EMIT_QUEUE_HIGH) drainEmitQueueSync();
            break;
          case 'Heartbeat':
            resetHeartbeatTimer();
            break;
          case 'Stop':
          case 'Done': {
            clearHeartbeatTimer();
            streamDone = true;
            log.trace({ sessionId, responseCharCount }, '[TRACE] worker←LLM: stream done');
            if (!hasRealContent) {
              log.warn({ tokenType: token.type }, 'no real content — treating as rate-limit');
              emit('rate-limited', { retryAfter: 15, error: 'Empty response (possible rate limit)' });
              resolve();
              break;
            }
            let exportedSession: string | undefined;
            if (sessionId) {
              try {
                exportedSession = started.exportSession();
                if (exportedSession) {
                  const prevCtx = getAgentFactory().getSessionContext(sessionId);
                  getAgentFactory().setSessionContext(sessionId, {
                    brainOsSession: exportedSession,
                    lastUpdated: Date.now(),
                  });
                }
              } catch {
                // ignore export errors
              }
            }
            const metrics = started.metrics;
            const cumInput = metrics?.totalInputTokens ?? 0;
            const cumOutput = metrics?.totalOutputTokens ?? 0;
            const key = sessionId ?? 'default';
            const prev = prevTokens.get(key) ?? { input: 0, output: 0 };
            const inputTokens = cumInput - prev.input;
            const outputTokens = cumOutput - prev.output;
            prevTokens.set(key, { input: cumInput, output: cumOutput });
            log.trace({ sessionId, metrics, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, '[TOKEN] worker (slash): stream done');
            emit('done', {
              sessionId,
              brainOsSession: exportedSession,
              inputTokens,
              outputTokens,
            });
            resolve();
            break;
          }
          case 'Error':
            clearHeartbeatTimer();
            streamDone = true;
            if (isRateLimited(token.error)) {
              const retryAfter = parseRetryAfter(token.error);
              emit('rate-limited', { retryAfter, error: token.error });
            } else {
              emit('error', { error: token.error });
            }
            resolve();
            break;
        }
      });
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (isRateLimited(errMsg)) {
      const retryAfter = parseRetryAfter(errMsg);
      emit('rate-limited', { retryAfter, error: errMsg });
    } else {
      emit('error', { error: errMsg });
    }
  } finally {
    currentAgent = null;
    currentSessionIdForCancel = null;
  }
}

function isRateLimited(errorMsg: string): boolean {
  return /429|rate.?limit|too many requests/i.test(errorMsg);
}

export function parseRetryAfter(errorMsg: string): number {
  const patterns: RegExp[] = [
    /retry.?after\s*[=:]?\s*(\d+)\s*s/i,
    /try again in (\d+)\s*s/i,
    /please retry in (\d+)\s*seconds/i,
    /in (\d+)\s*seconds/i,
    /retry-after:\s*(\d+)/i,
    /"retry_after"\s*:\s*(\d+)/i,
  ];
  for (const re of patterns) {
    const match = errorMsg.match(re);
    if (match && match[1]) {
      const seconds = parseInt(match[1], 10);
      if (seconds > 0 && seconds <= 300) return seconds;
    }
  }
  return 15;
}

export function isRateLimitedForTest(msg: string): boolean {
  return isRateLimited(msg);
}

/**
 * Debug helper: wraps an LLM stream callback to inject mock errors.
 *
 * Enable via env vars:
 *   TRINNO_MOCK_ERROR=rate_limited   — simulate rate-limit (429) with 10s retry
 *   TRINNO_MOCK_ERROR=error           — simulate generic LLM error
 *   TRINNO_MOCK_ERROR_AFTER=N         — inject after N tokens (default 2)
 *   TRINNO_MOCK_ENABLE=1              — must also be set to activate (extra safety)
 */
function withMockInjector(
  callback: (token: any) => void,
  emitFn: (type: string, data: any) => void,
  resolve: () => void,
): (token: any) => void {
  const mockType = process.env.TRINNO_MOCK_ERROR || '';
  const enabled = process.env.TRINNO_MOCK_ENABLE === '1';

  if (!mockType || !enabled) return callback;
  const after = parseInt(process.env.TRINNO_MOCK_ERROR_AFTER || '2', 10);
  let count = 0;
  let done = false;

  log.info('[MOCK] LLM mock injector enabled — type=%s after=%d', mockType, after);

  return (token: any) => {
    if (done) return;
    if (token.type === 'Stop' || token.type === 'Done' || token.type === 'Error') return;
    count++;
    if (count < after) {
      callback(token);
      return;
    }
    done = true;
    log.info('[MOCK] injecting mock LLM error at token #%d (type=%s)', count, mockType);

    if (mockType === 'rate_limited') {
      emitFn('rate-limited', { retryAfter: 10, error: '[MOCK] Simulated rate limit (429) for debugging' });
    } else {
      emitFn('error', { error: '[MOCK] Simulated LLM error for debugging' });
    }
    resolve();
  };
}

function handleCancel(): void {
  abortController?.abort();
  cancelAllPendingApprovals();
  if (currentAgent) {
    currentAgent.stop().catch(() => { });
    currentSessionIdForCancel = null;
  }
  // Discard all cached agents so next message creates fresh
  activeAgents.clear();
}

function emitMcpStatus(): void {
  try {
    const servers = getAgentFactory().getDefaultMcpServers()
      .map((s: any) => ({ name: s.name, type: s.type, connected: true }));
    emit('mcp-status', { servers });
  } catch (e) {
    emit('mcp-status', { servers: [] });
  }
}

function emitLspStatus(): void {
  const wsRoot = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
  getTypstLspClient(wsRoot).then(lsp => {
    emit('lsp-status', { name: 'tinymist', status: lsp.isInitialized ? 'connected' : 'starting', trackedFile: _trackedTypFile || null });
  }).catch(() => {
    emit('lsp-status', { name: 'tinymist', status: 'disconnected', trackedFile: null });
  });
}

function emitTodoUpdate(): void {
  const wsRoot = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
  const todos = readExistingTodos(wsRoot);
  emit('todo-update', { todos: todos || [] });
  drainEmitQueueSync();
}

function loadSoulMd(): string {
  let soul = undefined;
  try {
    const wsRoot = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
    const projectSoul = path.join(wsRoot, 'SOUL.md');
    if (fs.existsSync(projectSoul)) {
      soul = fs.readFileSync(projectSoul, 'utf-8').trim();
    }
  } catch { }

  if (soul) return soul;

  let homeContent = undefined;
  try {
    const homeSoul = path.join(os.homedir(), '.bos', 'skills', 'SOUL.md');
    if (fs.existsSync(homeSoul)) {
      homeContent = fs.readFileSync(homeSoul, 'utf-8').trim();
    }
  } catch { }
  return homeContent ?? '';
}

function buildMethodologyPrompt(slashCommandsList: string): string {
  const soul = loadSoulMd();
  const soulSection = soul ? `\n\n## SOUL (Must Follow,Must Follow)\n\n${soul}\n\n` : '';
  return soulSection + [
    '## Persona Anchor (8-Phase Research Pipeline)',
    '- You operate inside a 8-phase pipeline: Problem → Context → Evidence → Modeling → TRIZ → Validation → Execution',
    '- Toolkit: TRIZ + PRISMA + SWOT + PEST + 5W1H + PICO',
    '- Always importance-weight KPIs, score evidence (0–1), surface decision factors',
    '- Drive contradictions → solutions, experiments, risks, and ≤3-day executable tasks',
    '- Keep text ≤4 lines, produce copy-ready artifacts or files',
    '- Use tools whenever possible; ask user only when essential info is missing',
    '- Think step by step, break complex problems into smaller parts',
    '- When uncertain, use websearch first',
    '- When need user clarification, ask specific, concise questions,give choices for selection. Avoid open-ended questions.',
    '',
    '## Phased Research Philosophy',
    '- Research is incremental. Complete one phase before moving to the next.',
    '- 01_Discover → 02_TRL → 03_Analyze → 04_Synthesize → 05_Deliver → 06_References → 07_Patent  → 08_TData.',
    '- Each phase writes its output to the corresponding phase directory. Do not skip phases.',
    '- If context grows large, suggest compaction (/compact) instead of summarizing yourself.',
    '',
    '## Core Rule: Actions Produce Results via Tools, Never via Text',
    '- Your job is to produce concrete results in files and data, not in conversation text.',
    '- To create/modify a file → use write_file or edit_file immediately. Never output file content as text.',
    '- To refine/fix/update any file → read_file first, then edit_file. Your text response is only a 1-line confirmation.',
    '- To search/gather data → use triz_search, triz_contradiction, triz_principles, triz_s_curve, websearch. Summarize briefly, then act.',
    '- Text responses are ONLY for: brief status (≤4 lines), asking clarifying questions, or reporting completion.',
    '- If user says "refine X", "fix X", "update X", "add X to file" → use edit_file. Do not output the file content as text.',
    '- Convert any contradiction into: principles to apply, ≤3-day validation experiment, risk register',
    '',
    '## Tone and Style',
    '- Concise, direct, no preamble, no postamble.',
    '- ≤4 lines of text (not including tool calls). One-sentence answers are best.',
    '- After completing work (editing a file, finishing analysis), stop. No "code summary" follow-ups.',
    '- Never start with "Here is what I will do:", "Let me explain:", etc. Just act.',
    '- If you cannot help, offer alternatives in 1–2 sentences.',
    '- All output must be valid UTF-8 — no garbled text, no mojibake, no partial or corrupted characters.',
    '',
    '## Proactiveness',
    '- Be proactive only when the user asks. Then stop.',
    '- Do not surprise the user with unprompted actions or follow-ups.',
    '- If asked how to approach something, answer first, then act on confirmation.',
    '',
    '## Verification',
    '- After writing/editing a file: read_file to confirm, run tests if available.',
    '- Check the README or search the codebase for the test command. NEVER assume the framework.',
    '- NEVER add comments unless the user explicitly asks.',
    '- For each principle/parameter cited, verify it exists in the matrix before recommending.',
    '',
    '## Parallel Execution',
    '- Read multiple independent files in parallel (batch read_file calls).',
    '- Both EN and ZH queries for technical topics — batch them.',
    '- Aggregate results by DOI/arXivID; dedupe before scoring evidence.',
    '',
    '## Large File & Truncated Output Handling',
    '- All tool output is capped at 200 lines / 10KB. If you see "... X lines truncated..." at the end of output, do NOT re-read the full output — it will be truncated again.',
    '- Instead: use grep tool with specific patterns to find relevant sections, or read specific chunks from the source file with offset/limit.',
    '- For files >500 lines: always paginate with read(filePath, offset=N, limit=500+). Never read entire large files.',
    '- Read in 50-200 line chunks. Never request tiny slices (<50 lines).',
    '- Follow the "Use offset=N to continue." hint in read output — that tells you exactly where to continue.',
    '- For large-scale analysis across a big file: delegate to a task sub-agent that uses grep/read internally.',
    '',
    '## Context Budget',
    '- After tool calls: 1-line status, then next action. Max 2 retries on a failing tool.',
    '- If analysis exceeds 5 tool calls, pause and summarize decision factors + next step.',
    '- If context grows large, suggest /compact.',
    '',
    '## Routing (apply importance-weighted decision factors)',
    '- Unknown scope → 5W1H',
    '- Clinical / biomedical Q → PICO → PRISMA',
    '- Technical barrier / invention → TRIZ (Contradiction Matrix → Inventive Principles → Su-Field)',
    '- Evidence synthesis → PRISMA',
    '- Strategic / competitive → SWOT (+ PEST)',
    '- New market / tech landscape → PEST (+ SWOT)',
    '- Always weight routes by importance × uncertainty; surface the chosen route + rationale',
    '',
    '## PICO',
    'PICO/PICOS: P-Population, I-Intervention, C-Comparison, O-Outcome, S-Study design. Template: "In [P], does [I] vs [C] affect [O]?" PRISMA consumes PICO upstream.',
    '',
    '## Phase Dirs — Output Format',
    '- 01_Discover — search and discover references, download papers to 06_References',
    '- 02_TRL — s_curve.md, trl_assessment.md',
    '- 03_Analyze — contradictions.md, su_field_analysis.md, bottlenecks.md',
    '- 04_Synthesize — solutions.md, principles_applied.md, trends.md, roadmap.md',
    '- 05_Deliver — paper, report drafts (.typ or .md)',
    '- 06_References — downloaded papers + library.bib',
    '- 07_Patent — patent drafts (.typ or .md)',
    '- 08_TData — experimental data, code snippets, etc.',
    'Always write results to files in the correct phase dir. Use markdown format (.md) for all analysis output files. Include importance weights and evidence scores in tables or structured sections.',
    '',
    '## Multilingual + PubScholar',
    '- For technical topics: run EN + ZH queries in parallel, dedupe by DOI/arXivID. CN journals: 自动化学报, 控制与决策, 机器人, etc.',
    '- PubScholar (pubscholar.cn) API is gated, but file CDN at `file.scholarin.cn/preview2?file=editor_cj_{hash}.pdf` is open. Pass the article URL to papers_download.',
    '- Output language follows user input language — if user writes in Chinese, respond in Chinese; if English, respond in English. Never mix languages in the same output. Ensure all Chinese characters are valid UTF-8 — no garbled text, no partial characters, no mojibake.',
    '',
    '## Writing Papers/Patents (use /patent or /write paper, LLM self-directs with skills, plan via todos, write incrementally, verify each step)',
    '- When writing is requested, the panel injects a skill (paper-writer or patent-writer); load via load_skill.',
    '- Use todowrite to plan sections, then read_file/write_file/edit_file to write incrementally.',
    '- AMBIGUOUS ("write a paper" without colon+title) → do NOT invent topic. Ask for the topic.',
    '- Target artifact: 7-phase paper with contradiction → solution mapping, importance-weighted KPIs, evidence scores, decision factors, risks, ≤3-day validation.',
    '- Verify each section before marking completed.',
    '- Aways build typst output file using \`typst compile\`, then fix errors',
    '',
    '## Remote Skills (If no proper skill available for the task,find if remote skill)',
    '- When user asks for a specialized methodology, framework, workflow, or domain task (e.g., patent drafting, paper writing, systematic review, data analysis, coding pattern, journal-specific formatting), FIRST extract keywords and call `find_remote_skill("<keywords>")` to search registered skill repos.',
    '- `find_remote_skill` returns matching skills with a `name`, call `load_remote_skill("<name>")` to get the full skill instructions, then follow them precisely.',
    '',
    '## File Operations',
    'read_file first, never guess. For large files, paginate with offset/limit (200+ lines per chunk). edit_file for any change (refine/fix/improve/append). write_file only for brand-new files. Every file modification MUST use edit tool — text output is never a substitute for writing to disk.',
    '',
    '## Tools',
    'TRIZ: triz_search, triz_principles, triz_parameters, triz_contradiction, triz_insight, triz_su_field, triz_ideality, triz_s_curve.',
    'Papers: search, papers_download, papers_list_downloaded.',
    'Web: websearch (current events, anything you are unsure about).',
    'Skills: find_remote_skill (search registered skill repos), load_remote_skill (load skill instructions by name).',
    'FS: read_file, write_file, edit_file, list_dir, grep_search, glob_files, ast_grep, ast_edit, apply_patch, bash, exec_tool. bash needs user approval. read/write/edit_file/list_dir are workspace-scoped.',
    'Planning: todowrite for tracking multi-step writing tasks only (papers/patents). todoread to check saved state. Do NOT todowrite for single-file edits or chat questions — just do the work with read_file/edit_file.',
    'Full schemas come via function-calling API.',
    '',
    '## Tool-Call Format',
    'Single JSON object. No XML. No commentary. "not support such call" → don\'t retry, reformulate in plain text.',
  ].join('\n');
}

function handleHelp(): void {
  const commands = slashRegistry.list();
  let text = '## Available Slash Commands\n\n';
  for (const cmd of commands) {
    text += `### /${cmd.name}\n${cmd.description}\n\n**Usage:** \`${cmd.usage}\`\n\n`;
  }
  emit('token', { tokenType: 'Text', text });
  emit('done', {});
}

interface CompactMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

async function handleCompact(
  messages: CompactMessage[],
  systemSummary: string | undefined,
  persona: { name: string; prompt: string } | undefined,
  apiKey: string | undefined,
  model?: string,
  baseUrl?: string
): Promise<void> {
  log.info({ messageCount: messages.length }, 'handleCompact START');

  if (depsInitPromise) await depsInitPromise;
  if (!deps) {
    const brainOptions: any = { workspaceRoot: (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd() };
    if (apiKey) brainOptions.apiKey = apiKey;
    deps = await composeRoot(brainOptions);
    await initApprovalBus(deps.brain);
    initAgentFactory(deps.brain, {
      defaultTools: deps.tools,
      defaultHooks: [deps.toolPermissionHook, deps.afterToolHook],
    });
    getTypstLspClient(brainOptions.workspaceRoot).catch(() => { });
  }

  const conversationText = messages.map(m => {
    const reasoning = m.reasoning ? `\n[Reasoning: ${m.reasoning.slice(0, 200)}]` : '';
    return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}${reasoning}`;
  }).join('\n\n');

  const summaryPrompt = `You are Research Master — a self-directed, tool-first agent compressing a conversation transcript into a 7-phase (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution) summary. Use TRIZ/PRISMA/SWOT/PEST/5W1H/PICO concepts, weight KPIs by importance, score evidence, surface decision factors.

Transcript may contain: user messages, assistant responses, tool calls, tool results, errors.

Produce a structured, ≤4-line-per-block, copy-ready markdown summary covering:
- User intent and key inputs (which 7-phase step this lives in)
- Assistant actions, especially tool usage (which tools, why, what happened)
- Decision factors, key outcomes, contradictions→solutions surfaced
- Context, constraints, assumptions
- Errors, failures, retries
- Remaining open questions and next ≤3-day executable steps

Requirements:
- Specific, not generic phrasing; compression ratio > 60%
- Preserve technical meaning and causal links
- Drop repetition, keep signal
- Omit irrelevant tool usage
- Importance-weighted: rank items by impact
- Always produce copy-ready text

Conversation:
${conversationText}
`;
  const basePrompt = persona?.prompt || FALLBACK_PERSONA;
  let systemPrompt = systemSummary
    ? `${basePrompt}\n\n## Prior Conversation Summary\n\n${systemSummary}`
    : basePrompt;

  const f = getAgentFactory();
  const agent = f.create({
    name: 'trinno-compact',
    systemPrompt,
    temperature: 0.3,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });

  const started = await agent.start();

  try {
    let compactText = '';
    await new Promise<void>((resolve, reject) => {
      started.stream(summaryPrompt, (token: any) => {
        switch (token.type) {
          case 'ReasoningContent':
            emit('token', { tokenType: 'ReasoningContent', text: token.text });
            break;
          case 'Text':
            compactText += token.text;
            emit('token', { tokenType: 'Text', text: token.text });
            break;
          case 'Done':
            // Store compact summary in long-term memory
            const ws2 = (globalThis as any).__TRP_WORKSPACE_ROOT;
            if (ws2 && compactText.trim().length > 50) {
              try {
                addMemory(ws2, {
                  type: 'summary',
                  content: compactText.trim().slice(0, 500),
                  tags: ['compact', 'session-summary'],
                  source: 'compact',
                });
              } catch (e) {
                // best-effort
              }
            }
            const compactMetrics = started?.metrics;
            const compactIn = compactMetrics?.totalInputTokens ?? 0;
            const compactOut = compactMetrics?.totalOutputTokens ?? 0;
            log.trace({ inputTokens: compactIn, outputTokens: compactOut, totalTokens: compactIn + compactOut }, '[TOKEN] worker: compact done');
            emit('done', { compacted: true });
            resolve();
            break;
          case 'Error':
            emit('error', { error: token.error });
            resolve();
            break;
        }
      });
    });
  } catch (err) {
    emit('error', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    started.stop().catch(() => { });
  }
}

// Serial async message queue — prevents one hung LLM call from blocking stdin
interface QueuedMessage {
  type: string;
  run: () => Promise<void>;
}
const msgQueue: QueuedMessage[] = [];
let msgQueueProcessing = false;

async function drainMsgQueue(): Promise<void> {
  if (msgQueueProcessing) return;
  msgQueueProcessing = true;
  while (msgQueue.length > 0) {
    const item = msgQueue.shift()!;
    try {
      await item.run();
    } catch (err) {
      log.error({ err, msgType: item.type }, 'message processing error');
    }
  }
  msgQueueProcessing = false;
}

function enqueue(type: string, run: () => Promise<void>): void {
  msgQueue.push({ type, run });
  drainMsgQueue();
}

let stdinBuffer = '';
process.stdin.on('data', (chunk: Buffer) => {
  stdinBuffer += chunk.toString();
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      switch (msg.type) {
        case 'init':
          enqueue('init', async () => {
            if (msg.workspaceRoot) {
              (globalThis as any).__TRP_WORKSPACE_ROOT = msg.workspaceRoot;
              chdirToWorkspace();
            }
            if (!deps && !depsInitPromise) {
              depsInitPromise = (async () => {
                const wsRoot = msg.workspaceRoot || process.cwd();
                const brainOptions: any = { workspaceRoot: wsRoot };
                if (msg.apiKey) brainOptions.apiKey = msg.apiKey;
                if (msg.toolPermissions) brainOptions.toolPermissions = msg.toolPermissions;
                if (msg.sandboxEnabled) brainOptions.sandboxEnabled = msg.sandboxEnabled;
                const d = await composeRoot(brainOptions);
                deps = d;
                await initApprovalBus(deps.brain);
                getTypstLspClient(wsRoot).catch(() => { });
              })();
            }
            if (depsInitPromise) {
              try { await depsInitPromise; } catch (e) {
                depsInitPromise = null;
                deps = null;
              }
            }
          });
          break;
        case 'chat':
          enqueue('chat', async () => {
            log.info({ textLen: msg.text?.length, sessionId: msg.sessionId }, 'recv chat');
            if (msg.workspaceRoot) {
              (globalThis as any).__TRP_WORKSPACE_ROOT = msg.workspaceRoot;
              chdirToWorkspace();
            }
            currentJobId++;
            const jobId = String(currentJobId);

            if (msg.text.trim() === '/help' || msg.text.trim() === '/commands') {
              handleHelp();
            } else if (msg.usePubSub) {
              await runJobWithPubSub(jobId, async (signal, localEmit) => {
                await handleChatWithEmit(
                  msg.text,
                  msg.context ?? null,
                  msg.persona,
                  msg.apiKey,
                  msg.systemSummary,
                  localEmit,
                  signal,
                  msg.sessionId,
                  msg.brainOsSession,
                  msg.skillContent,
                  msg.model,
                  msg.baseUrl,
                  msg.toolPermissions,
                  msg.mcp?.servers,
                  msg.sandboxEnabled,
                );
              });
            } else {
              abortController = new AbortController();
              await handleChatWithEmit(
                msg.text,
                msg.context ?? null,
                msg.persona,
                msg.apiKey,
                msg.systemSummary,
                emit,
                abortController.signal,
                msg.sessionId,
                msg.brainOsSession,
                msg.skillContent,
                msg.model,
                msg.baseUrl,
                msg.toolPermissions,
                msg.mcp?.servers,
                msg.sandboxEnabled,
              );
            }
          });
          break;
        case 'cancel':
          handleCancel();
          break;
        case 'tool-approval': {
          // Must bypass the message queue: the in-flight chat/agent call awaits
          // the pending approval promise. If we queue this behind it, the
          // resolve never runs and the tool hangs forever.
          sendApprovalResponse(msg.id, msg.approved, msg.remember).catch((err) =>
            log.error({ err, msgId: msg.id }, 'sendApprovalResponse error'),
          );
          break;
        }
        case 'compact':
          enqueue('compact', async () => {
            await handleCompact(msg.messages, msg.systemSummary, msg.persona, msg.apiKey, msg.model, msg.baseUrl);
          });
          break;
        case 'clear-session':
          if (msg.sessionId) {
            const existing = activeAgents.get(msg.sessionId);
            if (existing?.started) {
              try { existing.started.clearSession(); } catch {
                // best effort — agent may be mid-stream
              }
            }
            getAgentFactory().clearSessionContext(msg.sessionId);
            activeAgents.delete(msg.sessionId);
          }
          break;
        case 'compact-result':
          enqueue('compact-result', async () => {
            if (msg.sessionId && msg.summary) {
              const factory = getAgentFactory();
              const agent = factory.create({
                name: 'trinno-compact-result',
                systemPrompt: `## Conversation History Summary\n\n${msg.summary}`,
                temperature: 0.3,
              });
              const started = await agent.start();
              try {
                const exported = started.exportSession();
                if (exported) {
                  factory.setSessionContext(msg.sessionId, {
                    brainOsSession: exported,
                    lastUpdated: Date.now(),
                  });
                }
              } finally {
                started.stop().catch(() => { });
              }
            }
          });
          break;
        case 'slash':
          enqueue('slash', async () => {
            if (msg.workspaceRoot) {
              (globalThis as any).__TRP_WORKSPACE_ROOT = msg.workspaceRoot;
              chdirToWorkspace();
            }
            currentJobId++;
            const slashJobId = String(currentJobId);
            if (msg.usePubSub) {
              await runJobWithPubSub(slashJobId, async (signal, localEmit) => {
                const matched = await handleSlashCommand(msg.text, signal, localEmit);
                if (!matched) {
                  localEmit('error', { error: formatUnknownSlash(msg.text) });
                }
              });
            } else {
              const matched = await handleSlashCommand(msg.text, abortController?.signal ?? new AbortController().signal, emit);
              if (!matched) {
                emit('error', { error: formatUnknownSlash(msg.text) });
              }
            }
          });
          break;
        case 'paper':
          enqueue('paper', async () => {
            const paperWorkflowPrompt = [
              'You are Research Master writing a paper. Drive the 7-phase pipeline (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution) end-to-end and produce a copy-ready artifact via tools only.',
              '1. Use TRIZ tools (triz_contradiction, triz_principles, triz_s_curve, triz_search, websearch) to gather Evidence and decision factors — never fabricate',
              '2. write_file to 05_Deliver/<slug>.typ — 3000+ word paper in Chinese typst, Dont mix markdown. All Chinese must be valid UTF-8 — no garbled text, no mojibake, no partial characters. Structured: 摘要→引言→矛盾分析→物场分析→解决方案→S曲线→路线图→TRL→结论→参考文献',
              '3. Importance-weight KPIs, score evidence, surface decision factors, contradictions→solutions, risks, ≤3-day executable validation steps',
              '4. ≤4 lines per text response — only short confirmation after writing; never repeat the paper content in chat',
              '5. No fabricated parameter numbers, no preamble ("我将为您撰写…"), ask user only when essential info is missing',
            ].join('\n');
            const userPersonaPromptForPaper = msg.persona && typeof msg.persona.prompt === 'string' && msg.persona.prompt.trim()
              ? msg.persona.prompt.trim()
              : null;
            const paperPersona = {
              name: 'trinno-paper',
              prompt: userPersonaPromptForPaper
                ? `${userPersonaPromptForPaper}\n\n---\n\n${paperWorkflowPrompt}`
                : paperWorkflowPrompt,
            };
            abortController = new AbortController();
            await handleChatWithEmit(
              msg.prompt,
              null,
              paperPersona,
              msg.apiKey,
              undefined,
              emit,
              abortController.signal,
              undefined,
              undefined,
              undefined,
              msg.model,
              msg.baseUrl,
              undefined,
              undefined,
              msg.sandboxEnabled,
            );
          });
          break;

        case 'mcp-status-request':
          emitMcpStatus();
          break;
        case 'lsp-status-request':
          emitLspStatus();
          break;
        case 'todo-status-request':
          if (msg.workspaceRoot) {
            (globalThis as any).__TRP_WORKSPACE_ROOT = msg.workspaceRoot;
          }
          emitTodoUpdate();
          break;
      }
    } catch (err) {
      log.warn({ err }, 'parse error');
    }
  }
});

let _trackedTypFile: string | null = null;

export function trackTypFile(filePath: string): void {
  if (filePath.endsWith('.typ')) {
    _trackedTypFile = filePath;
  }
}

async function collectTypstDiagnostics(workspaceRoot: string): Promise<string> {
  try {
    const lsp = await getTypstLspClient(workspaceRoot);
    if (!lsp.isInitialized) return '';

    const fs_ = await import('fs');
    const path_ = await import('path');

    const filesToCheck: string[] = [];

    // 1. Last tracked .typ file (from write_file/edit_file)
    if (_trackedTypFile && fs_.existsSync(_trackedTypFile) && _trackedTypFile.endsWith('.typ')) {
      filesToCheck.push(_trackedTypFile);
    }

    const parts: string[] = [];
    for (const f of filesToCheck) {
      const uri = `file://${f.replace(/\\/g, '/')}`;
      const content = fs_.readFileSync(f, 'utf-8');
      const diags = await lsp.requestDiagnostics(uri, content, 5000);
      if (diags.length > 0) {
        const rel = path_.relative(workspaceRoot, f);
        const issues = diags.map(d =>
          `  line ${d.range.start.line + 1}:${d.range.start.character + 1} [${d.severity === 1 ? 'error' : d.severity === 2 ? 'warn' : 'info'}] ${d.message}`
        ).join('\n');
        parts.push(`### ${rel} (${diags.length} issues)\n${issues}`);
      }
    }

    if (parts.length > 0) {
      return `\n\n## Current Typst Lint Issues\n\nThe following issues were detected in the Typst file you are working on. Fix these before proceeding:\n\n${parts.join('\n\n')}\n\nUse \`typst_lint\` to recheck.`;
    }
    return '';
  } catch {
    return '';
  }
}

async function handleChatWithEmit(text: string, context: string | null | undefined, persona: { name: string; prompt: string } | undefined, apiKey: string | undefined, systemSummary: string | undefined, localEmit: (type: string, data: any) => void, signal: AbortSignal, sessionId?: string, brainOsSession?: string, skillContent?: string, model?: string, baseUrl?: string, toolPermissions?: ToolPermissionConfig, mcpServers?: McpServerConfig[], sandboxEnabled?: boolean): Promise<void> {
  const phaseT0 = Date.now();
  if (depsInitPromise) await depsInitPromise;
  if (!deps) {
    const brainOptions: any = { workspaceRoot: (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd() };
    if (apiKey) brainOptions.apiKey = apiKey;
    if (toolPermissions) brainOptions.toolPermissions = toolPermissions;
    if (sandboxEnabled) brainOptions.sandboxEnabled = sandboxEnabled;
    deps = await composeRoot(brainOptions);
    await initApprovalBus(deps.brain);
    initAgentFactory(deps.brain, {
      defaultTools: deps.tools,
      defaultHooks: [deps.toolPermissionHook, deps.afterToolHook],
    });
    getTypstLspClient(brainOptions.workspaceRoot).catch(() => { });
    log.trace({ phase: 'deps-init', elapsedMs: Date.now() - phaseT0 }, '[PHASE] deps initialized');
  }

  const personaPrompt = persona && typeof persona.prompt === 'string' && persona.prompt.trim()
    ? persona.prompt.trim()
    : FALLBACK_PERSONA;
  const methodologyPrompt = buildMethodologyPrompt('');
  const basePrompt = persona && persona.prompt
    ? `${methodologyPrompt}\n\n---\n\n${personaPrompt}`
    : `${personaPrompt}\n\n${methodologyPrompt}`;
  let systemPrompt = systemSummary
    ? `${basePrompt}\n\n## Conversation History Summary\n\n${systemSummary}`
    : basePrompt;

  // Inject Typst LSP diagnostics for all .typ files in workspace
  const wsRoot = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
  const typstDiags = await collectTypstDiagnostics(wsRoot);
  if (typstDiags) {
    systemPrompt += typstDiags;
  }

  let effectiveMcp = mcpServers;
  if (!effectiveMcp || effectiveMcp.length === 0) {
    effectiveMcp = getAgentFactory().getDefaultMcpServers();
  }

  function emitMcpStatus(servers: Array<{ name: string; type: string; connected: boolean }>) {
    localEmit('mcp-status', { servers });
  }

  function ezbosType(mcpType: string): string {
    return mcpType === 'stdio' ? 'process' : mcpType;
  }
  const mcpStatusMap = new Map<string, boolean>();
  for (const s of effectiveMcp || []) {
    const comm = s.type === 'http' ? s.url : s.command;
    mcpStatusMap.set(`${s.name}::${ezbosType(s.type)}::${comm}`, false);
  }
  function mcpKey(namespace: string, type: string, comm: string): string {
    return `${namespace}::${type}::${comm}`;
  }
  // Debounced MCP status emit — batches rapid connection events into one emit
  // Prevents flooding stdout + panel postMessage during agent.start()
  let mcpDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleMcpStatus(): void {
    if (mcpDebounceTimer) return;
    mcpDebounceTimer = setTimeout(() => {
      mcpDebounceTimer = null;
      const servers = (effectiveMcp as McpServerConfig[]).map(s => {
        const c = s.type === 'http' ? s.url : s.command;
        return {
          name: s.name,
          type: s.type,
          connected: mcpStatusMap.get(mcpKey(s.name, ezbosType(s.type), c ?? '')) ?? false,
        };
      });
      emitMcpStatus(servers);
    }, 100);
  }
  function cancelMcpDebounce(): void {
    if (mcpDebounceTimer) {
      clearTimeout(mcpDebounceTimer);
      mcpDebounceTimer = null;
    }
  }

  // Reuse agent across messages in same session (avoids ~4s MCP reconnect)
  const sessionKey = sessionId || '_default';
  const existingAgent = activeAgents.get(sessionKey);
  let started: any;
  let isNew = false;
  if (existingAgent && existingAgent.started) {
    started = existingAgent.started;
    // Don't re-emit MCP/LSP status — unchanged since last message
  } else {
    isNew = true;
    // Emit initial MCP status (all disconnected)
    emitMcpStatus(effectiveMcp.map(s => ({ name: s.name, type: s.type, connected: false })));

    const f = getAgentFactory();
    const agent = f.create({
      name: 'trinno-chat',
      systemPrompt,
      ...(model ? { model } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      mcpServers: effectiveMcp,
      onMcpStatus: (namespace, type, comm, status) => {
        mcpStatusMap.set(mcpKey(namespace, type, comm), status === 'connected');
        scheduleMcpStatus();
      },
    });

    started = await agent.start();
    log.trace({ phase: 'agent-start', elapsedMs: Date.now() - phaseT0, isNew: true }, '[PHASE] agent started');
    activeAgents.set(sessionKey, { started, agent });

    // Final status after all connections resolved
    cancelMcpDebounce();
    const finalServers = effectiveMcp.map(s => {
      const c = s.type === 'http' ? s.url : s.command;
      return {
        name: s.name,
        type: s.type,
        connected: mcpStatusMap.get(mcpKey(s.name, ezbosType(s.type), c ?? '')) ?? false,
      };
    });
    emitMcpStatus(finalServers);

    // Emit LSP status (only on new agent — persistent across messages)
    let lspStatus = 'disconnected';
    try {
      const lsp = await getTypstLspClient(wsRoot);
      lspStatus = lsp.isInitialized ? 'connected' : 'starting';
    } catch { /* LSP not available */ }
    localEmit('lsp-status', { name: 'tinymist', status: lspStatus, trackedFile: _trackedTypFile || null });
  }

  let userMessage = text;
  if (skillContent) {
    userMessage = `<trinno_skill>\n${skillContent}\n</trinno_skill>\n\n<user_input>\n${text}\n</user_input>`;

    const wr = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
    const existingTodos = readExistingTodos(wr);
    if (existingTodos && existingTodos.length > 0) {
      const todoSummary = existingTodos
        .map(t => `- [${t.status}] ${t.content} (${t.priority})`)
        .join('\n');
      userMessage = userMessage + `\n\n<system_context>\nExisting todos from disk (resume from first incomplete):\n${todoSummary}\n</system_context>`;
    }
  }

  currentAgent = started;
  currentSessionIdForCancel = sessionId || null;

  try {
    const chatStartTime = Date.now();
    log.trace({ phase: 'stream-start', elapsedMs: Date.now() - phaseT0, isNew }, '[PHASE] starting LLM stream');
    let firstTokenLogged = false;
    await new Promise<void>((resolve, reject) => {
      // Resolve the promise immediately when the abort signal fires (e.g. user
      // presses ESC or clicks Cancel).  The stream callback can't be relied
      // on to fire when the LLM is stalled — without this listener the
      // drainMsgQueue blocks forever and /compact / new messages hang.
      if (signal) {
        signal.addEventListener('abort', () => {
          started.stop().catch(() => { });
          resolve();
        }, { once: true });
      }

      started.stream(userMessage, withMockInjector((token: any) => {
        if (signal.aborted) {
          started.stop().catch(() => { });
          resolve();
          return;
        }

        if (!firstTokenLogged) {
          firstTokenLogged = true;
          log.trace({
            phase: 'first-token',
            elapsedMs: Date.now() - phaseT0,
            streamLatencyMs: Date.now() - chatStartTime,
            tokenType: token.type,
            isNew,
          }, '[PHASE] first token received');
        }

        switch (token.type) {
          case 'ReasoningContent':
            localEmit('token', { tokenType: 'ReasoningContent', text: token.text });
            break;
          case 'Text':
            localEmit('token', { tokenType: 'Text', text: token.text });
            break;
          case 'ToolCall':
            if (token.id && token.name) toolCallNames.set(token.id, token.name);
            if (token.name === 'write_file' && token.args?.filePath && String(token.args.filePath).endsWith('.typ')) {
              trackTypFile(String(token.args.filePath));
            } else if (token.name === 'edit_file' && token.args?.filePath && String(token.args.filePath).endsWith('.typ')) {
              trackTypFile(String(token.args.filePath));
            }
            if (shouldEmitToolCall(token.name)) {
              localEmit('token', { tokenType: 'ToolCall', text: token.name, toolId: token.id, ...(token.args ? { args: token.args } : {}) });
            }
            break;
          case 'ToolResult':
            if (toolCallNames.get(token.id ?? '') === 'todowrite') {
              emitTodoUpdate();
            }
            if (shouldEmitToolResult(token.id, token.name)) {
              localEmit('token', {
                tokenType: 'ToolResult',
                text: token.result || token.text || '',
                toolId: token.id,
                status: 'completed'
              });
            }
            break;
          case 'Usage':
            log.trace({ sessionId, rawToken: token }, '[USAGE-RAW] ezbos Usage token received');
            localEmit('token', {
              tokenType: 'Usage',
              promptTokens: token.prompt_tokens,
              completionTokens: token.completion_tokens,
              totalTokens: token.total_tokens,
              promptTokensDetails: token.prompt_tokens_details,
            });
            break;
          case 'Stop':
          case 'Done': {
            const metrics2 = started.metrics;
            const cumInput = metrics2?.totalInputTokens ?? 0;
            const cumOutput = metrics2?.totalOutputTokens ?? 0;
            const key = sessionId ?? 'default';
            const prev = prevTokens.get(key) ?? { input: 0, output: 0 };
            const inputTokens = cumInput - prev.input;
            const outputTokens = cumOutput - prev.output;
            prevTokens.set(key, { input: cumInput, output: cumOutput });
            log.trace({ sessionId, metrics: metrics2, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, '[TOKEN] worker: stream done');

            localEmit('done', {
              sessionId,
              brainOsSession: undefined,
              inputTokens,
              outputTokens,
            });
            resolve();
            break;
          }
          case 'Error':
            if (isRateLimited(token.error)) {
              const retryAfter = parseRetryAfter(token.error);
              log.warn({ sessionId, error: token.error, retryAfter }, '[RATE-LIMIT] worker received 429 from LLM');
              localEmit('rate-limited', { retryAfter, error: token.error });
            } else {
              localEmit('error', { error: token.error });
            }
            resolve();
            break;
        }
      }, localEmit, resolve));
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (isRateLimited(errMsg)) {
      const retryAfter = parseRetryAfter(errMsg);
      localEmit('rate-limited', { retryAfter, error: errMsg });
    } else {
      localEmit('error', { error: errMsg });
    }
    // On error, discard the agent so next message creates a fresh one
    activeAgents.delete(sessionKey);
  } finally {
    // Keep currentAgent alive for reuse across messages
    currentSessionIdForCancel = null;
  }
}

async function syncSessionAfterCommand(
  _brain: any,
  existingSession: string,
  commandText: string,
  capturedOutput: string,
): Promise<string | undefined> {
  try {
    const f = getAgentFactory();
    const syncAgent = f.create({
      name: 'session-sync',
      systemPrompt: 'You are Research Master — a context synchronization agent. Acknowledge new slash-command output silently and integrate it as Evidence/Modeling in the 7-phase pipeline without re-explaining.',
    });
    const started = await syncAgent.start();
    try {
      started.importSession(existingSession);
    } catch {
      return undefined;
    }
    const syncMsg =
      `<system_context>\n` +
      `The following command was executed and its output was displayed to the user:\n\n` +
      `<command>${commandText}</command>\n\n` +
      `<output>\n${capturedOutput}\n</output>\n` +
      `\nAcknowledge this silently.</system_context>`;
    const result = await new Promise<string | undefined>((resolve) => {
      started.stream(syncMsg, (token: any) => {
        if (token.type === 'Done') {
          let session: string | undefined;
          try { session = started.exportSession(); } catch { }
          resolve(session);
        } else if (token.type === 'Error') {
          resolve(undefined);
        }
      });
    });
    started.stop().catch(() => { });
    return result;
  } catch {
    return undefined;
  }
}

process.on('SIGTERM', () => {
  cancelAllPendingApprovals();
  closeTypstLspClient().catch(() => { });
  brain?.stop().catch(() => { });
  deps?.brain.stop().catch(() => { });
  process.exit(0);
});

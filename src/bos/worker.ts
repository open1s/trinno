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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let abortController: AbortController | null = null;
let deps: Awaited<ReturnType<typeof composeRoot>> | null = null;
let brain: any = null;
let currentJobId = 0;
let currentAgent: any = null;
let currentSessionIdForCancel: string | null = null;
const FALLBACK_PERSONA = 'You are the Trinno Research Assistant — a domain expert in technical innovation, engineering design, and systematic research using TRIZ, PRISMA, SWOT, PEST, and 5W1H. Always respond in character as a senior research collaborator, even for casual greetings. Briefly introduce yourself and your capabilities when greeted, then ask what problem the user is working on.';

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
      try { fs.writeSync(2, `[bos-worker] emit queue saturated, dropped ${droppedEmits} event(s) (type=${type})\n`); } catch { }
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

  if (!deps) {
    deps = await composeRoot({ workspaceRoot: (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd() });
    // Init factory with tools so the chat agent path also benefits (fixes race condition)
    await initApprovalBus(deps.brain);
    initAgentFactory(deps.brain, {
      defaultTools: deps.tools,
      defaultHooks: [deps.toolPermissionHook, deps.afterToolHook],
    });
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
  console.error('[bos-worker] handleChat START, sessionId:', sessionId, 'brainOsSession:', brainOsSession ? 'present' : 'absent');
  abortController = new AbortController();
  const signal = abortController.signal;

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

  let effectiveMcp = mcpServers;
  if (!effectiveMcp || effectiveMcp.length === 0) {
    effectiveMcp = getAgentFactory().getDefaultMcpServers();
  }

  emit('mcp-status', {
    servers: (effectiveMcp || []).map((s: any) => ({ name: s.name, type: s.type, connected: true })),
  });

  console.info('[bos-worker] Creating fresh agent (sessionId:', sessionId, ')');
  const f = getAgentFactory();
  const agent = f.create({
    name: 'trinno-chat',
    systemPrompt,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    mcpServers: effectiveMcp,
  });

  console.error('[bos-worker] about to call agent.start()');
  const started = await agent.start();
  console.error('[bos-worker] agent.start() done');

  if (sessionId) {
    // Check if the factory has a more recent session for this sessionId
    const factorySession = getAgentFactory().getSessionContext(sessionId);
    const sessionToImport = factorySession?.brainOsSession || brainOsSession;
    console.error('[bos-worker] sessionToImport:', sessionToImport ? 'present (len=' + sessionToImport.length + ')' : 'absent');
    if (sessionToImport) {
      try {
        started.importSession(sessionToImport);
        console.error('[bos-worker] importSession done');
      } catch (e) {
        console.error('[bos-worker] importSession ERROR:', e);
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

  currentAgent = started;
  currentSessionIdForCancel = sessionId || null;

  try {
    console.error('[bos-worker] about to call started.stream(), userMessage length:', userMessage.length);
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
        console.error('[bos-worker] stream heartbeat timeout — no real content in 45s, aborting');
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
              responseCharCount += (token.name?.length ?? 0) + 20; // rough estimate
            }
            emit('token', { tokenType: 'ToolCall', text: token.name, toolId: token.id, ...(token.args ? { args: token.args } : {}) });
            if (emitQueue.length > EMIT_QUEUE_HIGH) drainEmitQueueSync();
            break;
          case 'ToolResult':
            if (token.result || token.text) {
              hasRealContent = true;
              resetHeartbeatTimer();
              const resultStr = (token.result || token.text || '');
              responseCharCount += resultStr.length;
            }
            emit('token', {
              tokenType: 'ToolResult',
              text: token.result || token.text || '',
              toolId: token.id,
              status: 'completed'
            });
            if (emitQueue.length > EMIT_QUEUE_HIGH) drainEmitQueueSync();
            break;
          case 'Heartbeat':
            resetHeartbeatTimer();
            break;
          case 'Stop':
          case 'Done': {
            clearHeartbeatTimer();
            streamDone = true;
            if (!hasRealContent) {
              console.error('[bos-worker]', token.type, 'with no real content — treating as rate-limit');
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
            const outputTokens = metrics?.totalOutputTokens ?? 0;
            const inputTokens = metrics?.totalInputTokens ?? 0;
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

function handleCancel(): void {
  abortController?.abort();
  cancelAllPendingApprovals();
  if (currentAgent) {
    currentAgent.stop().catch(() => { });
    currentSessionIdForCancel = null;
  }
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

function loadSoulMd(): string {
  let soul = '';
  try {
    const wsRoot = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
    const projectSoul = path.join(wsRoot, 'SOUL.md');
    if (fs.existsSync(projectSoul)) {
      soul += fs.readFileSync(projectSoul, 'utf-8').trim();
    }
  } catch { }
  
  if (soul) return soul;

  try {
    const homeSoul = path.join(os.homedir(), '.bos', 'skills', 'SOUL.md');
    if (fs.existsSync(homeSoul)) {
      const homeContent = fs.readFileSync(homeSoul, 'utf-8').trim();
      if (soul) soul += '\n\n---\n\n';
      soul += homeContent;
    }
  } catch { }
  return soul;
}

function buildMethodologyPrompt(slashCommandsList: string, isIncrementalWrite?: boolean): string {
  const soul = loadSoulMd();
  const soulSection = soul ? `\n\n## SOUL (Core Guidelines)\n\n${soul}\n` : '';
  return [
    '## Phased Research Philosophy',
    '- Research is incremental. Complete one phase before moving to the next.',
    '- 01_Discover → 02_TRL → 03_Analyze → 04_Synthesize → 05_Deliver → 07_Patent.',
    '- Each phase writes its output to the corresponding phase directory. Do not skip phases.',
    '- If context grows large, suggest compaction (/compact) instead of summarizing yourself.',
    '',
    '## Context Budget',
    '- Keep responses focused. Aim for < 300 tokens per text turn.',
    '- Use tool results to ground analysis; do not repeat full tool output in text.',
    '- After tool calls: 1-2 sentence explanation + next step suggestion. Never end turn after a tool result. Max 2 retries on a failing tool.',
    '- If analysis exceeds 5 tool calls, pause and summarize before continuing.',
    '',
    '## Routing',
    '- Unknown scope → 5W1H',
    '- Clinical / biomedical Q → PICO → PRISMA',
    '- Technical barrier / invention → TRIZ',
    '- Evidence synthesis → PRISMA',
    '- Strategic / competitive → SWOT (+ PEST)',
    '- New market / tech landscape → PEST (+ SWOT)',
    '',
    '## PICO',
    'PICO/PICOS: P-Population, I-Intervention, C-Comparison, O-Outcome, S-Study design. Template: "In [P], does [I] vs [C] affect [O]?" PRISMA consumes PICO upstream.',
    '',
    '## Phase Dirs',
    '- 01_Discover — cached searches (patents.json, papers.json)',
    '- 02_TRL — s_curve.json, trl_assessment.json',
    '- 03_Analyze — contradictions.json, su_field_analysis.json, bottlenecks.json',
    '- 04_Synthesize — solutions.json, principles_applied.json, trends.json, roadmap.json',
    '- 05_Deliver — paper, report drafts',
    '- 06_References — downloaded papers + library.json',
    '- 07_Patent — patent drafts',
    'Check phase dirs before searching; write results back after analysis.',
    '',
    '## Multilingual + PubScholar',
    '- For technical topics: run EN + ZH queries in parallel, dedupe by DOI/arXivID. CN journals: 自动化学报, 控制与决策, 机器人, etc.',
    '- PubScholar (pubscholar.cn) API is gated, but file CDN at `file.scholarin.cn/preview2?file=editor_cj_{hash}.pdf` is open. Pass the article URL to papers_download.',
    '',
    ...(!isIncrementalWrite ? [
      '## Writing Papers/Patents (use /patent or /paper, not ad-hoc write_file)',
      '- AMBIGUOUS ("write a paper" without colon+title) → do NOT invent topic, do NOT call write_file. Stop.',
      '- Never output paper plan + write_file together (hook abort).',
    ] : []),
    '',
    '## File refs (@<path>)',
    'ALWAYS read_file first. Never invent contents. edit_file for refine/improve/fix; write_file only for full rewrites.',
    '',
    '## Tools',
    'TRIZ: triz_search, triz_principles, triz_parameters, triz_contradiction, triz_insight, triz_su_field, triz_ideality, triz_s_curve.',
    'Papers: search, papers_download, papers_list_downloaded.',
    'FS: read_file, write_file, edit_file, list_dir, grep_search, glob_files, ast_grep, ast_edit, apply_patch, bash, exec_tool. bash needs user approval. read/write/edit_file/list_dir are workspace-scoped.',
    'Full schemas come via function-calling API.',
    '',
    '## Slash Commands',
    slashCommandsList,
    '',
    '## Tool-Call Format',
    'Single JSON object. No XML. No commentary. "not support such call" → don\'t retry, reformulate in plain text.',
  ].join('\n') + soulSection;
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
  console.error('[bos-worker] handleCompact START, message count:', messages.length);

  if (!deps) {
    const brainOptions: any = { workspaceRoot: (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd() };
    if (apiKey) brainOptions.apiKey = apiKey;
    deps = await composeRoot(brainOptions);
    await initApprovalBus(deps.brain);
    initAgentFactory(deps.brain, {
      defaultTools: deps.tools,
      defaultHooks: [deps.toolPermissionHook, deps.afterToolHook],
    });
  }

  const conversationText = messages.map(m => {
    const reasoning = m.reasoning ? `\n[Reasoning: ${m.reasoning.slice(0, 200)}]` : '';
    return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}${reasoning}`;
  }).join('\n\n');

  const summaryPrompt = `You are given a structured conversation transcript that may include:
- User messages
- Assistant responses
- Tool calls (functions, APIs, etc.)
- Tool call results (outputs, errors, data)

Your task is to produce a structure, concise, high-signal summary that enables someone to quickly understand and continue the interaction.

Focus on:
- User intent and key inputs
- Important assistant actions (especially tool usage)
- Tool calls and their results (what was called, why, and what happened)
- Key outcomes, decisions, or findings
- Important context, constraints, or assumptions
- Errors, failures, or retries (if any)
- Remaining open questions or next steps

Requirements:
- Be specific and avoid generic phrasing, compactioin ratio > 60%
- Preserve technical meaning and causal relationships
- Compress aggressively: remove repetition, keep only what matters
- If tool usage is irrelevant, omit it
- Output in structured markdown format

Conversation:
${conversationText}
`;

  const basePrompt = persona?.prompt || `You are a helpful research assistant.`;
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
    await new Promise<void>((resolve, reject) => {
      started.stream(summaryPrompt, (token: any) => {
        switch (token.type) {
          case 'ReasoningContent':
            emit('token', { tokenType: 'ReasoningContent', text: token.text });
            break;
          case 'Text':
            emit('token', { tokenType: 'Text', text: token.text });
            break;
          case 'Done':
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

let stdinBuffer = '';
process.stdin.on('data', async (chunk: Buffer) => {
  stdinBuffer += chunk.toString();
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      switch (msg.type) {
        case 'chat':
          console.error('[bos-worker] recv chat, text length:', msg.text?.length, 'sessionId:', msg.sessionId);
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
            await handleChatWithEmit(
              msg.text,
              msg.context ?? null,
              msg.persona,
              msg.apiKey,
              msg.systemSummary,
              emit,
              abortController?.signal ?? new AbortController().signal,
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
          break;
        case 'cancel':
          handleCancel();
          break;
        case 'tool-approval':
          await sendApprovalResponse(msg.id, msg.approved);
          break;
        case 'compact':
          await handleCompact(msg.messages, msg.systemSummary, msg.persona, msg.apiKey, msg.model, msg.baseUrl);
          break;
        case 'clear-session':
          if (msg.sessionId) {
            getAgentFactory().clearSessionContext(msg.sessionId);
          }
          break;
        case 'compact-result':
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
              started.stop().catch(() => {});
            }
          }
          break;
        case 'slash': {
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
          break;
        }
        case 'paper': {
          const paperWorkflowPrompt = [
            '你是精通TRIZ的论文撰写专家。任务：收集数据 → 撰写 → write_file。',
            '1. 调用TRIZ工具（triz_contradiction, triz_principles, triz_s_curve等）收集研究数据',
            '2. write_file到05_Deliver/paper.md（3000+字中文markdown，结构：摘要→引言→矛盾分析→物场分析→解决方案→S曲线→路线图→TRL→结论→参考文献）',
            '3. 仅输出简短确认，不要重复论文内容',
            '约束：不编造参数编号，不输出"我将为您撰写"之类前言。',
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
          break;
        }
        case 'incremental-write': {
          const isPatent = String(msg.prompt || '').includes('专利');
          const docLabel = isPatent ? '专利文档' : '论文';
          const completeMarker = isPatent ? '<!-- PATENT_COMPLETE -->' : '<!-- PAPER_COMPLETE -->';
          const sectionOrder = isPatent
            ? '技术领域 → 背景技术 → 发明内容 → 附图说明 → 具体实施方式 → 权利要求'
            : '摘要 → 引言 → 技术矛盾分析 → 物场分析 → 解决方案 → S曲线 → 实施路线图 → TRL → 结论 → 参考文献';

          const skillInstructions = `
## 增量撰写（LLM 直接输出文本，系统自动写入文件）

目标文件已预初始化为：
# <title>
<!-- LLM_WRITE_HERE -->

**本轮任务**：输出下一节内容作为普通文本。系统会自动将你的文本写入文件，替换标记。

**约束**：
- 你的文本输出就是下一节内容，系统会自动写入文件
- 禁止调用 edit_file 或 write_file（系统处理文件操作）
- 可以在本轮调用 read_file 看进度，调用 TRIZ 工具收集数据
- 每节 ≤ 150 行 markdown（≈ 500 tokens）

**节顺序**：${sectionOrder}

**写法（单轮内可组合）**：
1. read_file 读文件尾部
2. TRIZ 工具收集数据：triz_search, triz_principles, triz_contradiction, triz_su_field, triz_ideality, triz_s_curve
3. **输出文本**作为下一节 markdown 内容

**完成**：最后一节末尾包含「${docLabel}撰写完成」或「${completeMarker}」，系统会自动结束。
`;

          const userPersonaPrompt = msg.persona && typeof msg.persona.prompt === 'string' && msg.persona.prompt.trim()
            ? msg.persona.prompt.trim()
            : null;
          const incrementalPersona = {
            name: (msg.persona && typeof msg.persona.name === 'string' && msg.persona.name.trim())
              ? msg.persona.name.trim()
              : (isPatent ? 'trinno-incremental-patent' : 'incremental-paper'),
            prompt: userPersonaPrompt
              ? `${userPersonaPrompt}\n\n---\n\n${skillInstructions}`
              : skillInstructions,
          };
          abortController = new AbortController();
          await handleChatWithEmit(
            msg.prompt,
            null,
            incrementalPersona,
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
            true,
          );
          break;
        }
        case 'mcp-status-request':
          emitMcpStatus();
          break;
      }
    } catch (err) {
      process.stderr.write(`[bos-worker] parse error: ${err}\n`);
    }
  }
});

async function handleChatWithEmit(text: string, context: string | null | undefined, persona: { name: string; prompt: string } | undefined, apiKey: string | undefined, systemSummary: string | undefined, localEmit: (type: string, data: any) => void, signal: AbortSignal, sessionId?: string, brainOsSession?: string, skillContent?: string, model?: string, baseUrl?: string, toolPermissions?: ToolPermissionConfig, mcpServers?: McpServerConfig[], sandboxEnabled?: boolean, isIncrementalWrite?: boolean): Promise<void> {
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
  }

  const personaPrompt = persona && typeof persona.prompt === 'string' && persona.prompt.trim()
    ? persona.prompt.trim()
    : FALLBACK_PERSONA;
  const methodologyPrompt = buildMethodologyPrompt('', isIncrementalWrite);
  const basePrompt = persona && persona.prompt
    ? `${methodologyPrompt}\n\n---\n\n${personaPrompt}`
    : `${personaPrompt}\n\n${methodologyPrompt}`;
  let systemPrompt = systemSummary
    ? `${basePrompt}\n\n## Conversation History Summary\n\n${systemSummary}`
    : basePrompt;

  let effectiveMcp = mcpServers;
  if (!effectiveMcp || effectiveMcp.length === 0) {
    effectiveMcp = getAgentFactory().getDefaultMcpServers();
  }

  localEmit('mcp-status', {
    servers: (effectiveMcp || []).map((s: any) => ({ name: s.name, type: s.type, connected: true })),
  });

  const f = getAgentFactory();
  const agent = f.create({
    name: 'trinno-chat',
    systemPrompt,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    mcpServers: effectiveMcp,
  });

  const started = await agent.start();

  if (sessionId) {
    // Check if the factory has a more recent session for this sessionId
    const factorySession = getAgentFactory().getSessionContext(sessionId);
    const sessionToImport = factorySession?.brainOsSession || brainOsSession;
    if (sessionToImport) {
      try {
        started.importSession(sessionToImport);
      } catch {
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

  currentAgent = started;
  currentSessionIdForCancel = sessionId || null;

  try {
    await new Promise<void>((resolve, reject) => {
      started.stream(userMessage, (token: any) => {
        if (signal.aborted) {
          started.stop().catch(() => { });
          resolve();
          return;
        }

        switch (token.type) {
          case 'ReasoningContent':
            localEmit('token', { tokenType: 'ReasoningContent', text: token.text });
            break;
          case 'Text':
            localEmit('token', { tokenType: 'Text', text: token.text });
            break;
          case 'ToolCall':
            localEmit('token', { tokenType: 'ToolCall', text: token.name, toolId: token.id, ...(token.args ? { args: token.args } : {}) });
            break;
          case 'ToolResult':
            localEmit('token', {
              tokenType: 'ToolResult',
              text: token.result || token.text || '',
              toolId: token.id,
              status: 'completed'
            });
            break;
          case 'Usage':
            localEmit('token', {
              tokenType: 'Usage',
              promptTokens: token.promptTokens,
              completionTokens: token.completionTokens,
              totalTokens: token.totalTokens,
              promptTokensDetails: token.promptTokensDetails,
            });
            break;
          case 'Stop':
          case 'Done': {
            let exportedSession2: string | undefined;
            if (sessionId) {
              try {
                exportedSession2 = started.exportSession();
                if (exportedSession2) {
                  const prevCtx2 = getAgentFactory().getSessionContext(sessionId);
                  getAgentFactory().setSessionContext(sessionId, {
                    brainOsSession: exportedSession2,
                    lastUpdated: Date.now(),
                  });
                }
              } catch {
                // ignore export errors
              }
            }
            const metrics2 = started.metrics;
            localEmit('done', {
              sessionId,
              brainOsSession: exportedSession2,
              inputTokens: metrics2?.totalInputTokens ?? 0,
              outputTokens: metrics2?.totalOutputTokens ?? 0,
            });
            resolve();
            break;
          }
          case 'Error':
            if (isRateLimited(token.error)) {
              const retryAfter = parseRetryAfter(token.error);
              localEmit('rate-limited', { retryAfter, error: token.error });
            } else {
              localEmit('error', { error: token.error });
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
      localEmit('rate-limited', { retryAfter, error: errMsg });
    } else {
      localEmit('error', { error: errMsg });
    }
  } finally {
    currentAgent = null;
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
      systemPrompt: 'You are a context synchronization agent.',
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
  brain?.stop().catch(() => { });
  deps?.brain.stop().catch(() => { });
  process.exit(0);
});

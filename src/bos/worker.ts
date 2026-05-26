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
  researchCommand,
  aiResearchCommand,
  contradictionCommand,
  searchCommand,
  sCurveCommand,
  idealityCommand,
  principlesCommand,
  suFieldCommand,
  compactCommand,
} from './slash-commands/index.js';
import { ToolPermissionConfig, McpServerConfig } from './infrastructure/config/toolPermissions.js';
import { initApprovalBus, sendApprovalResponse, setApprovalEmitter, cancelAllPendingApprovals } from './infrastructure/config/toolPermissionHook.js';
import * as jsbos from '@open1s/jsbos';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let abortController: AbortController | null = null;
let deps: Awaited<ReturnType<typeof composeRoot>> | null = null;
let brain: any = null;
let currentJobId = 0;
let currentAgent: any = null;
let currentSessionIdForCancel: string | null = null;
const slashRegistry = createSlashCommandRegistry();

slashRegistry.register(researchCommand);
slashRegistry.register(aiResearchCommand);
slashRegistry.register(contradictionCommand);
slashRegistry.register(searchCommand);
slashRegistry.register(sCurveCommand);
slashRegistry.register(idealityCommand);
slashRegistry.register(principlesCommand);
slashRegistry.register(suFieldCommand);
slashRegistry.register(compactCommand);

let activeSkillContent: string | null = null;
let activeSkillName: string | null = null;
let pendingSkillArgs: string | null = null;
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
      const description = descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, '') : `Apply ${entry.name} skill`;
      const cmd: SlashCommand = {
        name: entry.name,
        description,
        usage: `/${entry.name}`,
        async execute(args, _deps, emit, _signal) {
          activeSkillContent = content;
          activeSkillName = entry.name;
          if (args.trim()) {
            pendingSkillArgs = args;
          } else {
            emit('token', {
              tokenType: 'Text',
              text: `Skill \`${entry.name}\` activated. Ready for your input.`,
            });
            emit('done', {});
          }
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

process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

function emit(type: string, data: any): void {
  if (abortController?.signal.aborted && type !== 'done' && type !== 'error') return;
  process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
}

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
    statusPub.text(JSON.stringify({ type, ...data })).catch(() => {});
    emit(type, data);
  };

  commandSub.runJson(async (msg: any) => {
    if (msg.type === 'cancel') {
      localAbort.abort();
      await commandSub.stop();
    }
  }).catch(() => {});

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

async function handleSlashCommand(text: string, signal: AbortSignal, localEmit: (type: string, data: any) => void): Promise<boolean> {
  const match = slashRegistry.match(text);
  if (!match) return false;

  if (!deps) {
    deps = await composeRoot({ workspaceRoot: process.cwd() });
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

async function handleChat(text: string, context?: string | null, persona?: { name: string; prompt: string }, apiKey?: string, systemSummary?: string, sessionId?: string, brainOsSession?: string, skillContent?: string, model?: string, baseUrl?: string, toolPermissions?: ToolPermissionConfig, mcpServers?: McpServerConfig[]): Promise<void> {
  abortController = new AbortController();
  const signal = abortController.signal;

  if (!deps) {
    const brainOptions: any = { workspaceRoot: process.cwd() };
    if (apiKey) brainOptions.apiKey = apiKey;
    if (toolPermissions) brainOptions.toolPermissions = toolPermissions;
    deps = await composeRoot(brainOptions);
    await initApprovalBus(deps.brain);
    initAgentFactory(deps.brain, {
      defaultTools: deps.tools,
      defaultHooks: [deps.toolPermissionHook, deps.afterToolHook],
    });
  }

  const basePrompt = persona?.prompt || `You are a TRIZ research expert integrated into a Jupyter notebook environment. You help researchers analyze technical problems using TRIZ methodology, search for prior art (patents, papers, technical solutions), and generate academic writing. You have access to the notebook context and can insert new cells autonomously. Be concise, evidence-based, and focus on actionable insights.

Available slash commands:
${slashRegistry.list().map(c => `- /${c.name}: ${c.description}`).join('\n')}

Type /help to see all commands.`;

  let systemPrompt = systemSummary
    ? `${basePrompt}\n\n## Conversation History Summary\n\n${systemSummary}`
    : basePrompt;

  let effectiveMcp = mcpServers;
  if (!effectiveMcp || effectiveMcp.length === 0) {
    try {
      const loader = new jsbos.ConfigLoader();
      loader.discover();
      const configJson = loader.loadSync();
      const config = JSON.parse(configJson);
      effectiveMcp = config?.mcp?.servers || [];
    } catch (e) {
      console.error('[bos-worker] Failed to load MCP config:', e);
    }
  }

  emit('mcp-status', {
    servers: (effectiveMcp || []).map((s: any) => ({ name: s.name, type: s.type, connected: true })),
  });

  console.info('[bos-worker] Creating fresh agent (sessionId:', sessionId, ')');
  const f = getAgentFactory();
  const agent = f.create({
    name: 'trinno-chat',
    systemPrompt,
    model,
    baseUrl,
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
          started.stop().catch(() => {});
          resolve();
          return;
        }

        switch (token.type) {
          case 'ReasoningContent':
            emit('token', { tokenType: 'ReasoningContent', text: token.text });
            break;
          case 'Text':
            emit('token', { tokenType: 'Text', text: token.text });
            break;
          case 'ToolCall':
            emit('token', { tokenType: 'ToolCall', text: token.name, toolId: token.id });
            break;
          case 'ToolResult':
            emit('token', { 
              tokenType: 'ToolResult', 
              text: token.result || token.text || '', 
              toolId: token.id,
              status: 'completed' 
            });
            break;
          case 'Done': {
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
            if (isRateLimited(token.error)) {
              const retryAfter = parseRetryAfter(token.error);
              emit('rate-limited', { retryAfter, error: token.error });
            } else {
              emit('error', { error: token.error });
            }
            started.stop().catch(() => {});
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

function parseRetryAfter(errorMsg: string): number {
  const match = errorMsg.match(/retry.?after\s+(\d+)\s*s/i) || errorMsg.match(/try again in (\d+)\s*s/i) || errorMsg.match(/in (\d+)\s*seconds/i);
  if (match && match[1]) {
    const seconds = parseInt(match[1], 10);
    if (seconds > 0 && seconds <= 300) return seconds;
  }
  return 15;
}

function handleCancel(): void {
  abortController?.abort();
  cancelAllPendingApprovals();
  if (currentAgent) {
    currentAgent.stop().catch(() => {});
    currentSessionIdForCancel = null;
  }
}

function emitMcpStatus(): void {
  try {
    const loader = new jsbos.ConfigLoader();
    loader.discover();
    const configJson = loader.loadSync();
    const config = JSON.parse(configJson);
    const servers = (config?.mcp?.servers || []).map((s: any) => ({ name: s.name, type: s.type, connected: true }));
    emit('mcp-status', { servers });
  } catch (e) {
    emit('mcp-status', { servers: [] });
  }
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
    const brainOptions: any = { workspaceRoot: process.cwd() };
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
    model,
    baseUrl,
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
            started.stop().catch(() => {});
            resolve();
            break;
        }
      });
    });
  } catch (err) {
    emit('error', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    started.stop().catch(() => {});
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
          currentJobId++;
          const jobId = String(currentJobId);

          if (msg.text.trim() === '/help' || msg.text.trim() === '/commands') {
            handleHelp();
          } else if (msg.usePubSub) {
            await runJobWithPubSub(jobId, async (signal, localEmit) => {
              const skillContent = msg.skillContent || undefined;
              if (await handleSlashCommand(msg.text, signal, localEmit)) {
                if (pendingSkillArgs) {
                  const skillArgs = pendingSkillArgs;
                  const sc = activeSkillContent || skillContent;
                  pendingSkillArgs = null;
                  activeSkillContent = null;
                  activeSkillName = null;
                  await handleChatWithEmit(skillArgs, msg.context, msg.persona, msg.apiKey, msg.systemSummary, localEmit, signal, msg.sessionId, msg.brainOsSession, sc, msg.model, msg.baseUrl, msg.toolPermissions, msg.mcp?.servers);
                }
                if (pendingSlashOutput && msg.sessionId && deps?.brain) {
                  if (msg.brainOsSession) {
                    const newSession = await syncSessionAfterCommand(
                      deps.brain,
                      msg.brainOsSession,
                      msg.text,
                      pendingSlashOutput,
                    );
                    if (newSession) {
                      getAgentFactory().setSessionContext(msg.sessionId, {
                        brainOsSession: newSession,
                        lastUpdated: Date.now(),
                      });
                      pendingSlashOutput = null;
                    }
                  }
                }
              } else {
                const sc = pendingSlashOutput && !skillContent ? pendingSlashOutput : skillContent;
                pendingSlashOutput = null;
                await handleChatWithEmit(msg.text, msg.context, msg.persona, msg.apiKey, msg.systemSummary, localEmit, signal, msg.sessionId, msg.brainOsSession, sc, msg.model, msg.baseUrl, msg.toolPermissions, msg.mcp?.servers);
              }
            });
          } else {
            const skillContent = msg.skillContent || undefined;
            if (await handleSlashCommand(msg.text, abortController?.signal ?? new AbortController().signal, emit)) {
              if (pendingSkillArgs) {
                const skillArgs = pendingSkillArgs;
                const sc = activeSkillContent || skillContent;
                pendingSkillArgs = null;
                activeSkillContent = null;
                activeSkillName = null;
                await handleChat(skillArgs, msg.context, msg.persona, msg.apiKey, msg.systemSummary, msg.sessionId, msg.brainOsSession, sc, msg.model, msg.baseUrl, msg.toolPermissions, msg.mcp?.servers);
              }
              if (pendingSlashOutput && msg.sessionId && deps?.brain) {
                if (msg.brainOsSession) {
                  const newSession = await syncSessionAfterCommand(
                    deps.brain,
                    msg.brainOsSession,
                    msg.text,
                    pendingSlashOutput,
                  );
                  if (newSession) {
                    getAgentFactory().setSessionContext(msg.sessionId, {
                      brainOsSession: newSession,
                      lastUpdated: Date.now(),
                    });
                    pendingSlashOutput = null;
                  }
                }
              }
            } else {
              const sc = pendingSlashOutput && !skillContent ? pendingSlashOutput : skillContent;
              pendingSlashOutput = null;
              await handleChat(msg.text, msg.context, msg.persona, msg.apiKey, msg.systemSummary, msg.sessionId, msg.brainOsSession, sc, msg.model, msg.baseUrl, msg.toolPermissions, msg.mcp?.servers);
            }
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
        case 'mcp-status-request':
          emitMcpStatus();
          break;
      }
    } catch (err) {
      process.stderr.write(`[bos-worker] parse error: ${err}\n`);
    }
  }
});

async function handleChatWithEmit(text: string, context: string | null | undefined, persona: { name: string; prompt: string } | undefined, apiKey: string | undefined, systemSummary: string | undefined, localEmit: (type: string, data: any) => void, signal: AbortSignal, sessionId?: string, brainOsSession?: string, skillContent?: string, model?: string, baseUrl?: string, toolPermissions?: ToolPermissionConfig, mcpServers?: McpServerConfig[]): Promise<void> {
  if (!deps) {
    const brainOptions: any = { workspaceRoot: process.cwd() };
    if (apiKey) brainOptions.apiKey = apiKey;
    if (toolPermissions) brainOptions.toolPermissions = toolPermissions;
    deps = await composeRoot(brainOptions);
    await initApprovalBus(deps.brain);
    initAgentFactory(deps.brain, {
      defaultTools: deps.tools,
      defaultHooks: [deps.toolPermissionHook, deps.afterToolHook],
    });
  }

  const basePrompt = persona?.prompt || `You are a TRIZ research expert.`;
  let systemPrompt = systemSummary
    ? `${basePrompt}\n\n## Conversation History Summary\n\n${systemSummary}`
    : basePrompt;

  let effectiveMcp = mcpServers;
  if (!effectiveMcp || effectiveMcp.length === 0) {
    try {
      const loader = new jsbos.ConfigLoader();
      loader.discover();
      const configJson = loader.loadSync();
      const config = JSON.parse(configJson);
      effectiveMcp = config?.mcp?.servers || [];
    } catch (e) {
      console.error('[bos-worker] Failed to load MCP config:', e);
    }
  }

  localEmit('mcp-status', {
    servers: (effectiveMcp || []).map((s: any) => ({ name: s.name, type: s.type, connected: true })),
  });

  const f = getAgentFactory();
  const agent = f.create({
    name: 'trinno-chat',
    systemPrompt,
    model,
    baseUrl,
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
          started.stop().catch(() => {});
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
            localEmit('token', { tokenType: 'ToolCall', text: token.name, toolId: token.id });
            break;
          case 'ToolResult':
            localEmit('token', { 
              tokenType: 'ToolResult', 
              text: token.result || token.text || '', 
              toolId: token.id,
              status: 'completed' 
            });
            break;
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
            started.stop().catch(() => {});
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
  brainInstance: any,
  existingSession: string,
  commandText: string,
  capturedOutput: string,
): Promise<string | undefined> {
  try {
    const syncAgent = brainInstance.agent('session-sync')
      .with_systemPrompt('You are a context synchronization agent.');
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
          try { session = started.exportSession(); } catch {}
          resolve(session);
        } else if (token.type === 'Error') {
          resolve(undefined);
        }
      });
    });
    started.stop().catch(() => {});
    return result;
  } catch {
    return undefined;
  }
}

process.on('SIGTERM', () => {
  cancelAllPendingApprovals();
  brain?.stop().catch(() => {});
  deps?.brain.stop().catch(() => {});
  process.exit(0);
});

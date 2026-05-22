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
  try {
    await command.execute(args, deps, localEmit, signal);
  } catch (err) {
    if (!signal.aborted) {
      localEmit('error', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return true;
}

async function handleChat(text: string, context?: string | null, persona?: { name: string; prompt: string }, apiKey?: string, systemSummary?: string, sessionId?: string, brainOsSession?: string, skillContent?: string, model?: string, baseUrl?: string, toolPermissions?: ToolPermissionConfig, mcpServers?: McpServerConfig[]): Promise<void> {
  console.error('[bos-worker] handleChat START');
  abortController = new AbortController();
  const signal = abortController.signal;

  if (!deps) {
    const brainOptions: any = { workspaceRoot: process.cwd() };
    if (apiKey) brainOptions.apiKey = apiKey;
    if (toolPermissions) brainOptions.toolPermissions = toolPermissions;
    deps = await composeRoot(brainOptions);
    await initApprovalBus(deps.brain);
  }

  const basePrompt = persona?.prompt || `You are a TRIZ research expert integrated into a Jupyter notebook environment. You help researchers analyze technical problems using TRIZ methodology, search for prior art (patents, papers, technical solutions), and generate academic writing. You have access to the notebook context and can insert new cells autonomously. Be concise, evidence-based, and focus on actionable insights.

Available slash commands:
${slashRegistry.list().map(c => `- /${c.name}: ${c.description}`).join('\n')}

Type /help to see all commands.`;

  let systemPrompt = systemSummary
    ? `${basePrompt}\n\n## Conversation History Summary\n\n${systemSummary}`
    : basePrompt;

  const agentsDir = path.join(os.homedir(), '.agents', 'skills');
  const bosDir = path.join(os.homedir(), '.bos', 'skills');

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

  console.error('[bos-worker] Creating fresh agent (sessionId:', sessionId, ')');
  let agent = deps.brain.agent('trinno-chat')
    .with_systemPrompt(systemPrompt)
    .with_tools(...deps.tools)
    .with_hooks(deps.toolPermissionHook)
    .with_temperature(0.7);

  if (model) agent = agent.with_model(model);
  if (baseUrl) agent = agent.with_baseUrl(baseUrl);

  if (fs.existsSync(agentsDir)) agent = agent.with_skills_dir(agentsDir);
  if (fs.existsSync(bosDir)) agent = agent.with_skills_dir(bosDir);

  if (effectiveMcp) {
    for (const server of effectiveMcp) {
      if (server.type === 'stdio' && server.command) {
        agent = agent.with_mcp_process(server.name, server.command, server.args || []);
      } else if (server.type === 'http' && server.url) {
        agent = agent.with_mcp_http(server.name, server.url);
      }
    }
  }

  const started = await agent.start();

  if (sessionId && brainOsSession) {
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
            emit('token', { tokenType: 'ToolCall', text: token.name });
            break;
          case 'ToolResult':
            emit('token', { tokenType: 'ToolResult', text: token.result || token.text || '' });
            break;
          case 'Done':
            let exportedSession: string | undefined;
            if (sessionId) {
              try {
                exportedSession = started.exportSession();
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
    currentAgent = null;
    currentSessionIdForCancel = null;
  }
}

function handleCancel(): void {
  abortController?.abort();
  cancelAllPendingApprovals();
  if (currentAgent) {
    currentAgent.stop().catch(() => {});
    currentSessionIdForCancel = null;
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

process.stdin.on('data', async (chunk: Buffer) => {
  const lines = chunk.toString().split('\n').filter(line => line.trim());
  for (const line of lines) {
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
              } else {
                await handleChatWithEmit(msg.text, msg.context, msg.persona, msg.apiKey, msg.systemSummary, localEmit, signal, msg.sessionId, msg.brainOsSession, skillContent, msg.model, msg.baseUrl, msg.toolPermissions, msg.mcp?.servers);
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
            } else {
              await handleChat(msg.text, msg.context, msg.persona, msg.apiKey, msg.systemSummary, msg.sessionId, msg.brainOsSession, skillContent, msg.model, msg.baseUrl, msg.toolPermissions, msg.mcp?.servers);
            }
          }
          break;
        case 'cancel':
          handleCancel();
          break;
        case 'tool-approval':
          await sendApprovalResponse(msg.id, msg.approved);
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
  }

  const basePrompt = persona?.prompt || `You are a TRIZ research expert.`;
  let systemPrompt = systemSummary
    ? `${basePrompt}\n\n## Conversation History Summary\n\n${systemSummary}`
    : basePrompt;

  const agentsDir = path.join(os.homedir(), '.agents', 'skills');
  const bosDir = path.join(os.homedir(), '.bos', 'skills');

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

  let agent = deps.brain.agent('trinno-chat')
    .with_systemPrompt(systemPrompt)
    .with_tools(...deps.tools)
    .with_hooks(deps.toolPermissionHook)
    .with_temperature(0.7);

  if (model) agent = agent.with_model(model);
  if (baseUrl) agent = agent.with_baseUrl(baseUrl);

  if (fs.existsSync(agentsDir)) agent = agent.with_skills_dir(agentsDir);
  if (fs.existsSync(bosDir)) agent = agent.with_skills_dir(bosDir);

  if (effectiveMcp) {
    for (const server of effectiveMcp) {
      if (server.type === 'stdio' && server.command) {
        agent = agent.with_mcp_process(server.name, server.command, server.args || []);
      } else if (server.type === 'http' && server.url) {
        agent = agent.with_mcp_http(server.name, server.url);
      }
    }
  }

  const started = await agent.start();

  if (sessionId && brainOsSession) {
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
            localEmit('token', { tokenType: 'ToolCall', text: token.name });
            break;
          case 'ToolResult':
            localEmit('token', { tokenType: 'ToolResult', text: token.result || token.text || '' });
            break;
          case 'Done':
            let exportedSession2: string | undefined;
            if (sessionId) {
              try {
                exportedSession2 = started.exportSession();
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
          case 'Error':
            localEmit('error', { error: token.error });
            started.stop().catch(() => {});
            resolve();
            break;
        }
      });
    });
  } catch (err) {
    localEmit('error', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    currentAgent = null;
    currentSessionIdForCancel = null;
  }
}

process.on('SIGTERM', () => {
  cancelAllPendingApprovals();
  brain?.stop().catch(() => {});
  deps?.brain.stop().catch(() => {});
  process.exit(0);
});

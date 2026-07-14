import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { BrainOS, McpStatusCallback } from '@open1s/ezbos';
import { McpServerConfig } from './config/toolPermissions.js';

function loadMcpFromConfig(): McpServerConfig[] {
  try {
    const { ConfigLoader } = require('@open1s/jsbos');
    const loader = new ConfigLoader();
    loader.discover();
    const configJson = loader.loadSync();
    const config = JSON.parse(configJson);
    return config?.mcp?.servers || [];
  } catch {
    return [];
  }
}

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  temperature?: number;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  timeoutSecs?: number;
  tools?: any[];
  hooks?: any[];
  plugins?: any[];
  mcpServers?: McpServerConfig[];
  skillsDirs?: string[];
  extraTools?: any[];
  sessionId?: string;
  brainOsSession?: string;
  onMcpStatus?: McpStatusCallback;
}
export interface SessionConfig {
  brainOsSession: string;
  lastUpdated: number;
}

const DEFAULT_SKILLS_DIRS = [
  path.join(os.homedir(), '.agents', 'skills'),
  path.join(os.homedir(), '.bos', 'skills'),
];

const DEFAULT_MCP_SERVERS: McpServerConfig[] = [];

const DEFAULT_PLUGINS: any[] = [];

const POOL_MAX_SIZE = 16;

function fnv1aHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

class BuilderLru {
  private map: Map<string, { builder: any; refs: number }> = new Map();

  constructor(private maxSize: number) {}

  keyFor(config: AgentConfig): string {
    const toolSig = (config.tools ?? []).map((t: any) => t?.name ?? String(t)).sort().join('|');
    const hookSig = (config.hooks ?? []).map((h: any) => h?.name ?? String(h)).sort().join('|');
    const mcpSig = ((config.mcpServers ?? []) as McpServerConfig[]).map(s => `${s.name}:${s.type}`).sort().join('|');
    return [
      config.name,
      config.model ?? '-',
      config.baseUrl ?? '-',
      fnv1aHash(config.systemPrompt),
      fnv1aHash(toolSig),
      fnv1aHash(hookSig),
      fnv1aHash(mcpSig),
    ].join('::');
  }

  get(key: string): any | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    entry.refs += 1;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.builder;
  }

  set(key: string, builder: any): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, { builder, refs: 1 });
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

let instance: AgentFactory | null = null;

export async function resetAgentFactory(): Promise<void> {
  if (instance) {
    await instance.dispose();
  }
  instance = null;
}

export function getAgentFactory(): AgentFactory {
  if (!instance) {
    throw new Error('AgentFactory not initialized. Call initAgentFactory() first.');
  }
  return instance;
}

export function initAgentFactory(
  brain: BrainOS,
  options?: {
    defaultTools?: any[];
    defaultHooks?: any[];
    defaultPlugins?: any[];
    defaultMcpServers?: McpServerConfig[];
  },
): AgentFactory {
  if (!instance) {
    const mcpServers = options?.defaultMcpServers && options.defaultMcpServers.length > 0
      ? options.defaultMcpServers
      : loadMcpFromConfig();
    instance = new AgentFactory(brain, { ...options, defaultMcpServers: mcpServers });
  } else if (options) {
    // Late registration: if factory already exists (e.g., ResearchAnalysisTools ran first),
    // register tools/hooks that may have been missed. Merges, not overwrites.
    instance.registerDefaults(options);
  }
  return instance;
}

class AgentFactory {
  private brain: BrainOS;
  private defaultTools: any[];
  private defaultHooks: any[];
  private defaultPlugins: any[];
  private defaultMcpServers: McpServerConfig[];
  private sessionContexts: Map<string, SessionConfig>;
  private builderPool?: BuilderLru;

  constructor(
    brain: BrainOS,
    options?: {
      defaultTools?: any[];
      defaultHooks?: any[];
      defaultPlugins?: any[];
      defaultMcpServers?: McpServerConfig[];
    },
  ) {
    this.brain = brain;
    this.defaultTools = options?.defaultTools ?? [];
    this.defaultHooks = options?.defaultHooks ?? [];
    this.defaultPlugins = options?.defaultPlugins ?? DEFAULT_PLUGINS;
    this.defaultMcpServers = options?.defaultMcpServers ?? DEFAULT_MCP_SERVERS;
    this.sessionContexts = new Map();
  }

  getSessionContext(sessionId: string): SessionConfig | undefined {
    return this.sessionContexts.get(sessionId);
  }

  getDefaultMcpServers(): McpServerConfig[] {
    return this.defaultMcpServers;
  }

  getDefaultTools(): any[] {
    return this.defaultTools;
  }

  getSkillsDirs(): string[] {
    return DEFAULT_SKILLS_DIRS.filter(d => fs.existsSync(d));
  }

  setSessionContext(sessionId: string, context: SessionConfig): void {
    this.sessionContexts.set(sessionId, context);
  }

  clearSessionContext(sessionId: string): void {
    this.sessionContexts.delete(sessionId);
  }

  /**
   * Register defaults that may have been missed on initial construction.
   * Merges — does NOT overwrite existing values.  Used when
   * initAgentFactory is called a second time (e.g. TRP ran first, now
   * chat wants to add tools).
   */
  registerDefaults(options: {
    defaultTools?: any[];
    defaultHooks?: any[];
    defaultPlugins?: any[];
    defaultMcpServers?: McpServerConfig[];
  }): void {
    if (options.defaultTools && this.defaultTools.length === 0) {
      this.defaultTools = options.defaultTools;
    }
    if (options.defaultHooks && this.defaultHooks.length === 0) {
      this.defaultHooks = options.defaultHooks;
    }
    if (options.defaultPlugins && this.defaultPlugins.length === 0) {
      this.defaultPlugins = options.defaultPlugins;
    }
    if (options.defaultMcpServers && this.defaultMcpServers.length === 0) {
      this.defaultMcpServers = options.defaultMcpServers;
    }
  }

  create(config: AgentConfig): any {
    return this.buildAgent(config);
  }

  /**
   * Like `create`, but reuses a previously-built AgentBuilder when the same
   * (name, model, baseUrl, systemPrompt, tool set) is requested.
   *
   * Reusing a builder keeps the underlying jsbos.Agent (and its HTTP model
   * connection) warm across calls, so the first `ask()` is not paying cold-
   * start cost. Caveat: the inner agent retains conversation context. Pass a
   * `sessionId` on the config if you need isolated sessions, or use
   * `create()` for one-off agents.
   */
  getOrCreate(config: AgentConfig): any {
    if (!this.builderPool) {
      this.builderPool = new BuilderLru(POOL_MAX_SIZE);
    }
    const key = this.builderPool.keyFor(config);
    const cached = this.builderPool.get(key);
    if (cached) {
      return cached;
    }
    const builder = this.buildAgent(config);
    this.builderPool.set(key, builder);
    return builder;
  }

  /** Clear the pool (e.g. after config reload). */
  async dispose(): Promise<void> {
    this.clearPool();
    try {
      await this.brain.stop();
    } catch {
      // ignore errors during cleanup
    }
  }

  clearPool(): void {
    if (this.builderPool) {
      this.builderPool.clear();
    }
  }

  /** Pool size — useful for diagnostics and tests. */
  poolSize(): number {
    return this.builderPool?.size ?? 0;
  }

  private buildAgent(config: AgentConfig): any {
    const temperature = config.temperature ?? 0.7;
    const maxTokens = config.maxTokens ?? 16384;

    const allTools = [...this.defaultTools, ...(config.tools ?? []), ...(config.extraTools ?? [])];
    const allHooks = [...this.defaultHooks, ...(config.hooks ?? [])];
    const allPlugins = [...this.defaultPlugins, ...(config.plugins ?? [])];
    const mcpServers = config.mcpServers ?? this.defaultMcpServers;
    const skillsDirs = config.skillsDirs ?? DEFAULT_SKILLS_DIRS;

    let builder = this.brain.agent(config.name, config.onMcpStatus ? { onMcpStatus: config.onMcpStatus as any } : {})
      .with_systemPrompt(config.systemPrompt)
      .with_temperature(temperature)
      .with_maxTokens(maxTokens);

    for (const tool of allTools) {
      builder = builder.with_tools(tool);
    }

    for (const hook of allHooks) {
      builder = builder.with_hooks(hook);
    }

    for (const plugin of allPlugins) {
      builder = builder.with_plugins(plugin);
    }

    if (config.model) {
      builder = builder.with_model(config.model);
    }
    if (config.baseUrl) {
      builder = builder.with_baseUrl(config.baseUrl);
    }
    if (config.timeoutSecs) {
      builder = builder.with_timeout(config.timeoutSecs);
    }

    for (const dir of skillsDirs) {
      if (fs.existsSync(dir)) {
        builder = builder.with_skills_dir(dir);
      }
    }

    for (const server of mcpServers) {
      if (server.type === 'stdio' && server.command) {
        builder = builder.with_mcp_process(server.name, server.command, server.args || []);
      } else if (server.type === 'http' && server.url) {
        builder = builder.with_mcp_http(server.name, server.url);
      }
    }

    return builder;
  }

  withDefaultTools(tools: any[]): this {
    this.defaultTools = tools;
    return this;
  }

  withDefaultHooks(hooks: any[]): this {
    this.defaultHooks = hooks;
    return this;
  }

  withDefaultPlugins(plugins: any[]): this {
    this.defaultPlugins = plugins;
    return this;
  }

  withDefaultMcpServers(servers: McpServerConfig[]): this {
    this.defaultMcpServers = servers;
    return this;
  }
}
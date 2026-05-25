import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { BrainOS } from '@open1s/ezbos';
import { McpServerConfig } from './config/toolPermissions.js';

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  temperature?: number;
  model?: string;
  baseUrl?: string;
  tools?: any[];
  hooks?: any[];
  plugins?: any[];
  mcpServers?: McpServerConfig[];
  skillsDirs?: string[];
  extraTools?: any[];
  sessionId?: string;
  brainOsSession?: string;
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

let instance: AgentFactory | null = null;

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
    instance = new AgentFactory(brain, options);
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

  setSessionContext(sessionId: string, context: SessionConfig): void {
    this.sessionContexts.set(sessionId, context);
  }

  clearSessionContext(sessionId: string): void {
    this.sessionContexts.delete(sessionId);
  }

  create(config: AgentConfig): any {
    const temperature = config.temperature ?? 0.7;

    const allTools = [...this.defaultTools, ...(config.tools ?? []), ...(config.extraTools ?? [])];
    const allHooks = [...this.defaultHooks, ...(config.hooks ?? [])];
    const allPlugins = [...this.defaultPlugins, ...(config.plugins ?? [])];
    const mcpServers = config.mcpServers ?? this.defaultMcpServers;
    const skillsDirs = config.skillsDirs ?? DEFAULT_SKILLS_DIRS;

    let builder = this.brain.agent(config.name)
      .with_systemPrompt(config.systemPrompt)
      .with_temperature(temperature);

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
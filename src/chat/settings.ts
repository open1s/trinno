import * as vscode from 'vscode';
import type { ToolPermissionConfig, McpServerConfig } from '../bos/infrastructure/config/toolPermissions';
import { DEFAULT_TOOL_PERMISSIONS } from '../bos/infrastructure/config/toolPermissions';

export interface ChatConfig {
  model: {
    provider: 'openai' | 'anthropic' | 'openai-compatible';
    name: string;
    apiKey: string;
    baseUrl: string;
  };
  persona: {
    name: string;
    prompt: string;
  };
  streaming: {
    showThinking: boolean;
    thinkingFlushInterval: number;
  };
  context: {
    autoInject: boolean;
    maxCharsPerCell: number;
    maxTotalTokens: number;
    maxCharsPerAttachment: number;
  };
  history: {
    enabled: boolean;
    maxMessages: number;
  };
  tools: {
    permissions: ToolPermissionConfig;
  };
  mcp: {
    servers: McpServerConfig[];
  };
}

export const DEFAULT_CONFIG: ChatConfig = {
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
  },
  persona: {
    name: 'Research Assistant',
    prompt: 'You are the Trinno Research Assistant — a senior research collaborator for technical innovation, engineering design, and systematic research.\n\nToolkit: TRIZ + PRISMA + SWOT + PEST + 5W1H + PICO. 6-phase workspace (01_Discover/02_TRL/03_Analyze/04_Synthesize/05_Deliver/06_References/07_Patent). Read/write files, search web, execute tools.\n\nBe concise, evidence-based. Ground claims in tool results. Grill with one question at a time when vague. Retry failing tools max 2x.',
  },
  streaming: {
    showThinking: true,
    thinkingFlushInterval: 100,
  },
  context: {
    autoInject: true,
    maxCharsPerCell: 500,
    maxTotalTokens: 4000,
    maxCharsPerAttachment: 2000,
  },
  history: {
    enabled: true,
    maxMessages: 100,
  },
  tools: {
    permissions: DEFAULT_TOOL_PERMISSIONS,
  },
  mcp: {
    servers: [],
  },
};

const CONFIG_NS = 'chat';
const API_KEY_SECRET = 'chat.model.apiKey';

export function getChatConfig(): ChatConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
  return {
    model: {
      provider: cfg.get<'openai' | 'anthropic' | 'openai-compatible'>('model.provider', DEFAULT_CONFIG.model.provider),
      name: cfg.get<string>('model.name', DEFAULT_CONFIG.model.name),
      apiKey: '', // loaded from secrets
      baseUrl: cfg.get<string>('model.baseUrl', DEFAULT_CONFIG.model.baseUrl),
    },
    persona: {
      name: cfg.get<string>('persona.name', DEFAULT_CONFIG.persona.name),
      prompt: cfg.get<string>('persona.prompt', DEFAULT_CONFIG.persona.prompt),
    },
    streaming: {
      showThinking: cfg.get<boolean>('streaming.showThinking', DEFAULT_CONFIG.streaming.showThinking),
      thinkingFlushInterval: cfg.get<number>('streaming.thinkingFlushInterval', DEFAULT_CONFIG.streaming.thinkingFlushInterval),
    },
    context: {
      autoInject: cfg.get<boolean>('context.autoInject', DEFAULT_CONFIG.context.autoInject),
      maxCharsPerCell: cfg.get<number>('context.maxCharsPerCell', DEFAULT_CONFIG.context.maxCharsPerCell),
      maxTotalTokens: cfg.get<number>('context.maxTotalTokens', DEFAULT_CONFIG.context.maxTotalTokens),
      maxCharsPerAttachment: cfg.get<number>('context.maxCharsPerAttachment', DEFAULT_CONFIG.context.maxCharsPerAttachment),
    },
    history: {
      enabled: cfg.get<boolean>('history.enabled', DEFAULT_CONFIG.history.enabled),
      maxMessages: cfg.get<number>('history.maxMessages', DEFAULT_CONFIG.history.maxMessages),
    },
    tools: {
      permissions: cfg.get<ToolPermissionConfig>('tools.permissions', DEFAULT_CONFIG.tools.permissions),
    },
    mcp: {
      servers: cfg.get<McpServerConfig[]>('mcp.servers', DEFAULT_CONFIG.mcp.servers),
    },
  };
}

export async function getApiKey(): Promise<string> {
  try {
    const secretStore = (vscode.env as any).secrets;
    const secret = await secretStore?.get(API_KEY_SECRET);
    return secret || '';
  } catch {
    return '';
  }
}

export async function setApiKey(key: string): Promise<void> {
  try {
    const secretStore = (vscode.env as any).secrets;
    await secretStore?.store(API_KEY_SECRET, key);
  } catch {
    // secrets not available
  }
}

export function getConfigSchema(): Record<string, unknown> {
  return {
    [`${CONFIG_NS}.model.provider`]: {
      type: 'string',
      enum: ['openai', 'anthropic', 'openai-compatible'],
      default: DEFAULT_CONFIG.model.provider,
      description: 'AI model provider',
    },
    [`${CONFIG_NS}.model.name`]: {
      type: 'string',
      default: DEFAULT_CONFIG.model.name,
      description: 'Model name (e.g., gpt-4o, claude-sonnet-4-20250514)',
    },
    [`${CONFIG_NS}.model.baseUrl`]: {
      type: 'string',
      default: DEFAULT_CONFIG.model.baseUrl,
      description: 'API base URL (for openai-compatible providers)',
    },
    [`${CONFIG_NS}.model.apiKey`]: {
      type: 'string',
      default: '',
      description: 'API key (stored in VS Code secrets)',
    },
    [`${CONFIG_NS}.persona.name`]: {
      type: 'string',
      default: DEFAULT_CONFIG.persona.name,
      description: 'Agent display name',
    },
    [`${CONFIG_NS}.persona.prompt`]: {
      type: 'string',
      default: DEFAULT_CONFIG.persona.prompt,
      description: 'System prompt for the agent',
    },
    [`${CONFIG_NS}.streaming.showThinking`]: {
      type: 'boolean',
      default: DEFAULT_CONFIG.streaming.showThinking,
      description: 'Show reasoning/thinking content in chat',
    },
    [`${CONFIG_NS}.streaming.thinkingFlushInterval`]: {
      type: 'number',
      default: DEFAULT_CONFIG.streaming.thinkingFlushInterval,
      description: 'How many characters to buffer before flushing thinking content (200 = flush every 200 chars)',
    },
    [`${CONFIG_NS}.context.autoInject`]: {
      type: 'boolean',
      default: DEFAULT_CONFIG.context.autoInject,
      description: 'Auto-inject notebook context at conversation start',
    },
    [`${CONFIG_NS}.context.maxCharsPerCell`]: {
      type: 'number',
      default: DEFAULT_CONFIG.context.maxCharsPerCell,
      description: 'Max characters per cell to include in notebook context',
    },
    [`${CONFIG_NS}.context.maxTotalTokens`]: {
      type: 'number',
      default: DEFAULT_CONFIG.context.maxTotalTokens,
      description: 'Max total tokens for notebook context',
    },
    [`${CONFIG_NS}.context.maxCharsPerAttachment`]: {
      type: 'number',
      default: DEFAULT_CONFIG.context.maxCharsPerAttachment,
      description: 'Max characters to inline before switching to file reference mode',
    },
    [`${CONFIG_NS}.history.enabled`]: {
      type: 'boolean',
      default: DEFAULT_CONFIG.history.enabled,
      description: 'Persist chat history across VS Code sessions',
    },
    [`${CONFIG_NS}.history.maxMessages`]: {
      type: 'number',
      default: DEFAULT_CONFIG.history.maxMessages,
      description: 'Max messages to keep in history',
    },
    [`${CONFIG_NS}.tools.permissions`]: {
      type: 'object',
      default: DEFAULT_CONFIG.tools.permissions,
      description: 'Tool permission configuration. Values: "allow" (auto-execute), "deny" (blocked), "ask" (requires approval)',
    },
    [`${CONFIG_NS}.mcp.servers`]: {
      type: 'array',
      default: [],
      description: 'MCP servers to connect. Each server: { name, type: "stdio"|"http", command?, args?, url? }',
    },
  };
}
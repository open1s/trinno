import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as toml from 'toml';
import type { ToolPermissionConfig, McpServerConfig } from '../bos/infrastructure/config/toolPermissions';
import { DEFAULT_TOOL_PERMISSIONS } from '../bos/infrastructure/config/toolPermissions';

interface TrinnoTomlConfig {
  active_llm?: string;
  global_model?: { model?: string; base_url?: string; api_key?: string };
  llm?: Record<string, { model?: string; base_url?: string; api_key?: string }>;
  persona?: { name?: string; prompt?: string };
  streaming?: { show_thinking?: boolean; thinking_flush_interval?: number };
  context?: Record<string, unknown>;
  history?: { enabled?: boolean; max_messages?: number };
  tools?: { permissions?: ToolPermissionConfig };
  sandbox?: { enabled?: boolean };
  mcp?: { servers?: McpServerConfig[] };
}

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
  sandbox: {
    enabled: boolean;
  };
  mcp: {
    servers: McpServerConfig[];
  };
}

const TOML_PATH = path.join(os.homedir(), '.bos', 'conf', 'config.toml');

function readToml(filePath: string): TrinnoTomlConfig | null {
  try {
    const expanded = filePath.startsWith('~')
      ? path.join(os.homedir(), filePath.slice(1))
      : filePath;
    if (!fs.existsSync(expanded)) return null;
    return toml.parse(fs.readFileSync(expanded, 'utf-8')) as unknown as TrinnoTomlConfig;
  } catch {
    return null;
  }
}

export function getChatConfig(filePath?: string): ChatConfig {
  const data = readToml(filePath || TOML_PATH);

  const globalModel = data?.global_model;
  const llm = data?.llm;
  const activeLlm = data?.active_llm ?? '';
  const activeModel = activeLlm && llm?.[activeLlm] ? llm[activeLlm] : globalModel;

  const persona = data?.persona ?? {};
  const streaming = data?.streaming ?? {};
  const context = data?.context ?? {};
  const history = data?.history ?? {};
  const tools = data?.tools ?? {};
  const sandbox = data?.sandbox ?? {};
  const mcp = data?.mcp ?? {};

  return {
    model: {
      provider: 'openai',
      name: activeModel?.model ?? '',
      apiKey: activeModel?.api_key ?? '',
      baseUrl: activeModel?.base_url ?? '',
    },
    persona: {
      name: (persona as any)?.name ?? 'Research Assistant',
      prompt: (persona as any)?.prompt ?? '',
    },
    streaming: {
      showThinking: (streaming as any)?.show_thinking ?? true,
      thinkingFlushInterval: (streaming as any)?.thinking_flush_interval ?? 200,
    },
    context: {
      autoInject: (context as any)?.auto_inject ?? true,
      maxCharsPerCell: (context as any)?.max_chars_per_cell ?? 500,
      maxTotalTokens: (context as any)?.max_total_tokens ?? 4000,
      maxCharsPerAttachment: (context as any)?.max_chars_per_attachment ?? 2000,
    },
    history: {
      enabled: (history as any)?.enabled ?? true,
      maxMessages: (history as any)?.max_messages ?? 100,
    },
    tools: {
      permissions: (tools as any)?.permissions ?? DEFAULT_TOOL_PERMISSIONS,
    },
    sandbox: {
      enabled: (sandbox as any)?.enabled ?? true,
    },
    mcp: {
      servers: (mcp as any)?.servers ?? [],
    },
  };
}

export async function getApiKey(filePath?: string): Promise<string> {
  const data = readToml(filePath || TOML_PATH);
  const globalModel = data?.global_model;
  const llm = data?.llm;
  const activeLlm = data?.active_llm ?? '';
  const activeModel = activeLlm && llm?.[activeLlm] ? llm[activeLlm] : globalModel;

  if (activeModel?.api_key) return activeModel.api_key;

  return '';
}

export function openConfig(): void {
  const tomlPath = TOML_PATH;
  if (!fs.existsSync(tomlPath)) {
    vscode.window.showWarningMessage(`Config file not found: ${tomlPath}`);
    return;
  }
  vscode.workspace.openTextDocument(tomlPath).then(doc => {
    vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
  });
}

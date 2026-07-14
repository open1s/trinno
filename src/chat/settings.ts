import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as toml from 'toml';
import type { ToolPermissionConfig, McpServerConfig } from '../bos/infrastructure/config/toolPermissions';
import { DEFAULT_TOOL_PERMISSIONS } from '../bos/infrastructure/config/toolPermissions';

interface TrinnoTomlConfig {
  global_model?: { model?: string; base_url?: string; api_key?: string };
  llm?: Record<string, { model?: string; base_url?: string; api_key?: string }>;
  proxy?: { http_proxy?: string; https_proxy?: string };
  tavily?: { api_key?: string };
  agent?: { max_iterations?: number; timeout_seconds?: number };
  logging?: { level?: string; console?: boolean };
  bus?: { max_queue_size?: number };
  skills_registry?: { skills?: Array<Record<string, unknown>> };
  persona?: { name?: string; prompt?: string };
  streaming?: { show_thinking?: boolean; thinking_flush_interval?: number };
  context?: Record<string, unknown>;
  history?: { enabled?: boolean; max_messages?: number };
  tools?: { permissions?: ToolPermissionConfig };
  sandbox?: { enabled?: boolean };
  mcp?: { servers?: McpServerConfig[] };
  papers?: { output_dir?: string; unpaywall_email?: string };
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

export const TOML_PATH = path.join(os.homedir(), '.bos', 'conf', 'config.toml');
const CONFIG_NS = 'chat.trinno';

const SKIP_TOML_KEYS = new Set(['name', 'version', 'general', 'keybinding', 'proxy']);

function expandTilde(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function readToml(filePath: string): TrinnoTomlConfig | null {
  try {
    const expanded = expandTilde(filePath);
    if (!fs.existsSync(expanded)) return null;
    return toml.parse(fs.readFileSync(expanded, 'utf-8')) as unknown as TrinnoTomlConfig;
  } catch {
    return null;
  }
}

// Strip api_key from an object recursively
function stripApiKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(stripApiKeys);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k !== 'api_key') {
        result[k] = stripApiKeys(v);
      }
    }
    return result;
  }
  return obj;
}

const VS_CODE_SECTIONS = [
  'global_model', 'active_llm', 'llm', 'persona', 'streaming', 'context',
  'history', 'tools', 'sandbox', 'mcp', 'papers',
  'agent', 'logging', 'tavily', 'bus', 'skills_registry',
];

export function syncTomlToSettings(tomlPath?: string): void {
  const tPath = tomlPath || TOML_PATH;
  const data = readToml(tPath);
  if (!data) return;

  const vsConfig = vscode.workspace.getConfiguration(CONFIG_NS);

  for (const section of VS_CODE_SECTIONS) {
    const val = (data as Record<string, unknown>)[section];
    if (val !== undefined) {
      // Strip api_key before writing to VS Code settings
      vsConfig.update(section, stripApiKeys(val), vscode.ConfigurationTarget.Global);
    }
  }
}

export function syncSettingsToToml(tomlPath?: string): void {
  const tPath = tomlPath || TOML_PATH;
  const vsConfig = vscode.workspace.getConfiguration(CONFIG_NS);
  const existing: Record<string, unknown> = (readToml(tPath) as Record<string, unknown> | null) ?? {};

  for (const section of VS_CODE_SECTIONS) {
    const val = vsConfig.inspect(section);
    if (val?.globalValue !== undefined) {
      (existing as Record<string, unknown>)[section] = val.globalValue;
    }
  }

  const outDir = path.dirname(expandTilde(tPath));
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(expandTilde(tPath), toTomlString(existing), 'utf-8');
}

export function initTomlSync(context: vscode.ExtensionContext, tomlPath?: string): void {
  const tPath = tomlPath || TOML_PATH;
  const expanded = expandTilde(tPath);
  const outDir = path.dirname(expanded);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (!fs.existsSync(expanded)) {
    syncSettingsToToml(tPath);
  } else {
    syncTomlToSettings(tPath);
  }

  if (fs.existsSync(expanded)) {
    const watcher = vscode.workspace.createFileSystemWatcher(expanded);
    watcher.onDidChange(() => syncTomlToSettings(tPath));
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(CONFIG_NS)) {
        syncSettingsToToml(tPath);
      }
    })
  );
}

function toTomlString(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (SKIP_TOML_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
      if (entries.length === 0) continue;

      const hasNested = entries.some(([, v]) =>
        typeof v === 'object' && v !== null && !Array.isArray(v)
      );
      const hasArraysOfTables = entries.some(([, v]) =>
        Array.isArray(v) && v.length > 0 && typeof v[0] === 'object'
      );

      if (hasArraysOfTables) {
        for (const [subKey, subVal] of entries) {
          if (Array.isArray(subVal) && subVal.length > 0 && typeof subVal[0] === 'object') {
            for (const item of subVal as Record<string, unknown>[]) {
              lines.push(`[[${key}.${subKey}]]`);
              for (const [ik, iv] of Object.entries(item)) {
                lines.push(`${ik} = ${tomlValue(iv)}`);
              }
            }
          } else {
            lines.push(`${subKey} = ${tomlValue(subVal)}`);
          }
        }
      } else if (hasNested) {
        for (const [subKey, subVal] of entries) {
          if (typeof subVal === 'object' && subVal !== null) {
            lines.push(`[${key}.${subKey}]`);
            for (const [sk, sv] of Object.entries(subVal as Record<string, unknown>)) {
              lines.push(`${sk} = ${tomlValue(sv)}`);
            }
          } else {
            lines.push(`${subKey} = ${tomlValue(subVal)}`);
          }
        }
      } else {
        lines.push(`[${key}]`);
        for (const [subKey, subVal] of entries) {
          lines.push(`${subKey} = ${tomlValue(subVal)}`);
        }
      }
    } else {
      lines.push(`${key} = ${tomlValue(value)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function tomlValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  if (v === true) return 'true';
  if (v === false) return 'false';
  return String(v);
}

export function getChatConfig(): ChatConfig {
  const data = readToml(TOML_PATH);

  const globalModel = data?.global_model;
  const llm = data?.llm;
  const activeLlm = ''; // not stored in TOML yet, could add
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

export async function getApiKey(): Promise<string> {
  const data = readToml(TOML_PATH);
  const globalModel = data?.global_model;
  const llm = data?.llm;
  const activeModel = globalModel; // fallback to global_model

  if (activeModel?.api_key) return activeModel.api_key;

  try {
    const secretStore = (vscode.env as any).secrets;
    const secret = await secretStore?.get('chat.model.apiKey');
    return secret || '';
  } catch {
    return '';
  }
}

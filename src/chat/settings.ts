import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as toml from 'toml';
import { DEFAULT_TOOL_PERMISSIONS } from '../bos/infrastructure/config/toolPermissions';

const TOML_PATH = path.join(os.homedir(), '.bos', 'conf', 'config.toml');

function readToml(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return toml.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getChatConfig() {
  const d = (readToml(TOML_PATH) ?? {}) as any;

  const globalModel = d.global_model;
  const llm = d.llm;
  const activeLlm = d.active_llm ?? '';
  const activeModel = activeLlm && llm?.[activeLlm] ? llm[activeLlm] : globalModel;

  const persona = d.persona ?? {};
  const streaming = d.streaming ?? {};
  const context = d.context ?? {};
  const history = d.history ?? {};
  const tools = d.tools ?? {};
  const sandbox = d.sandbox ?? {};
  const mcp = d.mcp ?? {};

  return {
    model: {
      provider: 'openai',
      name: activeModel?.model ?? '',
      apiKey: activeModel?.api_key ?? '',
      baseUrl: activeModel?.base_url ?? '',
    },
    persona: {
      name: persona.name ?? 'Research Assistant',
      prompt: persona.prompt ?? '',
    },
    streaming: {
      showThinking: streaming.show_thinking ?? true,
      thinkingFlushInterval: streaming.thinking_flush_interval ?? 200,
    },
    context: {
      autoInject: context.auto_inject ?? true,
      maxCharsPerCell: context.max_chars_per_cell ?? 500,
      maxTotalTokens: context.max_total_tokens ?? 4000,
      maxCharsPerAttachment: context.max_chars_per_attachment ?? 2000,
    },
    history: {
      enabled: history.enabled ?? true,
      maxMessages: history.max_messages ?? 100,
    },
    tools: {
      permissions: d.tools?.permissions ?? DEFAULT_TOOL_PERMISSIONS,
    },
    sandbox: {
      enabled: d.sandbox?.enabled ?? true,
    },
    mcp: {
      servers: d.mcp?.servers ?? [],
    },
  };
}

export async function getApiKey(): Promise<string> {
  const d = readToml(TOML_PATH) as any;
  if (!d) return '';
  const globalModel = d.global_model;
  const llm = d.llm;
  const activeLlm = d.active_llm ?? '';
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

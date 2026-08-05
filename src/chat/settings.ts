import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigLoader } from '@open1s/jsbos';

const TOML_PATH = path.join(os.homedir(), '.bos', 'conf', 'config.toml');

const DEFAULT_CONFIG = `# config.toml — Trinno / BrainOS configuration
# Uncomment and fill in every field marked "REPLACE ME" before first use.

[general]
name = "TRINNO"
version = "1.4.10"
environment = "release"

[global_model]
# REQUIRED: set model + base_url + api_key for your chosen provider.
# Example (NVIDIA / local proxy):
#   model = "nvidia/minimaxai/minimax-m2.7"
#           here nvidia is the provider prefix used in trinno for routing requests to the provider, and minimaxai/minimax-m2.7 is the model identifier. You can find the list of available models in the trinno documentation or on the provider's website.
#   base_url = "http://127.0.0.1:11436/v1"
#   api_key = "REPLACE_ME_WITH_YOUR_API_KEY"
# model = "REPLACE_ME_WITH_MODEL"
# base_url = "REPLACE_ME_WITH_BASE_URL"
# api_key = "REPLACE_ME_WITH_YOUR_API_KEY"
# api_mode = "responses"          # "chat" (default) or "responses" (OpenAI Responses API, e.g. for DeepSeek)
# reasoning_effort = "high"       # "low" | "medium" | "high" — thinking effort for reasoning-capable models


# Named LLM providers (uncomment and fill api_key for each you use)
# [llm.minimax3]
# model = "nvidia/minimaxai/minimax-m3"
# base_url = "http://127.0.0.1:11436/v1"
# api_key = "REPLACE_ME_WITH_YOUR_API_KEY"

# [llm.minimax]
# model = "nvidia/minimaxai/minimax-m2.7"
# base_url = "https://integrate.api.nvidia.com/v1"
# api_key = "REPLACE_ME_WITH_YOUR_API_KEY"

# [llm.glm]
# model = "nvidia/z-ai/glm-5.2"
# base_url = "http://127.0.0.1:11436/v1"
# api_key = "REPLACE_ME_WITH_YOUR_API_KEY"

# [llm.stepfun]
# model = "nvidia/stepfun-ai/step-3.7-flash"
# base_url = "http://127.0.0.1:11436/v1"
# api_key = "REPLACE_ME_WITH_YOUR_API_KEY"

# [llm.deepseek]
# model = "nvidia/deepseek-ai/deepseek-v4-pro"
# base_url = "http://127.0.0.1:11436/v1"
# api_key = "REPLACE_ME_WITH_YOUR_API_KEY"
# api_mode = "responses"          # "chat" (default) or "responses" (OpenAI Responses API, e.g. for DeepSeek)
# reasoning_effort = "high"       # "low" | "medium" | "high" — thinking effort for reasoning-capable models

[agent]
max_iterations = 100
timeout_seconds = 30

[proxy]
# Uncomment only if you need an HTTP(S) proxy
# http_proxy = "http://127.0.0.1:9981"
# https_proxy = "http://127.0.0.1:9981"

[logging]
level = "trace"
console = false

[bus]
max_queue_size = 1000

[[skills_registry.skills]]
name = "Awesome-Journal-Scholar-Skills"
description = "Academic research writing skills"
repo = "https://gitee.com/open1s/Awesome-Journal-Skills.git"
ref = "main"
# tags = ["REPLACE_ME_WITH_TAGS"]

[[skills_registry.skills]]
name = "scientific-agent-skills"
description = "Accelerate Your Research"
repo = "https://gitee.com/open1s/scientific-agent-skills.git"
ref = "main"
# tags = ["REPLACE_ME_WITH_TAGS"]

[sandbox]
enabled = false
`;

export function ensureConfigTemplate(tomlPath: string): void {
  if (!fs.existsSync(tomlPath)) {
    fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
    fs.writeFileSync(tomlPath, DEFAULT_CONFIG, 'utf-8');
  }
}

export function getChatConfig() {
  try {
    const loader = new ConfigLoader();
    loader.discover();
    return JSON.parse(loader.loadSync());
  } catch {
    return {};
  }
}

export function openConfig(): void {
  ensureConfigTemplate(TOML_PATH);
  vscode.workspace.openTextDocument(TOML_PATH).then(doc => {
    vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
  });
}

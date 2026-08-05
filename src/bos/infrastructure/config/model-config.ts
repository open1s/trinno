export interface ModelConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiMode?: string;
  reasoningEffort?: string;
}

export function getModelConfig(): ModelConfig {
  return (globalThis as any).__TRP_MODEL_CONFIG || {};
}
import { Agent } from '@open1s/ezbos';
import { createModuleLogger } from '../logging/logger.js';

const log = createModuleLogger('streaming');

export interface StreamingCallbacks {
  onThinking?: (text: string) => void;
  onText?: (text: string) => void;
  onToolCall?: (name: string) => void;
  onToolResult?: () => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export async function streamAgent(
  agent: Agent,
  prompt: string,
  callbacks: StreamingCallbacks = {},
): Promise<string> {
  const textParts: string[] = [];
  let streamError: Error | null = null;

  await agent.stream(prompt, (token: any) => {
    switch (token.type) {
      case 'ReasoningContent':
        if (callbacks.onThinking) callbacks.onThinking(token.text);
        break;
      case 'Text':
        textParts.push(token.text);
        if (callbacks.onText) callbacks.onText(token.text);
        break;
      case 'ToolCall':
        if (callbacks.onToolCall) callbacks.onToolCall(token.name);
        break;
      case 'ToolResult':
        if (callbacks.onToolResult) callbacks.onToolResult();
        break;
      case 'Done':
        if (callbacks.onDone) callbacks.onDone();
        break;
      case 'Error':
        streamError = new Error(token.error || 'Stream error');
        log.error({ error: token.error }, 'stream error');
        if (callbacks.onError) callbacks.onError(streamError);
        break;
    }
  });

  // If we collected text before the error, return what we have.
  // If the stream errored with zero text, throw so callers can retry.
  if (streamError && textParts.length === 0) {
    throw streamError;
  }

  return textParts.join('');
}

export async function streamAgentCollect(
  agent: Agent,
  prompt: string,
): Promise<string> {
  const tokens = await agent.streamCollect(prompt);
  return tokens
    .filter((t: any) => t.type === 'Text')
    .map((t: any) => t.text)
    .join('');
}

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

export interface StreamAgentOptions {
  /** Abort mid-stream: forwarded to `streamEvents`, which stops the agent loop and ends iteration. */
  signal?: AbortSignal;
}

/**
 * One in-flight chain per agent.
 *
 * A jsbos agent refuses a second run while it is streaming ("Agent is already
 * running"), and one assistant turn can emit two tool calls at once - both
 * reach the same lazily-started helper agent. A submission for a busy agent
 * therefore waits for the one ahead of it instead of being refused.
 */
const agentChains = new WeakMap<Agent, Promise<unknown>>();

function serializeOnAgent<T>(agent: Agent, run: () => Promise<T>): Promise<T> {
  const previous = agentChains.get(agent) ?? Promise.resolve();
  // Run whether the previous call resolved or rejected: one bad call must not
  // wedge every later one behind it.
  const next = previous.then(run, run);
  agentChains.set(agent, next);
  const settle = () => {
    if (agentChains.get(agent) === next) agentChains.delete(agent);
  };
  next.then(settle, settle);
  return next;
}

/**
 * Stream a prompt through `agent.streamEvents` (ezbos 2.x async-iterable
 * API) instead of the deprecated callback `agent.stream`. The iterator
 * guarantees exactly one terminal `done` or `error` event, so callbacks
 * fire deterministically and callers can cancel with an AbortSignal.
 */
export function streamAgent(
  agent: Agent,
  prompt: string,
  callbacks: StreamingCallbacks = {},
  options: StreamAgentOptions = {},
): Promise<string> {
  return serializeOnAgent(agent, () => runStreamAgent(agent, prompt, callbacks, options));
}

async function runStreamAgent(
  agent: Agent,
  prompt: string,
  callbacks: StreamingCallbacks = {},
  options: StreamAgentOptions = {},
): Promise<string> {
  const textParts: string[] = [];
  let streamError: Error | null = null;
  let doneFired = false;

  const fireDone = () => {
    if (doneFired) return;
    doneFired = true;
    if (callbacks.onDone) callbacks.onDone();
  };

  const fail = (message: string) => {
    if (streamError) return;
    streamError = new Error(message || 'Stream error');
    log.error({ error: streamError.message }, 'stream error');
    if (callbacks.onError) callbacks.onError(streamError);
  };

  // exactOptionalPropertyTypes: only pass signal when present.
  const streamOpts = options.signal ? { signal: options.signal } : {};

  try {
    for await (const ev of agent.streamEvents(prompt, streamOpts)) {
      if (ev.type === 'done') {
        fireDone();
        continue;
      }
      if (ev.type === 'error') {
        fail(ev.error);
        continue;
      }

      const token = ev.token;
      if (!token) continue;
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
          fireDone();
          break;
        case 'Error':
          fail(token.error || 'Stream error');
          break;
      }
    }
  } catch (err) {
    // Cancellation (AbortSignal) or a thrown transport error.
    fail(err instanceof Error ? err.message : String(err));
  }

  // If we collected text before the error, return what we have.
  // If the stream errored with zero text, throw so callers can retry.
  if (streamError && textParts.length === 0) {
    throw streamError;
  }

  return textParts.join('');
}

export function streamAgentCollect(
  agent: Agent,
  prompt: string,
): Promise<string> {
  return serializeOnAgent(agent, async () => {
    const tokens = await agent.streamCollect(prompt);
    return tokens
      .filter((t: any) => t.type === 'Text')
      .map((t: any) => t.text)
      .join('');
  });
}

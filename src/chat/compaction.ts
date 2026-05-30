import type { ChatMessage } from './messages';

export interface CompactionConfig {
  maxMessages: number;
  keepRecent: number;
  summaryMaxTokens: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxMessages: 40,
  keepRecent: 10,
  summaryMaxTokens: 2000,
};

export interface CompactionResult {
  messages: ChatMessage[];
  summary: string;
  wasCompacted: boolean;
}

export function shouldCompact(messages: ChatMessage[], config: CompactionConfig): boolean {
  return messages.length > config.maxMessages;
}

export function compactMessages(
  messages: ChatMessage[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
): CompactionResult {
  if (!shouldCompact(messages, config)) {
    return { messages, summary: '', wasCompacted: false };
  }

  const keepCount = config.keepRecent;
  const toCompact = messages.slice(0, -keepCount);
  const recent = messages.slice(-keepCount);

  const summary = buildSummary(toCompact, config);

  return {
    messages: recent,
    summary,
    wasCompacted: true,
  };
}

function buildSummary(messages: ChatMessage[], config: CompactionConfig): string {
  const parts: string[] = [];

  let currentUserMsg = '';
  let currentAssistantMsg = '';

  const flushPair = () => {
    if (currentUserMsg || currentAssistantMsg) {
      const userPart = currentUserMsg ? `User: ${currentUserMsg.slice(0, 200)}` : '';
      const assistantPart = currentAssistantMsg ? `Assistant: ${currentAssistantMsg.slice(0, 300)}` : '';
      if (userPart && assistantPart) {
        parts.push(`${userPart}\n${assistantPart}`);
      } else if (userPart) {
        parts.push(userPart);
      } else if (assistantPart) {
        parts.push(assistantPart);
      }
      currentUserMsg = '';
      currentAssistantMsg = '';
    }
  };

  for (const msg of messages) {
    if (msg.role === 'user') {
      flushPair();
      currentUserMsg = msg.content;
    } else if (msg.role === 'assistant') {
      currentAssistantMsg = msg.content;
      if (msg.reasoning) {
        currentAssistantMsg += `\n[Reasoning: ${msg.reasoning.slice(0, 150)}]`;
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolNames = msg.toolCalls.map(t => t.name).join(', ');
        currentAssistantMsg += `\n[Tools used: ${toolNames}]`;
      }
    }
  }
  flushPair();

  const summary = parts.join('\n\n---\n\n');
  const maxChars = config.summaryMaxTokens * 4;
  return summary.length > maxChars ? summary.slice(0, maxChars) + '\n...[truncated]' : summary;
}

export function buildContextWithSummary(
  messages: ChatMessage[],
  existingSummary: string | undefined,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
): { systemSummary: string } {
  const compaction = compactMessages(messages, config);

  let systemSummary = '';
  if (existingSummary) {
    systemSummary = existingSummary;
  }
  if (compaction.summary) {
    systemSummary = systemSummary
      ? `${systemSummary}\n\n[Earlier conversation continued...]\n\n${compaction.summary}`
      : compaction.summary;
  }

  const maxChars = config.summaryMaxTokens * 4;
  if (systemSummary.length > maxChars) {
    systemSummary = systemSummary.slice(0, maxChars) + '\n...[truncated]';
  }

  return { systemSummary };
}

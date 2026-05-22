import { SlashCommand } from './registry.js';

export const compactCommand: SlashCommand = {
  name: 'compact',
  description: 'Compact current session: summarize old messages, reduce context',
  usage: '/compact',
  async execute(_args, _deps, emit, _signal) {
    emit('token', {
      tokenType: 'Text',
      text: 'Session compaction is handled by the extension panel. Use `/compact` in the chat panel to compact the current session.\n\nThis command reduces the number of messages by keeping the most recent 10 messages and summarizing older ones into a context summary.',
    });
    emit('done', {});
  },
};

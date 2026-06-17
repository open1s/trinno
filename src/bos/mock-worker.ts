import { createInterface } from 'readline';

async function main(): Promise<void> {
  process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg: Record<string, unknown> = JSON.parse(line);
      const type = msg.type;
      if (type === 'chat' || type === 'slash' || type === 'compact') {
        process.stdout.write(JSON.stringify({
          type: 'token',
          tokenType: 'Text',
          text: `Hello from mock worker (msgId=${String(msg.messageId ?? '?')}) `,
        }) + '\n');
        process.stdout.write(JSON.stringify({ type: 'done', messageId: msg.messageId }) + '\n');
      } else if (type === 'init' || type === 'mcp-status-request' || type === 'lsp-status-request' || type === 'todo-status-request') {
        process.stdout.write(JSON.stringify({ type: 'done' }) + '\n');
      }
    } catch {
      // ignore parse errors
    }
  }
}

main().catch(() => process.exit(1));

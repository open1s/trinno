import { createInterface } from 'readline';
import { appendFileSync } from 'fs';

/**
 * Minimal stand-in for dist/bos/worker.js, used by the transport-level tests
 * (set TRINNO_WORKER_PATH to this file before chat/agent is loaded).
 *
 * Generation semantics mirror the real worker so tests can pin the ordering the
 * panel produces when a queued message is force-executed:
 *  - "SLOW: <text>" streams a first token and finishes 400ms later, giving the
 *    test a window to cancel it;
 *  - 'cancel' carries the messageId it targets and is IGNORED when that
 *    generation has already been superseded (see src/bos/cancel_target.ts).
 *
 * Set TRINNO_MOCK_WORKER_LOG=<path> to record what the worker observed.
 */
const logPath = process.env.TRINNO_MOCK_WORKER_LOG;

function record(line: string): void {
  if (!logPath) return;
  try { appendFileSync(logPath, line + '\n'); } catch { /* ignore */ }
}

async function main(): Promise<void> {
  process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

  let currentMessageId: string | null = null;
  let pendingDone: NodeJS.Timeout | null = null;

  const finish = (messageId: unknown): void => {
    if (pendingDone) { clearTimeout(pendingDone); pendingDone = null; }
    process.stdout.write(JSON.stringify({ type: 'done', messageId }) + '\n');
  };

  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg: Record<string, unknown> = JSON.parse(line);
      const type = msg.type;
      if (type === 'chat' || type === 'slash' || type === 'compact') {
        currentMessageId = typeof msg.messageId === 'string' ? msg.messageId : null;
        record('chat ' + (currentMessageId ?? '-'));
        process.stdout.write(JSON.stringify({
          type: 'token',
          tokenType: 'Text',
          text: 'Hello from mock worker (msgId=' + String(msg.messageId ?? '?') + ') ',
          messageId: msg.messageId,
        }) + '\n');
        if (String(msg.text ?? '').startsWith('SLOW:')) {
          if (pendingDone) clearTimeout(pendingDone);
          pendingDone = setTimeout(() => finish(msg.messageId), 400);
        } else {
          finish(msg.messageId);
        }
      } else if (type === 'cancel') {
        const target = typeof msg.messageId === 'string' ? msg.messageId : null;
        const stale = Boolean(target && currentMessageId && target !== currentMessageId);
        record('cancel ' + (target ?? '-') + ' current=' + (currentMessageId ?? '-') + ' stale=' + String(stale));
        if (stale) continue;
        if (pendingDone) { clearTimeout(pendingDone); pendingDone = null; record('aborted ' + (currentMessageId ?? '-')); }
        currentMessageId = null;
      } else if (type === 'init' || type === 'mcp-status-request' || type === 'lsp-status-request' || type === 'todo-status-request') {
        process.stdout.write(JSON.stringify({ type: 'done' }) + '\n');
      }
    } catch {
      // ignore parse errors
    }
  }
}

main().catch(() => process.exit(1));

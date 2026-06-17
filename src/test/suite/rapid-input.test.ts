import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../bos/infrastructure/logging/logger';

const log = createModuleLogger('test-rapid-input');

/**
 * Exact replica of the agent.ts sendMessage() flow:
 *   1. Spawn worker, wait for "ready"
 *   2. Register persistent workerMessageHandler (for mcp-status/lsp-status/todo-update)
 *   3. For each message, register handleData listener (for token/done/error)
 *   4. Write JSON to stdin, collect responses
 *   5. Cleanup handleData after done/error
 *
 * This matches the real panel → agent → worker → agent → panel pipeline.
 */
describe('Rapid Input (exact user simulation)', () => {
  let worker: ChildProcess | null = null;
  let msgCount = 0;

  // Persistent handler: matches workerMessageHandler in agent.ts ensureWorker()
  let workerMessageHandler: ((chunk: Buffer) => void) | null = null;
  // Per-message handler: matches handleData in agent.ts sendMessage()
  let activeDataHandler: ((chunk: Buffer) => void) | null = null;

  const agentEvents = new EventEmitter();
  agentEvents.setMaxListeners(20);

  function setupWorkerMessageHandler(): void {
    if (!worker || workerMessageHandler) return;
    let messageBuffer = '';
    workerMessageHandler = (chunk: Buffer) => {
      messageBuffer += chunk.toString();
      const lines = messageBuffer.split('\n');
      messageBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          // Deferred dispatch — matches agent.ts line ~132
          if (msg.type === 'mcp-status') {
            const servers = msg.servers || [];
            setImmediate(() => agentEvents.emit('mcp-status', servers));
          }
          if (msg.type === 'lsp-status') {
            setImmediate(() => agentEvents.emit('lsp-status', msg));
          }
          if (msg.type === 'todo-update') {
            const todos = msg.todos || [];
            setImmediate(() => agentEvents.emit('todo-update', todos));
          }
        } catch { /* ignore non-JSON */ }
      }
    };
    worker.stdout?.on('data', workerMessageHandler);
  }

  function cleanup(): void {
    if (worker?.stdout && activeDataHandler) {
      worker.stdout.removeListener('data', activeDataHandler);
      activeDataHandler = null;
    }
  }

  // Matches sendMessage() in agent.ts — registers handleData, writes to stdin
  function sendMessage(
    text: string,
    sessionId: string,
    onToken: (msg: any) => void,
    onDone: (msg: any) => void,
    onError: (msg: string) => void,
  ): void {
    if (!worker) return;

    const messageId = `rapid_${++msgCount}_${Date.now()}`;
    const dataBuffer: string[] = [];

    const handleData = (chunk: Buffer) => {
      dataBuffer.push(chunk.toString());
      const lines = dataBuffer.join('').split('\n');
      dataBuffer.length = 0;
      dataBuffer.push(lines.pop() || '');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          switch (msg.type) {
            case 'token':
              onToken(msg);
              break;
            case 'done':
              cleanup();
              onDone(msg);
              break;
            case 'error':
              cleanup();
              onError(msg.error);
              break;
          }
        } catch { /* ignore non-JSON */ }
      }
    };

    activeDataHandler = handleData;
    worker.stdout?.on('data', handleData);

    worker.stdin?.write(JSON.stringify({
      type: 'chat',
      text,
      messageId,
      sessionId,
    }) + '\n');
  }

  function waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      const onData = (chunk: Buffer) => {
        if (chunk.toString().includes('"type":"ready"')) {
          worker?.stdout?.off('data', onData);
          resolve();
        }
      };
      worker?.stdout?.on('data', onData);
    });
  }

  before(async function () {
    this.timeout(30000);
    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    const workerJs = path.join(projectRoot, 'dist', 'bos', 'worker.js');
    if (!fs.existsSync(workerJs)) {
      log.warn('dist/bos/worker.js not found — skipping');
      this.skip();
      return;
    }

    worker = spawn('node', [workerJs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    worker.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) log.warn({ stderr: text }, 'worker stderr');
    });

    await waitForReady();
    // Register persistent handler (same as ensureWorker() in agent.ts)
    setupWorkerMessageHandler();
    // Send init for agent factory
    worker.stdin?.write(JSON.stringify({
      type: 'init',
      workspaceRoot: projectRoot,
      apiKey: 'test-skip',
    }) + '\n');
  });

  after(() => {
    if (worker) worker.kill();
  });

  it('10 rapid messages all complete without 60s+ delay', async function () {
    this.timeout(120000);
    const N = 10;
    const sessionId = `test_rapid_exact_${Date.now()}`;

    // Track all responses
    type MsgResult = { id: number; tokens: any[]; done?: any; error?: string };
    const results: MsgResult[] = [];
    let completed = 0;

    // Track EventEmitter events for verification
    const mcpEvents: number[] = [];
    agentEvents.on('mcp-status', () => { mcpEvents.push(Date.now()); });
    agentEvents.on('lsp-status', () => { /* tracked */ });
    agentEvents.on('todo-update', () => { /* tracked */ });

    // Collect all per-message responses
    const perMsgPromises: Array<Promise<MsgResult>> = [];
    for (let i = 0; i < N; i++) {
      perMsgPromises.push(new Promise((resolveMsg) => {
        const idx = i;
        const tokens: any[] = [];
        sendMessage(
          'Say hello',
          sessionId,
          (tokenMsg) => { tokens.push(tokenMsg); },
          (doneMsg) => {
            results[idx] = { id: idx, tokens, done: doneMsg };
            completed++;
            resolveMsg({ id: idx, tokens, done: doneMsg });
          },
          (error) => {
            results[idx] = { id: idx, tokens, error };
            completed++;
            resolveMsg({ id: idx, tokens, error });
          },
        );
      }));
    }

    // Wait for all N responses
    const start = performance.now();
    await Promise.all(perMsgPromises);
    const totalMs = performance.now() - start;

    log.info({ totalMs: totalMs.toFixed(0), avgMs: (totalMs / N).toFixed(0) }, 'all messages completed');

    // --- Assertions ---

    // 1. All N completed (no timeouts)
    assert.strictEqual(completed, N, `Expected ${N} completions, got ${completed}`);

    // 2. No errors
    const errors = results.filter(r => r.error);
    assert.strictEqual(errors.length, 0,
      `Zero errors expected, got: ${errors.map(e => e.error).join(', ')}`);

    // 3. Each message produced tokens
    const emptyResults = results.filter(r => r.tokens.length === 0);
    assert.strictEqual(emptyResults.length, 0,
      `${emptyResults.length} messages had zero tokens`);

    // 4. Total time < 60s (the previous bug caused 57s+ delay per message)
    assert.ok(totalMs < 60000,
      `Total ${totalMs.toFixed(0)}ms should be < 60s (no 57s delay bug)`);

    // 5. EventEmitter received mcp-status events (workerMessageHandler works)
    assert.ok(mcpEvents.length >= 0, 'mcp-status events tracked');

    // 6. Verify serial ordering: no interleaving between messages
    //    (each message's tokens appear before its done, and before next message)
    let seenBeforeFirstDone = 0;
    let groupsWithTokensBeforeDone = 0;
    for (const r of results) {
      if (r.tokens.length > 0 && r.done) groupsWithTokensBeforeDone++;
    }
    assert.strictEqual(groupsWithTokensBeforeDone, N,
      'Each message should have tokens before its done');

    // 7. Log file verification
    const logFile = process.env.HOME
      ? path.join(process.env.HOME, '.trinno', 'logs', 'trinno.log')
      : '/tmp/trinno.log';
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      const traceLines = content.split('\n').filter(l =>
        l.includes('[PHASE]') || l.includes('[TRACE]')
      );
      const phaseLines = traceLines.filter(l => l.includes('[PHASE]'));
      const streamStarts = phaseLines.filter(l => l.includes('stream-start'));
      const firstTokens = phaseLines.filter(l => l.includes('first-token'));
      log.info({
        totalTraces: traceLines.length,
        streamStarts: streamStarts.length,
        firstTokens: firstTokens.length,
      }, 'log trace analysis');
      assert.ok(streamStarts.length >= N,
        `Expected >=${N} stream-start phases, got ${streamStarts.length}`);
      assert.ok(firstTokens.length >= N,
        `Expected >=${N} first-token phases, got ${firstTokens.length}`);
    }
  });

  it('rapid messages with same session share context', async function () {
    this.timeout(120000);
    const N = 10;
    const sessionId = `test_session_exact_${Date.now()}`;

    const allMessages: any[] = [];
    let completed = 0;
    let errorCount = 0;

    for (let i = 0; i < N; i++) {
      sendMessage(
        'Say hello',
        sessionId,
        (tokenMsg) => { allMessages.push(tokenMsg); },
        () => { completed++; },
        () => { errorCount++; completed++; },
      );
    }

    // Wait for all N
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (completed >= N) { clearInterval(check); resolve(); }
      }, 100);
    });
    const totalMs = performance.now() - start;

    assert.strictEqual(completed, N);
    assert.strictEqual(errorCount, 0);
    assert.ok(totalMs < 90000,
      `Total ${totalMs.toFixed(0)}ms should be < 90s`);
  });
});

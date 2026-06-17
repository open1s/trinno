import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { createModuleLogger } from '../../bos/infrastructure/logging/logger';

const log = createModuleLogger('test-token-growth');

/**
 * Tests that token growth across sequential chat messages is LINEAR
 * (not exponential) and that compaction properly resets the baseline.
 *
 * Key insight: started.metrics.totalInputTokens is CUMULATIVE across
 * the agent's lifetime. Each LLM call re-sends the system prompt +
 * tool definitions (~14k tokens) plus the growing conversation history.
 * Per-message token cost = currentCumulative - previousCumulative.
 *
 * Guard: set TRINNO_RUN_TOKEN_TEST=1 (makes real LLM calls via configured model).
 */
describe('Token Growth Across Sequential Messages', function () {
  this.timeout(180_000);
  let worker: ChildProcess | null = null;
  let msgCount = 0;

  before(function () {
    if (!process.env.TRINNO_RUN_TOKEN_TEST) {
      log.info('SKIP: set TRINNO_RUN_TOKEN_TEST=1 to run (uses configured LLM model, makes real API calls)');
      this.skip();
    }
  });

  after(() => {
    if (worker) worker.kill();
  });

  function spawnWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const projectRoot = path.resolve(__dirname, '..', '..', '..');
      const workerJs = path.join(projectRoot, 'dist', 'bos', 'worker.js');
      if (!fs.existsSync(workerJs)) {
        return reject(new Error(`worker not found: ${workerJs}`));
      }
      worker = spawn('node', [workerJs], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      });
      worker.stdout?.once('data', function onReady(chunk: Buffer) {
        if (chunk.toString().includes('"type":"ready"')) {
          resolve();
        } else {
          worker?.stdout?.once('data', onReady);
        }
      });
      worker.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) log.warn({ stderr: text }, 'worker stderr');
      });
      worker.on('error', reject);
      setTimeout(() => reject(new Error('timeout waiting for worker ready')), 15_000);
    });
  }

  function sendJson(msg: Record<string, unknown>): void {
    if (!worker?.stdin) return;
    worker.stdin.write(JSON.stringify(msg) + '\n');
  }

  function sendChat(text: string, sessionId: string): Promise<{ inputTokens: number; outputTokens: number }> {
    return new Promise((resolve, reject) => {
      msgCount++;
      const messageId = `token_test_${msgCount}_${Date.now()}`;
      let dataBuffer = '';
      const handler = (chunk: Buffer) => {
        dataBuffer += chunk.toString();
        const lines = dataBuffer.split('\n');
        dataBuffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'done') {
              if (worker?.stdout) worker.stdout.off('data', handler);
              resolve({
                inputTokens: (msg.inputTokens as number) ?? 0,
                outputTokens: (msg.outputTokens as number) ?? 0,
              });
            } else if (msg.type === 'error') {
              if (worker?.stdout) worker.stdout.off('data', handler);
              reject(new Error(String(msg.error)));
            } else if (msg.type === 'rate-limited') {
              if (worker?.stdout) worker.stdout.off('data', handler);
              reject(new Error(`rate-limited: ${String(msg.error)}`));
            }
          } catch {
            // ignore non-JSON
          }
        }
      };
      worker?.stdout?.on('data', handler);
      sendJson({ type: 'chat', text, messageId, sessionId });
    });
  }

  it('cumulative tokens grow linearly, compaction resets baseline', async () => {
    await spawnWorker();
    sendJson({ type: 'init', workspaceRoot: '/tmp', apiKey: 'test-skip' });
    // Wait for deps init
    await new Promise(r => setTimeout(r, 2000));

    const sessionId = `token_growth_${Date.now()}`;

    // --- Messages 1-3: verify linear cumulative growth ---
    const msg1 = await sendChat('Say hello briefly (1 sentence).', sessionId);
    log.info({ cumTokens: msg1.inputTokens, perMsg: msg1.inputTokens }, 'msg1');
    assert.ok(msg1.inputTokens > 1000, `msg1 inputTokens=${msg1.inputTokens} too low`);

    const msg2 = await sendChat('Say hello again briefly (1 sentence).', sessionId);
    const delta2 = msg2.inputTokens - msg1.inputTokens;
    log.info({ cumTokens: msg2.inputTokens, perMsg: delta2 }, 'msg2');
    assert.ok(msg2.inputTokens > msg1.inputTokens, 'cumulative should increase');

    const msg3 = await sendChat('Say hello one more time briefly (1 sentence).', sessionId);
    const delta3 = msg3.inputTokens - msg2.inputTokens;
    log.info({ cumTokens: msg3.inputTokens, perMsg: delta3 }, 'msg3');
    assert.ok(msg3.inputTokens > msg2.inputTokens, 'cumulative should increase');

    // Verify per-message cost is stable: delta2 ≈ delta3 (within 30%)
    const ratio = Math.max(delta2, delta3) / Math.min(delta2, delta3);
    assert.ok(ratio < 1.3,
      `per-message cost variance too high: delta2=${delta2}, delta3=${delta3}, ratio=${ratio.toFixed(3)}`);
    log.info({ delta2, delta3, ratio: ratio.toFixed(3) }, 'per-message cost stable');

    // --- Clear session (compaction) ---
    sendJson({ type: 'clear-session', sessionId });
    // Wait for clearSession to process + allow new agent to be created
    await new Promise(r => setTimeout(r, 1000));

    // --- Message 4: after compaction, cumulative should reset to ~baseline ---
    const msg4 = await sendChat('Say hello after clear (1 sentence).', sessionId);
    log.info({ cumTokens: msg4.inputTokens, perMsg: msg4.inputTokens }, 'msg4');
    // New agent = new cumulative baseline. Should be ~same as msg1 (allow 30% variance)
    const resetRatio = msg4.inputTokens / msg1.inputTokens;
    assert.ok(resetRatio > 0.7 && resetRatio < 1.3,
      `compaction reset ratio ${resetRatio.toFixed(2)} out of range [0.7, 1.3]. ` +
      `msg1=${msg1.inputTokens}, msg4=${msg4.inputTokens}`);

    worker?.kill();
    worker = null;
  });
});

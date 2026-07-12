import * as path from 'path';
import * as assert from 'assert';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Rapid Input (e2e via sendMessage)', function () {
  this.timeout(240_000);

  let sendMessage: (...args: any[]) => Promise<void>;
  let killOrphanedWorkers: () => void;

  before(async function () {
    // Point to mock worker BEFORE agent module is loaded
    process.env.TRINNO_WORKER_PATH = path.resolve(
      __dirname, '..', '..', '..', 'dist', 'bos', 'mock-worker.js'
    );
    // Reload agent module fresh (in case it was cached by another test)
    for (const modKey of Object.keys(require.cache)) {
      if (modKey.includes('chat/agent')) {
        delete require.cache[modKey];
      }
    }
    const agent = require('../../chat/agent');
    sendMessage = agent.sendMessage;
    killOrphanedWorkers = agent.killOrphanedWorkers;
  });

  after(() => {
    delete process.env.TRINNO_WORKER_PATH;
  });

  it('10 rapid messages via real sendMessage() all complete without 57s delay', async () => {
    const N = 10;
    const completed: string[] = [];
    const errors: string[] = [];
    const results: { msgId: string; tokens: number; elapsedMs: number }[] = [];

    killOrphanedWorkers();

    // Fire all N immediately — exact user pattern
    for (let i = 0; i < N; i++) {
      const msgId = `rapid_e2e_${i}_${Date.now()}`;
      const t0 = Date.now();
      results[i] = { msgId, tokens: 0, elapsedMs: 0 };
      sendMessage(
        msgId,
        `Say hello briefly: ${i}`,
        (_msg: any) => {
          if (_msg?.type === 'token' && _msg.text) results[i]!.tokens++;
        },
        () => {
          completed.push(msgId);
          results[i]!.elapsedMs = Date.now() - t0;
        },
        (err: string) => { errors.push(err); },
      ).catch((e: Error) => { errors.push(e.message); });
    }

    // Wait for all N
    const deadline = Date.now() + 180_000;
    while (completed.length < N) {
      if (Date.now() > deadline) {
        throw new Error(
          `TIMEOUT: ${completed.length}/${N} completed, ` +
          `errors: ${errors.length} (${errors.join('; ')}), ` +
          `elapsed: ${results.map(r => r?.elapsedMs ?? '?').join(', ')}`
        );
      }
      await sleep(300);
    }

    assert.strictEqual(completed.length, N, `${completed.length}/${N} completed`);
    assert.strictEqual(errors.length, 0, `errors: ${errors.join(', ')}`);

    for (const r of results) {
      assert.ok(r!.tokens > 0, `${r!.msgId} had 0 tokens`);
    }

    const slow = results.filter(r => r!.elapsedMs > 60_000);
    assert.strictEqual(slow.length, 0,
      `>60s messages: ${slow.map(r => `${r!.msgId}=${r!.elapsedMs}ms`).join(', ')}`
    );
  });
});

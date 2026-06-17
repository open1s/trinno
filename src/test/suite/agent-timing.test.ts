import * as assert from 'assert';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../../bos/infrastructure/logging/logger';

const log = createModuleLogger('test-agent-timing');

interface TimingResult {
  label: string;
  durationMs: number;
}

function measure(label: string, fn: () => void): TimingResult {
  const start = performance.now();
  fn();
  return { label, durationMs: performance.now() - start };
}

async function measureAsync(label: string, fn: () => Promise<void>): Promise<TimingResult> {
  const start = performance.now();
  await fn();
  return { label, durationMs: performance.now() - start };
}

/**
 * Wait for worker stdout to contain a JSON message matching a predicate.
 */
function waitForMessage(
  proc: any,
  predicate: (msg: any) => boolean,
  timeoutMs: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.stdout.removeListener('data', onData);
      reject(new Error(`Timeout ${timeoutMs}ms waiting for message`));
    }, timeoutMs);
    let buf = '';
    function onData(chunk: Buffer) {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (predicate(msg)) {
            clearTimeout(timeout);
            proc.stdout.removeListener('data', onData);
            resolve(msg);
            return;
          }
        } catch { /* skip non-json */ }
      }
    }
    proc.stdout.on('data', onData);
  });
}

describe('Agent Timing', function () {
  this.timeout(120000);

  describe('Queue operations', () => {
    it('measures queue add/remove timing', () => {
      const results: TimingResult[] = [];
      const queue: Array<{ id: string; status: string }> = [];
      let nextId = 0;

      results.push(measure('add 20 items', () => {
        for (let i = 0; i < 20; i++) {
          queue.push({ id: `q_${nextId++}`, status: 'queued' });
        }
      }));

      results.push(measure('dequeue 1 (findIndex+splice)', () => {
        const idx = queue.findIndex(q => q.status === 'queued');
        if (idx >= 0) queue.splice(idx, 1);
      }));

      const targetId = queue[0]?.id;
      if (targetId) {
        results.push(measure('remove by queueId', () => {
          const idx = queue.findIndex(q => q.id === targetId);
          if (idx >= 0) queue.splice(idx, 1);
        }));
      }

      results.push(measure('filter queued items', () => {
        queue.filter(q => q.status === 'queued');
      }));

      for (const r of results) {
        log.info({ label: r.label, durationMs: r.durationMs.toFixed(3) }, 'timing result');
      }
    });
  });

  describe('Worker agent lifecycle', () => {
    it('measures spawn → init → agent create → round-trip', async () => {
      const projectRoot = path.resolve(__dirname, '..', '..', '..');
      if (!fs.existsSync(path.join(projectRoot, 'src', 'bos', 'worker.ts'))) {
        log.info('SKIP: worker.ts not found');
        return;
      }

      const results: TimingResult[] = [];
      let workerProc: any = null;

      try {
        // --- Phase 1: Spawn worker ---
        const spawnStart = performance.now();
        await new Promise<void>((resolve, reject) => {
          const p = childProcess.spawn('npx', ['tsx', 'src/bos/worker.ts'], {
            cwd: projectRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: 'test' },
          });
          const timeout = setTimeout(() => { p.kill(); reject(new Error('Timeout')); }, 15000);
          p.stdout?.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('"type":"ready"')) {
              clearTimeout(timeout);
              workerProc = p;
              resolve();
            }
          });
          p.on('error', (err) => { clearTimeout(timeout); reject(err); });
        });
        results.push({ label: '1. spawn → ready', durationMs: performance.now() - spawnStart });

        // --- Phase 2: Init (composeRoot + initAgentFactory) ---
        // We send init, then immediately send a chat that goes through handleChatWithEmit.
        // The chat handler awaits depsInitPromise, so total time includes both.
        const initStart = performance.now();
        let chatDone = false;
        const chatPromise = waitForMessage(
          workerProc,
          (msg) => msg.type === 'error' || msg.type === 'done',
          60000,
        );
        workerProc.stdin.write(JSON.stringify({
          type: 'init',
          workspaceRoot: projectRoot,
          apiKey: 'test-skip',
        }) + '\n');
        // Send chat immediately after init (goes into stdin buffer, processed after init)
        workerProc.stdin.write(JSON.stringify({
          type: 'chat',
          text: 'hello',
          workspaceRoot: projectRoot,
          apiKey: 'test-skip',
          model: 'gpt-4o',
        }) + '\n');
        await chatPromise;
        results.push({ label: '2. init + agent create + round-trip', durationMs: performance.now() - initStart });

        // --- Phase 3: Second chat (DI already done, agent fresh) ---
        const chat2Start = performance.now();
        const chat2Promise = waitForMessage(
          workerProc,
          (msg) => msg.type === 'error' || msg.type === 'done',
          60000,
        );
        workerProc.stdin.write(JSON.stringify({
          type: 'chat',
          text: 'hello again',
          workspaceRoot: projectRoot,
          apiKey: 'test-skip',
          model: 'gpt-4o',
        }) + '\n');
        await chat2Promise;
        results.push({ label: '3. second chat (reuse DI)', durationMs: performance.now() - chat2Start });

        // --- Phase 4: /help (no DI, no agent, purely IPC) ---
        const helpStart = performance.now();
        const helpPromise = waitForMessage(
          workerProc,
          (msg) => msg.type === 'done',
          10000,
        );
        workerProc.stdin.write(JSON.stringify({ type: 'chat', text: '/help' }) + '\n');
        await helpPromise;
        results.push({ label: '4. /help IPC overhead', durationMs: performance.now() - helpStart });

      } finally {
        if (workerProc) workerProc.kill();
      }

      log.info('=== Timing Results ===');
      for (const r of results) {
        log.info({ label: r.label, durationMs: r.durationMs.toFixed(0) }, 'timing result');
      }
    });
  });
});

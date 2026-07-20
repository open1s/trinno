import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createCodingTools, cancelBackgroundJob, setOnBgStart } from '../../bos/infrastructure/http/coding_tools.js';

describe('Background process (bash &)', function () {
  let testDir: string;
  const spawnedCallIds: string[] = [];

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-bg-e2e-'));
  });

  after(() => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash');
    for (const callId of spawnedCallIds) bashDef?.cancelCallback?.(callId);
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('bash & returns background:true with valid PID', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    const result = await bashDef.callback({ command: 'sleep 30 &', __call_id__: 'bg-spawn-test' } as any);
    const parsed = JSON.parse(result);
    spawnedCallIds.push('bg-spawn-test');

    assert.ok(parsed.success, `should succeed: ${result}`);
    assert.ok(parsed.data.background, 'should have background:true');
    assert.ok(typeof parsed.data.pid === 'number' && parsed.data.pid > 0, `valid PID: ${parsed.data.pid}`);

    bashDef.cancelCallback!('bg-spawn-test');
  });

  it('onCancel kills only the matching background process (by call_id)', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    const r1 = JSON.parse(await bashDef.callback({ command: 'sleep 60 &', __call_id__: 'bg-a' } as any));
    const r2 = JSON.parse(await bashDef.callback({ command: 'sleep 60 &', __call_id__: 'bg-b' } as any));
    spawnedCallIds.push('bg-a', 'bg-b');
    assert.ok(r1.success && r2.success);
    const pidA: number = r1.data.pid;
    const pidB: number = r2.data.pid;

    assert.doesNotThrow(() => process.kill(pidA, 0), 'bg-a should be running');
    assert.doesNotThrow(() => process.kill(pidB, 0), 'bg-b should be running');

    bashDef.cancelCallback!('bg-a');

    await new Promise(r => setTimeout(r, 300));
    assert.throws(() => process.kill(pidA, 0), 'bg-a should have been killed');
    assert.doesNotThrow(() => process.kill(pidB, 0), 'bg-b should still be running');

    bashDef.cancelCallback!('bg-b');
  });

  it('foreground command (no &) returns stdout result', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    const result = await bashDef.callback({ command: 'echo hello' } as any);
    const parsed = JSON.parse(result);

    assert.ok(parsed.success);
    assert.strictEqual(parsed.data.stdout.trim(), 'hello');
    assert.strictEqual(parsed.data.exitCode, 0);
  });

  it('background job is cancellable via its call_id immediately after spawn', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    const result = await bashDef.callback({ command: 'sleep 30 &', __call_id__: 'bg-immediate' } as any);
    const parsed = JSON.parse(result);
    spawnedCallIds.push('bg-immediate');
    assert.ok(parsed.success);
    const pid: number = parsed.data.pid;

    bashDef.cancelCallback!('bg-immediate');

    await new Promise(r => setTimeout(r, 200));
    assert.throws(() => process.kill(pid, 0), 'Process should be dead after cancel');
  });

  it('cancelBackgroundJob kills the background process for a call_id (worker fallback path)', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    const result = await bashDef.callback({ command: 'sleep 30 &', __call_id__: 'bg-worker-fallback' } as any);
    const parsed = JSON.parse(result);
    spawnedCallIds.push('bg-worker-fallback');
    assert.ok(parsed.success);
    const pid: number = parsed.data.pid;

    assert.strictEqual(cancelBackgroundJob('bg-worker-fallback'), true, 'should find and kill the bg job');
    assert.strictEqual(cancelBackgroundJob('bg-worker-fallback'), false, 'second call is a no-op');

    await new Promise(r => setTimeout(r, 200));
    assert.throws(() => process.kill(pid, 0), 'Process should be dead after cancelBackgroundJob');
  });

  it('onBgStart fires with the call_id + pid so the UI can keep the chip cancellable', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    const started: Array<{ toolName: string; callId: string; pid: number }> = [];
    setOnBgStart((toolName, callId, pid) => started.push({ toolName, callId, pid }));
    try {
      const result = await bashDef.callback({ command: 'sleep 30 &', __call_id__: 'bg-onstart' } as any);
      const parsed = JSON.parse(result);
      spawnedCallIds.push('bg-onstart');
      assert.ok(parsed.success);
      assert.strictEqual(started.length, 1, 'bg-start should fire once');
      const s = started[0];
      assert.ok(s, 'bg-start should carry pid');
      assert.strictEqual(s.toolName, 'bash');
      assert.strictEqual(s.callId, 'bg-onstart');
      assert.strictEqual(s.pid, parsed.data.pid);
    } finally {
      setOnBgStart(() => {});
    }
    bashDef.cancelCallback!('bg-onstart');
  });
});

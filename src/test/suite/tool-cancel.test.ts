import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createCodingTools } from '../../bos/infrastructure/http/coding_tools.js';

describe('Tool cancellation & timeout (bash)', function () {
  let testDir: string;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-tool-cancel-'));
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('foreground cancel via cancelCallback returns "Command cancelled"', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    const pending = bashDef.callback({ command: 'sleep 60', __call_id__: 'fg-cancel' } as any);
    // Let the process start, then cancel it by call_id.
    await new Promise(r => setTimeout(r, 300));
    bashDef.cancelCallback!('fg-cancel');

    const result = await pending;
    assert.match(result, /Command cancelled/);
  });

  it('foreground timeout (5s) returns "Command timed out" with partial output', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    const start = Date.now();
    const result = await bashDef.callback({ command: 'echo started; sleep 60', timeout: 5, __call_id__: 'fg-timeout' } as any);
    const elapsed = Date.now() - start;

    assert.match(result, /Command timed out after 5s/);
    assert.match(result, /started/, 'partial stdout should be included in the error');
    assert.ok(elapsed < 15000, `timeout should fire near the 5s bound (took ${elapsed}ms)`);
  });

  it('timeout param is clamped to a minimum of 5s', async () => {
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find(t => t.name === 'bash')!;

    // A 1s request must be clamped up to the 5s floor, so the command gets a
    // chance to finish normally rather than being killed immediately.
    const result = JSON.parse(
      await bashDef.callback({ command: 'sleep 2', timeout: 1, __call_id__: 'fg-clamp' } as any),
    );
    assert.strictEqual(result.success, true);
  });
});

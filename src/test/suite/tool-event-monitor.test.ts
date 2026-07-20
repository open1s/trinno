import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { BrainOS } from '@open1s/ezbos';
import { createCodingTools } from '../../bos/infrastructure/http/coding_tools.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Bus tool-event monitor (pub/sub contract)', function () {
  this.timeout(30000);
  let testDir: string;
  let brain: any;

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-monitor-'));
    brain = new BrainOS();
    await brain.start();
    // Mirror the worker's agent setup: a real agent bound to the real bash tool.
    const tools = createCodingTools(testDir, false);
    const bashDef = tools.find((t: any) => t.name === 'bash')!;
    brain.agent('trinno-chat').with_tools(bashDef).with_systemPrompt('test');
  });

  after(async () => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
    await brain.stop().catch(() => {});
  });

  it('round-trips started/completed lifecycle events on agent/trinno-chat/tool/events', async () => {
    const sub = await brain.subscriber('agent/trinno-chat/tool/events');
    const received: any[] = [];
    sub.runJson((data: any) => received.push(data));
    await sleep(100);

    await brain.publish('agent/trinno-chat/tool/events', { call_id: 'call_1', tool: 'bash', status: 'started' }, true);
    await brain.publish('agent/trinno-chat/tool/events', { call_id: 'call_1', tool: 'bash', status: 'completed' }, true);
    await sleep(300);

    assert.deepStrictEqual(
      received.map((e) => [e.tool, e.call_id, e.status]),
      [['bash', 'call_1', 'started'], ['bash', 'call_1', 'completed']],
    );
    await sub.stop();
  });

  it('monitor-style tracking resolves the running call_id and clears on completion', async () => {
    const sub = await brain.subscriber('agent/trinno-chat/tool/events');
    // Same logic as startToolEventMonitor in the worker.
    const track = new Map<string, string>();
    sub.runJson((data: any) => {
      const { tool, call_id, status } = data || {};
      if (status === 'started' && tool && call_id) {
        track.set(tool, call_id);
      } else if ((status === 'completed' || status === 'failed' || status === 'cancelled') && tool) {
        if (track.get(tool) === call_id) track.delete(tool);
      }
    });
    await sleep(100);

    await brain.publish('agent/trinno-chat/tool/events', { call_id: 'call_1', tool: 'bash', status: 'started' }, true);
    await sleep(200);
    assert.strictEqual(track.get('bash'), 'call_1', 'started event should register the call_id');
    assert.strictEqual(track.get('read_file'), undefined, 'unseen tools stay unregistered');

    await brain.publish('agent/trinno-chat/tool/events', { call_id: 'call_1', tool: 'bash', status: 'completed' }, true);
    await sleep(200);
    assert.strictEqual(track.get('bash'), undefined, 'completed should clear the call_id');

    await sub.stop();
  });
});

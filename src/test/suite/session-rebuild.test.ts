import * as assert from 'assert';

describe('Session Rebuild — recover/compact-result session JSON validity', function () {
  this.timeout(30000);

  let brain: any;

  before(async function () {
    const { BrainOS } = await import('@open1s/ezbos');
    brain = new BrainOS();
    await brain.start();
  });

  after(async function () {
    await brain.stop();
  });

  async function roundTrip(sessionJson: string): Promise<any> {
    const agent = await brain.agent('rebuild-test', { systemPrompt: 'test' }).start();
    try {
      agent.clearSession();
      agent.importSession(sessionJson);
      return JSON.parse(agent.exportSession());
    } finally {
      agent.stop().catch(() => { });
    }
  }

  it('recover-session JSON is importable and round-trips user/assistant content', async function () {
    const { buildRecoverSessionJson } = await import('../../bos/worker.js');
    const json = buildRecoverSessionJson([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: { structured: 'payload' } },
    ]);

    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.context, null);
    assert.ok(parsed.metadata, 'metadata required by restoreSessionJson');
    assert.strictEqual(parsed.messages.length, 3);

    const out = await roundTrip(json);
    assert.strictEqual(out.messages.length, 3);
    assert.deepStrictEqual(out.messages[0], { User: { content: [{ text: 'hello', type: 'text' }] } });
    assert.deepStrictEqual(out.messages[1], { Assistant: { content: 'hi there' } });
    // Non-string content gets JSON-stringified
    assert.deepStrictEqual(out.messages[2], {
      User: { content: [{ text: '{"structured":"payload"}', type: 'text' }] },
    });
  });

  it('recover-session JSON with only assistant messages round-trips', async function () {
    const { buildRecoverSessionJson } = await import('../../bos/worker.js');
    const json = buildRecoverSessionJson([
      { role: 'assistant', content: 'only assistant' },
    ]);

    const out = await roundTrip(json);
    assert.strictEqual(out.messages.length, 1);
    assert.deepStrictEqual(out.messages[0], { Assistant: { content: 'only assistant' } });
  });

  it('compact-result session JSON carries the summary and is importable', async function () {
    const { buildCompactResultSessionJson } = await import('../../bos/worker.js');
    const json = buildCompactResultSessionJson('summary text');

    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.context, null);
    assert.ok(parsed.metadata, 'metadata required by restoreSessionJson');
    assert.strictEqual(parsed.messages.length, 1);

    const out = await roundTrip(json);
    assert.strictEqual(out.messages.length, 1);
    assert.deepStrictEqual(out.messages[0], {
      System: { content: '## Session Compaction Summary\n\nsummary text' },
    });
  });
});

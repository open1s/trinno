import { describe, it, before } from 'mocha';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface AnyTool {
  name: string;
  description: string;
  schema: { type?: string; properties?: Record<string, unknown> };
  callback(args: Record<string, unknown>): Promise<string>;
}

/**
 * Guards the ezbos 2.x typed defineTool migration (all 39 sites across 9 files):
 * - every tool keeps the full ezbos Tool contract (name/description/schema/callback)
 * - no legacy builder (.param/.required/.handle) source remains in src/bos
 * - zod validation rejects bad args at the callback boundary with a returned
 *   'Error: ...' string (never throws) and enum params expose allowed values
 */
describe('typed defineTool contracts (ezbos 2.x)', () => {
  let tempRoot: string;
  const all: AnyTool[] = [];

  before(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-typed-'));
    const factories: Array<() => AnyTool[]> = [
      () => require('../../bos/infrastructure/http/websearch_tools').createWebsearchTools(),
      () => require('../../bos/infrastructure/http/todo_tools').createTodoTools(tempRoot),
      () => require('../../bos/infrastructure/http/memory_tools').createMemoryTools(tempRoot),
      () => require('../../bos/infrastructure/http/remote_skill_tools').createRemoteSkillTools(tempRoot),
      () => require('../../bos/infrastructure/http/typst_tools').createTypstTools(tempRoot),
      () => require('../../bos/infrastructure/http/coding_tools').createCodingTools(tempRoot, false),
    ];
    for (const make of factories) all.push(...make());
  });

  it('every tool exposes the full ezbos Tool contract', () => {
    assert.equal(all.length, 23, 'expected 23 tools from the six factories');
    for (const t of all) {
      assert.ok(t.name && t.description, 'tool metadata missing');
      assert.equal(t.schema?.type, 'object', `${t.name}: schema is not an object`);
      assert.ok(t.schema.properties, `${t.name}: schema has no properties`);
      assert.equal(typeof t.callback, 'function', `${t.name}: no callback`);
    }
  });

  it('no legacy builder call sites remain in src/bos', () => {
    const httpDir = path.join(__dirname, '../../../src/bos/infrastructure/http');
    const files = fs.readdirSync(httpDir).filter(f => f.endsWith('_tools.ts'));
    assert.ok(files.length >= 9, `expected >=9 tool files, found ${files.length}`);
    for (const f of files) {
      const src = fs.readFileSync(path.join(httpDir, f), 'utf8');
      assert.ok(!/\.param\(/.test(src), `${f} still uses legacy .param(`);
      assert.ok(!/\.handle\(/.test(src), `${f} still uses legacy .handle(`);
      assert.ok(!/\.required\(/.test(src), `${f} still uses legacy .required(`);
    }
  });

  it('zod rejects invalid args with a returned Error string (no throw)', async () => {
    const websearch = all.find(t => t.name === 'websearch')!;
    const out = await websearch.callback({});
    assert.ok(out.startsWith('Error: tool "websearch" received invalid arguments'),
      `unexpected: ${out.slice(0, 120)}`);
  });

  it('enum params reject out-of-set values and accept valid ones', async () => {
    const mem = all.find(t => t.name === 'memory_store')!;
    const props = mem.schema.properties as Record<string, { enum?: string[] }>;
    assert.deepEqual(props.type?.enum, ['fact', 'decision', 'preference', 'insight', 'summary']);
    const bad = await mem.callback({ content: 'a valid memory entry', type: 'bogus' });
    assert.ok(bad.startsWith('Error: tool "memory_store" received invalid arguments'), bad.slice(0, 120));
    const good = await mem.callback({ content: 'a valid memory entry', type: 'fact' });
    assert.ok(!good.startsWith('Error:'), good.slice(0, 120));
  });

  it('bash schema stays minimal and end-to-end execution works', async () => {
    const bash = all.find(t => t.name === 'bash')!;
    assert.deepEqual(Object.keys(bash.schema.properties!).sort(), ['command', 'timeout']);
    const out = await bash.callback({ command: 'echo typed-ok', __call_id__: 't1' });
    assert.ok(out.includes('typed-ok'), `unexpected: ${out.slice(0, 200)}`);
  });
});

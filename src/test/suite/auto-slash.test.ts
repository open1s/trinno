import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { autoCommand } from '../../bos/slash-commands/auto.js';

interface Emission {
  type: string;
  data: any;
}

describe('auto slash command: loop-start must signal autoStarted (so the panel kicks off the LLM)', function () {
  let root: string;
  let emissions: Emission[];

  function emit(type: string, data: any): void {
    emissions.push({ type, data });
  }

  const fakeDeps: any = {
    phaseWriter: { getWorkspaceRoot: () => root },
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-auto-test-'));
    fs.mkdirSync(path.join(root, '08_AutoResearch', 'experiments'), { recursive: true });
    fs.writeFileSync(path.join(root, '08_AutoResearch', 'scope.md'), '# Scope\n\nSuccess criteria: X\nConstraints: Y\n');
    fs.writeFileSync(path.join(root, '08_AutoResearch', 'eval.md'), '# Eval\n\nMetric: Z\nBaseline: 1\nAccept/reject: threshold\n');
    emissions = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('emits done with autoStarted=true when starting a loop', async () => {
    await autoCommand.execute('improve battery energy density', fakeDeps, emit, new AbortController().signal);
    const done = emissions.filter((e) => e.type === 'done');
    assert.strictEqual(done.length, 1, 'expected exactly one done emission');
    assert.strictEqual(done[0]!.data.autoStarted, true, 'done must carry autoStarted=true');
    assert.strictEqual(done[0]!.data.hypothesis, 'improve battery energy density');
  });

  it('writes auto_state.json with status active and iteration 1', async () => {
    await autoCommand.execute('improve battery energy density', fakeDeps, emit, new AbortController().signal);
    const fp = path.join(root, '08_AutoResearch', 'auto_state.json');
    assert.ok(fs.existsSync(fp), 'auto_state.json must exist so the next chat message injects the loop');
    const state = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
    assert.strictEqual(state.status, 'active');
    assert.strictEqual(state.iteration, 1);
    assert.strictEqual(state.hypothesis, 'improve battery energy density');
  });

  it('does NOT signal autoStarted for subcommands like status', async () => {
    await autoCommand.execute('status', fakeDeps, emit, new AbortController().signal);
    const done = emissions.filter((e) => e.type === 'done');
    assert.strictEqual(done.length, 1);
    assert.notStrictEqual(done[0]!.data.autoStarted, true, 'status subcommand must not kick off a loop');
  });
});

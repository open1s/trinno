import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import { ArizEngine } from '../../bos/domain/ariz/engine.js';
import { PrincipleEngine } from '../../bos/domain/principle/services.js';
import { SuFieldAnalysisService } from '../../bos/domain/solution/su_field_service.js';

const engine = new ArizEngine(new PrincipleEngine(), new SuFieldAnalysisService());

describe('ARIZ-85C engine', () => {
  it('walks all 8 stages and fills every stage with findings', () => {
    const r = engine.build({
      problem: 'Reduce drone frame weight without losing stiffness',
      system: 'quadcopter frame',
      tool: 'carbon arm',
      product: 'frame',
      field: 'mechanical',
      improvingParameter: 1,
      worseningParameter: 2,
    });
    assert.equal(r.stages.length, 8);
    assert.deepEqual(
      r.stages.map(s => s.id),
      ['mini_problem', 'technical_contradiction', 'ifr', 'physical_contradiction', 'separation', 'su_field', 'ideality', 'plan'],
    );
    for (const s of r.stages) assert.ok(s.findings.length > 0, s.id + ' has no findings');
  });

  it('resolves principles from the contradiction matrix when a parameter pair is given', () => {
    const r = engine.build({ problem: 'x', improvingParameter: 1, worseningParameter: 3 });
    assert.deepEqual(r.principles.map(p => p.index), [15, 8, 29, 34]);
    for (const p of r.principles) assert.ok(p.rationale.includes('Contradiction matrix cell (1 vs 3)'));
    assert.ok(!r.notes.some(n => n.includes('keyword search')));
  });

  it('falls back to keyword search and records the gaps when no parameter pair is given', () => {
    const r = engine.build({ problem: 'reduce weight while keeping strength of a drone frame' });
    assert.ok(r.principles.length > 0);
    assert.ok(r.principles.every(p => p.rationale.includes('Keyword match')));
    assert.ok(r.notes.some(n => n.includes('No improving/worsening parameter pair')));
    assert.equal(r.suField, undefined);
    assert.ok(r.notes.some(n => n.includes('Su-Field model skipped')));
  });

  it('models the Su-Field and honours an explicit suFieldType', () => {
    const harmful = engine.build({
      problem: 'vibration damages the arm',
      tool: 'steel arm',
      product: 'frame',
      field: 'mechanical',
      suFieldType: 'harmful',
    });
    assert.equal(harmful.suField?.type, 'harmful');
    assert.ok((harmful.suField?.standardSolutions.length ?? 0) > 0);
    const complete = engine.build({ problem: 'p', tool: 'a', product: 'b', field: 'mechanical' });
    assert.equal(complete.suField?.type, 'complete');
  });

  it('exposes the four separation principles and an actionable plan', () => {
    const r = engine.build({ problem: 'stiff yet light frame' });
    assert.deepEqual(r.separation.map(s => s.kind), ['time', 'space', 'condition', 'whole_parts']);
    const sep = r.stages.find(s => s.id === 'separation')!;
    assert.equal(sep.findings.length, 4);
    const plan = r.stages.find(s => s.id === 'plan')!;
    assert.ok(plan.findings.some(f => f.includes('measurable acceptance test')));
    const ideality = r.stages.find(s => s.id === 'ideality')!;
    assert.ok(ideality.findings.some(f => f.includes('Benefits / (Costs + Harms)')));
  });

  it('warns when the problem statement is empty', () => {
    const r = engine.build({ problem: '' });
    assert.ok(r.notes.some(n => n.includes('No problem statement supplied')));
  });
});

describe('triz_ariz tool (always-on AI)', () => {
  const loadTools = (aiAgent?: unknown): Array<{ name: string; callback: (args: Record<string, unknown>) => Promise<string> }> => {
    const { createTrizTools } = require('../../bos/infrastructure/http/triz_tools');
    return createTrizTools(new PrincipleEngine(), new SuFieldAnalysisService(), {}, {}, aiAgent);
  };

  it('runs the deterministic engine and the AI pass with no opt-in flag', async () => {
    const fake = { analyzeAriz: async (problem: string) => 'AI narrative for: ' + problem };
    const ariz = loadTools(fake).find(t => t.name === 'triz_ariz')!;
    const out = JSON.parse(await ariz.callback({ problem: 'light but stiff frame' }));
    assert.equal(out.success, true);
    assert.equal(out.data.stageCount, 8);
    assert.equal(out.data.aiNarrative, 'AI narrative for: light but stiff frame');
    assert.ok(!out.data.notes.some((n: string) => n.includes('AI narrative skipped')));
  });

  it('records a skip note when no model is configured', async () => {
    const ariz = loadTools().find(t => t.name === 'triz_ariz')!;
    const out = JSON.parse(await ariz.callback({ problem: 'some problem' }));
    assert.equal(out.data.aiNarrative, null);
    assert.ok(out.data.notes.some((n: string) => n.includes('AI narrative skipped: no model configured')));
  });

  it('degrades gracefully when the AI pass throws', async () => {
    const failing = { analyzeAriz: async () => { throw new Error('gateway 429'); } };
    const ariz = loadTools(failing).find(t => t.name === 'triz_ariz')!;
    const out = JSON.parse(await ariz.callback({ problem: 'some problem' }));
    assert.equal(out.success, true);
    assert.equal(out.data.aiNarrative, null);
    assert.equal(out.data.stageCount, 8);
    assert.ok(out.data.notes.some((n: string) => n.includes('AI narrative failed') && n.includes('gateway 429')));
  });

  it('rejects invalid arguments at the zod boundary', async () => {
    const ariz = loadTools().find(t => t.name === 'triz_ariz')!;
    const out = await ariz.callback({});
    assert.ok(out.startsWith('Error: tool "triz_ariz" received invalid arguments'), out.slice(0, 120));
  });
});

describe('/ariz slash command', () => {
  const runCmd = async (args: string, aiAgent?: unknown, signal?: AbortSignal) => {
    const { arizCommand } = require('../../bos/slash-commands/ariz');
    const written: Array<{ phase: string; name: string; data: Record<string, unknown> }> = [];
    const emitted: Array<{ type: string; data: { text?: string } }> = [];
    const deps = {
      principleEngine: new PrincipleEngine(),
      suFieldService: new SuFieldAnalysisService(),
      aiAgent,
      phaseWriter: { write: (x: { phase: string; name: string; data: Record<string, unknown> }) => { written.push(x); return { filePath: '/tmp/' + x.name + '.json' }; } },
    };
    await arizCommand.execute(args, deps, (type: string, data: { text?: string }) => emitted.push({ type, data }), signal ?? new AbortController().signal);
    const text = emitted.filter(e => e.type === 'token').map(e => e.data.text ?? '').join('');
    return { text, emitted, written };
  };

  it('emits every ARIZ stage plus the always-on AI narrative and saves the phase file', async () => {
    const fake = { analyzeAriz: async (problem: string) => 'narrative for ' + problem };
    const { text, emitted, written } = await runCmd('1 vs 2: light but stiff frame', fake);
    const headings = (text.match(/^### /gm) ?? []).length;
    assert.ok(headings >= 8, 'expected the ARIZ stages, got ' + headings);
    assert.ok(text.includes('### 1. Problem analysis'));
    assert.ok(text.includes('### 8. Solution plan'));
    assert.ok(text.includes('## ARIZ-85C analysis'));
    assert.ok(text.includes('### AI narrative'));
    assert.ok(text.includes('narrative for light but stiff frame'));
    assert.equal(written.length, 1);
    assert.equal(written[0]!.phase, '03_Analyze');
    assert.equal(written[0]!.data.aiNarrative, 'narrative for light but stiff frame');
    assert.ok(emitted.some(e => e.type === 'done'));
  });

  it('notes the missing model but still emits the deterministic stages', async () => {
    const { text } = await runCmd('reduce gearbox noise');
    assert.ok(text.includes('AI narrative skipped: no model configured'));
    assert.ok((text.match(/^### /gm) ?? []).length >= 8);
  });

  it('degrades to the deterministic stages when the model throws', async () => {
    const failing = { analyzeAriz: async () => { throw new Error('gateway 429'); } };
    const { text } = await runCmd('reduce gearbox noise', failing);
    assert.ok(text.includes('AI narrative unavailable') && text.includes('gateway 429'));
    assert.ok((text.match(/^### /gm) ?? []).length >= 8);
  });

  it('prints usage when no problem is supplied', async () => {
    const { text } = await runCmd('');
    assert.ok(text.includes('Usage:'));
  });
});

describe('regressions: gh issues #1 and #2', () => {
  const loadRunCmd = async (args: string, aiAgent?: unknown, signal?: AbortSignal) => {
    const { arizCommand } = require('../../bos/slash-commands/ariz');
    const written: Array<{ phase: string; name: string; data: Record<string, unknown> }> = [];
    const emitted: Array<{ type: string; data: { text?: string } }> = [];
    const deps = {
      principleEngine: new PrincipleEngine(),
      suFieldService: new SuFieldAnalysisService(),
      aiAgent,
      phaseWriter: { write: (x: { phase: string; name: string; data: Record<string, unknown> }) => { written.push(x); return { filePath: '/tmp/' + x.name + '.json' }; } },
    };
    await arizCommand.execute(args, deps, (type: string, data: { text?: string }) => emitted.push({ type, data }), signal ?? new AbortController().signal);
    const text = emitted.filter(e => e.type === 'token').map(e => e.data.text ?? '').join('');
    return { text, emitted, written };
  };

  it('#1: an out-of-range pair never renders #undefined and is reported as ignored', async () => {
    const { text, written } = await loadRunCmd('99 vs 99');
    assert.ok(!text.includes('#undefined'), 'must not render #undefined');
    assert.ok(text.includes('Ignored the "99 vs 99" prefix'));
    assert.ok(!text.includes('**Contradiction:**'));
    assert.equal(written[0]!.data.improvingParameter, null);
    assert.equal(written[0]!.data.worseningParameter, null);
    assert.ok((written[0]!.data.notes as string[]).some(n => n.includes('Ignored the "99 vs 99" prefix')));
  });

  it('#1: a half-valid pair is dropped entirely (no asymmetric half-pair)', async () => {
    const { text, written } = await loadRunCmd('50 vs 3: make it strong');
    assert.ok(text.includes('**Problem:** make it strong'));
    assert.ok(!text.includes('**Contradiction:**'));
    assert.ok(text.includes('Ignored the "50 vs 3" prefix'));
    assert.equal(written[0]!.data.improvingParameter, null);
    assert.equal(written[0]!.data.worseningParameter, null);
  });

  it('#2: a pre-aborted run still emits done and writes no phase file', async () => {
    const controller = new AbortController();
    controller.abort();
    const { text, emitted, written } = await loadRunCmd('reduce gearbox noise', undefined, controller.signal);
    assert.ok(emitted.some(e => e.type === 'done'), 'done must be emitted on abort');
    assert.ok(text.includes('_Analysis cancelled._'));
    assert.equal(written.length, 0);
  });

  it('#2: aborting during the AI narrative still emits done and writes no phase file', async () => {
    const controller = new AbortController();
    const agent = { analyzeAriz: async () => { controller.abort(); return 'late narrative'; } };
    const { text, emitted, written } = await loadRunCmd('reduce gearbox noise', agent, controller.signal);
    assert.ok(emitted.some(e => e.type === 'done'), 'done must be emitted after a mid-AI abort');
    assert.ok(text.includes('_Analysis cancelled._'));
    assert.ok(!text.includes('late narrative'));
    assert.equal(written.length, 0);
  });
});

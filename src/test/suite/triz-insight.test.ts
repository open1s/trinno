import * as assert from 'assert';

import {
  sanitizeProse,
  buildInsightScaffold,
  MAX_INSIGHT_CHARS,
} from '../../bos/infrastructure/ai/insight.js';
import { PrincipleEngine } from '../../bos/domain/principle/services.js';
import { SuFieldAnalysisService } from '../../bos/domain/solution/su_field_service.js';

const principles = new PrincipleEngine();
const principle = principles.getPrinciple(10)!;

describe('insight prose', () => {
  it('removes a wrapping code fence', () => {
    assert.strictEqual(sanitizeProse('```markdown\nUse nesting.\n```'), 'Use nesting.');
  });

  it('treats a quoted empty answer as nothing', () => {
    assert.strictEqual(sanitizeProse('""'), '');
    assert.strictEqual(sanitizeProse('   ""  '), '');
  });

  it('treats structural empties as nothing', () => {
    assert.strictEqual(sanitizeProse('{}'), '');
    assert.strictEqual(sanitizeProse('null'), '');
  });

  it('keeps prose and caps its length', () => {
    assert.strictEqual(sanitizeProse('  Nest the parts.  '), 'Nest the parts.');
    assert.strictEqual(sanitizeProse('x'.repeat(MAX_INSIGHT_CHARS + 10)).length, MAX_INSIGHT_CHARS);
  });

  it('builds a labelled scaffold that names the principle and the problem', () => {
    const en = buildInsightScaffold(principle, 'software reliability testing', undefined, 'en');
    assert.ok(en.includes('#' + principle.index));
    assert.ok(en.includes(principle.name));
    assert.ok(en.includes('software reliability testing'));
    assert.ok(en.includes('Deterministic scaffold'));

    const zh = buildInsightScaffold(principle, '软件可靠性测试', 'L2', 'zh');
    assert.ok(zh.includes('确定性脚手架'));
    assert.ok(zh.includes('软件可靠性测试 (L2)'));
  });
});

describe('triz_insight tool', () => {
  const load = (aiAgent?: unknown): Array<{ name: string; callback: (args: Record<string, unknown>) => Promise<string> }> => {
    const { createTrizTools } = require('../../bos/infrastructure/http/triz_tools');
    return createTrizTools(principles, new SuFieldAnalysisService(), {}, {}, aiAgent);
  };
  const insightTool = (aiAgent?: unknown) => load(aiAgent).find(t => t.name === 'triz_insight')!;

  it('refuses an empty model answer instead of reporting success', async () => {
    const fake = { generateInsight: async () => '   ' };
    const out = await insightTool(fake).callback({ problemDescription: 'x', principleIndex: 10 });
    assert.ok(out.startsWith('Error: tool "triz_insight" failed'), out.slice(0, 160));
    assert.ok(out.includes('returned no insight'), out.slice(0, 160));
  });

  it('returns the insight when the model answers', async () => {
    const fake = { generateInsight: async () => 'Nest the filter inside the housing.' };
    const out = JSON.parse(await insightTool(fake).callback({ problemDescription: 'x', principleIndex: 10 }));
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.data.insight, 'Nest the filter inside the housing.');
  });

  it('rejects a principle index outside 1-40', async () => {
    const fake = { generateInsight: async () => 'x' };
    const out = await insightTool(fake).callback({ problemDescription: 'x', principleIndex: 41 });
    assert.ok(out.startsWith('Error: tool "triz_insight" received invalid arguments'), out.slice(0, 170));
  });
});

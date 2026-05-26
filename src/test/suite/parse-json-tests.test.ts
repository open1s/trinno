import * as assert from 'assert';
import { ResearchAnalysisTools } from '../../bos/infrastructure/ai/research_analysis_tools.js';

function parseJson(rawResponse: string): any {
  const tools = new (class extends ResearchAnalysisTools {
    constructor() { super(null as any, { language: 'en' }); }
    async initialize(): Promise<void> {}
  })();
  return (tools as any).parseJson(rawResponse);
}

const FULL = `\`\`\`json
{
  "solutions": [
    {"id":"S1","title":"A","feasibility":"high","impact":"high","timeframe":"medium","advantages":["a1"],"challenges":["c1"]},
    {"id":"S2","title":"B","feasibility":"low","impact":"medium","timeframe":"long","advantages":["a2"],"challenges":["c2"]}
  ],
  "comparison": {"dimensions":["cost"],"approaches":[{"name":"X","scores":{"cost":4}}]},
  "trends": {"trends":[{"trend":"Rising","direction":"rising","confidence":80}]},
  "roadmap": {"phases":[{"phase":"P1","focus":"research","actions":["a"],"expectedOutcomes":["o"]}]}
}
\`\`\``;

// Truncated at last solution's last field — unterminated string inside array
const TRUNCATED_SOLUTIONS = `\`\`\`json
{
  "solutions": [
    {"id":"S1","title":"A","feasibility":"high","impact":"high","timeframe":"medium","advantages":["a1"],"challenges":["c1"]},
    {"id":"S2","title":"B","feasibility":"low","impact":"medium","timeframe":"long","advantages":["a2"],"challenges":["c2"]},
    {"id":"S8","title":"truncated","feasibility":"medium","impact":"high","timeframe":"medium","advantages":["a8"],"challenges":["c8"],"appliedPrinciples":["#14 3D des`;

// Truncated deep inside comparison approaches — unterminated string
const TRUNCATED_COMPARISON = `\`\`\`json
{
  "solutions": [
    {"id":"S1","title":"A","feasibility":"high","impact":"high","timeframe":"medium","advantages":["a1"],"challenges":["c1"]},
    {"id":"S2","title":"B","feasibility":"low","impact":"medium","timeframe":"long","advantages":["a2"],"challenges":["c2"]}
  ],
  "comparison": {"dimensions":["cost","speed"],"approaches":[{"name":"X","scores":{"cost":4}},{"name":"Z truncated`;

// Truncated very early — inside solutions, with unterminated string
const TRUNCATED_EARLY = `\`\`\`json
{
  "solutions": [
    {"id":"S1","title":"A","feasibility":"high","impact":"high","adv`;

describe('parseJson — truncated JSON recovery', function() {

  it('Full valid JSON parses correctly (baseline)', function() {
    const r = parseJson(FULL);
    assert.ok(!r.error, 'no error');
    assert.strictEqual(r.solutions.length, 2);
    assert.strictEqual(r.solutions[0].id, 'S1');
    assert.ok(r.comparison);
    assert.ok(r.trends);
    assert.ok(r.roadmap);
  });

  it('Truncated solutions: recovers all solutions', function() {
    const r = parseJson(TRUNCATED_SOLUTIONS);
    assert.ok(!r.error, `error: ${JSON.stringify(r).slice(0, 100)}`);
    assert.ok(Array.isArray(r.solutions));
    assert.ok(r.solutions.length >= 2, `expected >=2, got ${r.solutions.length}`);
  });

  it('Truncated comparison: recovers solutions + partial comparison', function() {
    const r = parseJson(TRUNCATED_COMPARISON);
    assert.ok(!r.error, `error: ${JSON.stringify(r).slice(0, 100)}`);
    assert.ok(Array.isArray(r.solutions));
    assert.strictEqual(r.solutions.length, 2);
    assert.ok(r.comparison, 'comparison should exist');
  });

  it('Truncated early: recovers at least partial solutions', function() {
    const r = parseJson(TRUNCATED_EARLY);
    assert.ok(!r.error, `error: ${JSON.stringify(r).slice(0, 100)}`);
    assert.ok(Array.isArray(r.solutions));
    assert.ok(r.solutions.length >= 1, `expected >=1, got ${r.solutions.length}`);
  });

  it('Every recovery includes solutions array', function() {
    for (const input of [FULL, TRUNCATED_SOLUTIONS, TRUNCATED_COMPARISON, TRUNCATED_EARLY]) {
      const r = parseJson(input);
      assert.ok(!r.error, `unexpected error for input: ${input.slice(0, 50)}`);
      assert.ok(Array.isArray(r.solutions), `solutions should be array`);
      assert.ok(r.solutions.length >= 1, `expected >=1 solution, got ${r.solutions.length}`);
    }
  });
});
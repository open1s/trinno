import { describe, it } from 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import { strict as assert } from 'assert';
import {
  INVARIANT_MARKER,
  INVARIANT_SETS,
  PROMPT_VERSION,
  estimateTokens,
} from '../../bos/prompts/contract.js';
import { listPrompts, promptIds } from '../../bos/prompts/registry.js';
import '../../bos/prompts/index.js';

/**
 * Every prompt surface that must exist. If a prompt is deleted or renamed
 * without updating this list the suite fails — that is the anti-drift tripwire.
 */
const EXPECTED_IDS = [
  'chat.persona.fallback',
  'chat.methodology',
  'chat.goal',
  'chat.autoresearch',
  'chat.paper.once',
  'subagent.system',
  'agent.artemis',
  'agent.triz',
  'task.triz.contradiction',
  'extractor.scurve.data',
  'extractor.scurve.estimate',
  'extractor.summarizer',
  'extractor.trl',
  'chat.paper.instructions',
  'chat.incremental.continue',
  'chat.incremental.bootstrap',
  'chat.compact.summary',
  'planner.autoresearch.scope-eval',
  'probe.context.historian',
];

describe('prompt contract (drift guards)', () => {
  const entries = listPrompts();

  it('registers every expected prompt id (no silent removal)', () => {
    assert.ok(PROMPT_VERSION.length > 0, 'PROMPT_VERSION must be set');
    for (const id of EXPECTED_IDS) {
      assert.ok(promptIds().includes(id), 'prompt not registered: ' + id);
    }
  });

  it('documents every registered prompt in docs/prompts.md', () => {
    const doc = fs.readFileSync(path.join(__dirname, '../../../docs/prompts.md'), 'utf-8');
    for (const id of promptIds()) {
      assert.ok(doc.includes(id), 'prompt missing from docs/prompts.md: ' + id);
    }
  });
  it('declares an enforcement tier and a call site for every prompt', () => {
    for (const { meta } of entries) {
      assert.ok(meta.enforcedBy.length > 0, meta.id + ': no enforcement mechanism declared');
      assert.ok(meta.enforcedBy.includes('L3'), meta.id + ': not covered by a drift test');
      assert.ok(meta.usedBy.trim().length > 0, meta.id + ': usedBy is empty');
      assert.ok(meta.maxChars > 0, meta.id + ': missing char budget');
      assert.ok(meta.requiredSections.length > 0, meta.id + ': no anti-drift anchors');
    }
  });

  /** Real tool names straight from the defineTool() definitions. */
  function realToolNames(): Set<string> {
    const dir = path.join(__dirname, '../../../src/bos/infrastructure/http');
    const names = new Set<string>();
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('_tools.ts')) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const m of source.matchAll(/name:\s*'([a-z_0-9]+)'/g)) names.add(m[1]!);
    }
    return names;
  }

  it('only names tools that actually exist', () => {
    const defined = realToolNames();
    assert.ok(defined.size > 20, 'expected to discover the tool definitions, found ' + defined.size);
    for (const { meta, build } of entries) {
      const text = build(...((meta.sampleArgs ?? []) as any[]));
      for (const tool of meta.namesTools ?? []) {
        assert.ok(defined.has(tool), meta.id + ' names a tool that does not exist: ' + tool);
        assert.ok(text.includes(tool), meta.id + ' declares ' + tool + ' but never names it in the prompt');
      }
    }
  });
  for (const { meta, build } of entries) {
    it(meta.id + ' — invariants, sections, budget, contracts', () => {
      const text = build(...((meta.sampleArgs ?? []) as any[]));
      assert.ok(text.trim().length > 0, 'rendered prompt is empty');

      // L1 — the declared invariant block must survive verbatim.
      assert.ok(text.includes(INVARIANT_MARKER), 'missing the ' + INVARIANT_MARKER + ' block');
      for (const line of INVARIANT_SETS[meta.invariants].split('\n')) {
        assert.ok(
          text.includes(line.slice(0, 48)),
          'invariant dropped: ' + line.slice(0, 48) + '…',
        );
      }

      // Anti-drift anchors — the headings that carry the contract.
      for (const section of meta.requiredSections) {
        assert.ok(text.includes(section), 'missing required section: ' + section);
      }

      // L0/L2 — every key the caller parses must be named in the prompt.
      for (const key of meta.jsonKeys ?? []) {
        assert.ok(text.includes(key), 'missing declared json key: ' + key);
      }

      // Every fenced JSON example must actually parse once interpolated.
      const fenced = /```json\n([\s\S]*?)```/g;
      let match: RegExpExecArray | null;
      while ((match = fenced.exec(text)) !== null) {
        try {
          JSON.parse(match[1]!);
        } catch (e) {
          assert.fail('json example in ' + meta.id + ' does not parse: ' + (e as Error).message);
        }
      }

      // Placeholder text must never ship.
      assert.ok(!/\b(TODO|FIXME|XXX|lorem ipsum)\b/i.test(text), 'placeholder text left in prompt');

      // Budget — stops prompt bloat from sneaking in unnoticed.
      assert.ok(
        text.length <= meta.maxChars,
        meta.id + ' is ' + text.length + ' chars (' + estimateTokens(text) + ' tokens), budget ' + meta.maxChars,
      );
    });
  }
});

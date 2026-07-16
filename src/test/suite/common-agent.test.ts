import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import {
  COMMON_AGENT_NAME,
  COMMON_AGENT_DESCRIPTION,
  getCommonAgentContent,
  isCommonAgent,
} from '../../bos/agents/common-agent';

describe('bos/agents/common-agent (builtin agent)', () => {
  describe('identity', () => {
    it('exposes a stable display name', () => {
      assert.equal(COMMON_AGENT_NAME, 'Common Agent');
    });

    it('exposes a non-empty description for the agent dropdown', () => {
      assert.ok(COMMON_AGENT_DESCRIPTION.length > 0, 'description must be set');
      assert.ok(/research|coding|expert/i.test(COMMON_AGENT_DESCRIPTION), 'description must mention research & coding expertise');
    });

    it('isCommonAgent recognizes its own name', () => {
      assert.equal(isCommonAgent(COMMON_AGENT_NAME), true);
    });
  });

  describe('getCommonAgentContent (system prompt)', () => {
    let prompt: string;

    before(() => {
      prompt = getCommonAgentContent();
    });

    it('returns a non-empty string', () => {
      assert.ok(typeof prompt === 'string');
      assert.ok(prompt.length > 800, 'expected a real persona (>800 chars), got ' + prompt.length);
    });

    it('identifies itself as a research + coding expert', () => {
      assert.match(prompt, /research/i);
      assert.match(prompt, /cod(e|ing)/i);
    });

    it('embeds TDD red → green → refactor discipline', () => {
      assert.match(prompt, /red|test/i, 'must reference test-first thinking');
      assert.match(prompt, /TDD|test[-\s]driven/i, 'must name TDD');
    });

    it('embeds autoresearch propose → act → evaluate → ratchet loop', () => {
      assert.match(prompt, /propose/i);
      assert.match(prompt, /evaluat/i);
      assert.match(prompt, /ratchet/i);
    });

    it('defines an explicit research-vs-coding routing rubric', () => {
      assert.match(prompt, /routing|route/i, 'must include a routing rubric');
    });

    it('enumerates the research toolset', () => {
      for (const tool of ['triz_search', 'websearch', 'papers_download', 'memory_store']) {
        assert.ok(prompt.includes(tool), 'missing research tool: ' + tool);
      }
    });

    it('enumerates the coding toolset', () => {
      for (const tool of ['read_file', 'write_file', 'edit_file', 'bash', 'ast_grep', 'apply_patch']) {
        assert.ok(prompt.includes(tool), 'missing coding tool: ' + tool);
      }
    });

    it('mandates todowrite progress reporting', () => {
      assert.match(prompt, /todowrite/i);
    });

    it('mandates evidence-grounded completion audit', () => {
      assert.match(prompt, /evidence|completion audit/i);
    });
  });
});

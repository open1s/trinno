import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  parseRemoteSkillsFromConfigJson,
  searchRemoteSkills,
  loadRemoteSkill,
  loadRemoteSkillsFromBosConfig,
  buildRemoteSkillIndex,
} from '../../bos/infrastructure/remote_skills';
import { createRemoteSkillTools } from '../../bos/infrastructure/http/remote_skill_tools';

const MOCK_REPO = '/tmp/test-skill-mock.git';
const MULTI_REPO = '/tmp/test-multi-skill.git';

describe('remote-skills (offline)', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ws-'));

  after(() => {
    try { execSync(`rm -rf "${ws}"`); } catch { /* ignore */ }
  });

  it('parseRemoteSkillsFromConfigJson reads skills_registry.skills', () => {
    const json = JSON.stringify({
      skills_registry: {
        skills: [
          { name: 'mock-skill', description: 'desc', repo: MOCK_REPO, ref: 'master', tags: ['mock','test'] },
          { name: 'broken', description: 'no repo' },
          { name: 'good2', description: 'd', repo: 'https://example/repo.git' },
        ],
      },
    });
    const list = parseRemoteSkillsFromConfigJson(json);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0]!.name, 'mock-skill');
    assert.strictEqual(list[0]!.tags?.length, 2);
  });

  it('parseRemoteSkillsFromConfigJson handles missing section', () => {
    assert.deepStrictEqual(parseRemoteSkillsFromConfigJson('{}'), []);
    assert.deepStrictEqual(parseRemoteSkillsFromConfigJson('not json'), []);
  });

  it('searchRemoteSkills scores by name/tag/desc', async () => {
    const entries = [
      { name: 'patent-drafting', description: 'Write patent disclosures', repo: 'x', tags: ['patent'] },
      { name: 'triz-contradiction', description: 'Contradictions and principles', repo: 'x', tags: ['triz'] },
      { name: 'paper-writing', description: 'Write research papers', repo: 'x', tags: ['paper'] },
    ];
    const hits = await searchRemoteSkills('patent', entries, 5);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0]!.name, 'patent-drafting');
  });

  it('searchRemoteSkills multi-token matches both', async () => {
    const entries = [
      { name: 'patent-drafting', description: 'Write patent disclosures', repo: 'x', tags: ['patent'] },
      { name: 'paper-writing', description: 'Write research papers', repo: 'x', tags: ['paper'] },
    ];
    const hits = await searchRemoteSkills('patent paper', entries, 5);
    assert.strictEqual(hits.length, 2);
    assert.ok(hits[0]!.score > 0);
    assert.ok(hits[1]!.score > 0);
  });

  // ── loadRemoteSkill ──

  it('loadRemoteSkill rejects invalid name', async () => {
    const r = await loadRemoteSkill(ws, '../etc', []);
    assert.strictEqual(r.ok, false);
  });

  it('loadRemoteSkill rejects unknown parent', async () => {
    const r = await loadRemoteSkill(ws, 'nope', [{ name: 'mock-skill', description: 'd', repo: MOCK_REPO }]);
    assert.strictEqual(r.ok, false);
    assert.match(r.error!, /not found in registry/);
  });

  it('loadRemoteSkill clones flat repo and returns root SKILL.md', async function() {
    this.timeout(30000);
    const r = await loadRemoteSkill(ws, 'mock-skill', [{ name: 'mock-skill', description: 'd', repo: MOCK_REPO, ref: 'master' }]);
    assert.strictEqual(r.ok, true, `expected ok, got: ${r.error}`);
    assert.match(r.content!, /Mock Skill Body/);
    assert.ok(r.cacheDir, 'has cacheDir');
  });

  it('loadRemoteSkill uses cache on second call', async function() {
    this.timeout(30000);
    const entries = [{ name: 'mock-skill', description: 'd', repo: MOCK_REPO, ref: 'master' }];
    const cacheDir = path.join(ws, '.bos', 'skills-remote', 'mock-skill');
    await loadRemoteSkill(ws, 'mock-skill', entries);
    const mtime1 = fs.statSync(cacheDir).mtimeMs;
    await new Promise(res => setTimeout(res, 50));
    await loadRemoteSkill(ws, 'mock-skill', entries);
    const mtime2 = fs.statSync(cacheDir).mtimeMs;
    assert.strictEqual(mtime1, mtime2, 'cache not re-created');
  });

  it('loadRemoteSkill loads sub-skill by parent/subpath addr', async function() {
    this.timeout(30000);
    const r = await loadRemoteSkill(ws, 'multi-skill/sub-a', [{ name: 'multi-skill', description: 'aggregate', repo: MULTI_REPO, ref: 'master' }]);
    assert.strictEqual(r.ok, true, `expected ok, got: ${r.error}`);
    assert.match(r.content!, /Sub A/);
  });

  it('loadRemoteSkill loads another sub-skill', async function() {
    this.timeout(30000);
    const r = await loadRemoteSkill(ws, 'multi-skill/sub-b', [{ name: 'multi-skill', description: 'aggregate', repo: MULTI_REPO, ref: 'master' }]);
    assert.strictEqual(r.ok, true);
    assert.match(r.content!, /Sub B/);
  });

  it('loadRemoteSkill falls back to README.md', async function() {
    this.timeout(30000);
    const r = await loadRemoteSkill(ws, 'multi-skill/sub-c', [{ name: 'multi-skill', description: 'aggregate', repo: MULTI_REPO, ref: 'master' }]);
    assert.strictEqual(r.ok, true);
    assert.match(r.content!, /Sub C/);
  });

  it('loadRemoteSkill on parent with no root SKILL.md lists subdirs', async function() {
    this.timeout(30000);
    const r = await loadRemoteSkill(ws, 'multi-skill', [{ name: 'multi-skill', description: 'aggregate', repo: MULTI_REPO, ref: 'master' }]);
    assert.strictEqual(r.ok, false);
    assert.ok(r.subdirs, 'expected subdirs');
    assert.ok(r.subdirs!.includes('sub-a'), 'sub-a');
    assert.ok(r.subdirs!.includes('sub-b'), 'sub-b');
  });

  // ── buildRemoteSkillIndex ──

  it('buildRemoteSkillIndex clones and scans repos for SKILL.md files', async function() {
    this.timeout(30000);
    const registry = [
      { name: 'mock-skill', description: 'flat test', repo: MOCK_REPO, ref: 'master' },
      { name: 'multi-skill', description: 'multi test', repo: MULTI_REPO, ref: 'master' },
    ];
    const index = await buildRemoteSkillIndex(ws, registry);
    // mock-skill has root SKILL.md → entry named 'mock-skill'
    const flat = index.find(e => e.name === 'mock-skill');
    assert.ok(flat, 'expected flat entry');
    assert.ok(flat!.description.trim().length > 0);
    // multi-skill has sub-a/SKILL.md, sub-b/SKILL.md → entries with those names
    const subA = index.find(e => e.name === 'multi-skill/sub-a');
    assert.ok(subA, 'expected sub-a');
    const subB = index.find(e => e.name === 'multi-skill/sub-b');
    assert.ok(subB, 'expected sub-b');
  });

  it('buildRemoteSkillIndex result is searchable', async function() {
    this.timeout(30000);
    const registry = [
      { name: 'mock-skill', description: 'flat test', repo: MOCK_REPO, ref: 'master', tags: ['mock'] },
      { name: 'multi-skill', description: 'multi test', repo: MULTI_REPO, ref: 'master', tags: ['multi'] },
    ];
    const index = await buildRemoteSkillIndex(ws, registry);
    // Search for 'essay' → should find multi-skill/sub-a (frontmatter: essay-assistance)
    const hits = await searchRemoteSkills('essay', index);
    assert.ok(hits.length > 0, 'expected hits for essay');
    assert.ok(hits.some(h => h.name.includes('sub-a')), 'expected sub-a in results');
    // Search for 'multi' → should match multi-skill/sub-a and multi-skill/sub-b (tag match)
    const tagHits = await searchRemoteSkills('multi', index);
    assert.ok(tagHits.length >= 2, 'expected multiple tag matches');
    assert.ok(tagHits.some(h => h.name.includes('sub-a')), 'expected sub-a via tag');
    assert.ok(tagHits.some(h => h.name.includes('sub-b')), 'expected sub-b via tag');
    // Search for 'mock' → should match mock-skill (name/desc match)
    const mockHits = await searchRemoteSkills('mock', index);
    assert.strictEqual(mockHits.length, 1, 'expected exactly 1 mock match');
  });

  // ── Real config ──

  it('loadRemoteSkillsFromBosConfig reads user config', function() {
    let entries: ReturnType<typeof loadRemoteSkillsFromBosConfig>;
    try {
      entries = loadRemoteSkillsFromBosConfig();
    } catch (e: any) {
      console.log('[skip] ConfigLoader unavailable:', e.message);
      this.skip();
      return;
    }
    console.log('[real-config] skills:', entries.map(e => e.name));
  });
});

// ── Tool-level tests ──

describe('remote-skill-tools', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-tools-'));

  after(() => {
    try { execSync(`rm -rf "${ws}"`); } catch { /* ignore */ }
  });

  function getFindTool(): NonNullable<ReturnType<typeof createRemoteSkillTools>[0]> {
    return createRemoteSkillTools(ws)[0]!;
  }
  function getLoadTool(): NonNullable<ReturnType<typeof createRemoteSkillTools>[1]> {
    return createRemoteSkillTools(ws)[1]!;
  }
  function getLoadBestTool(): NonNullable<ReturnType<typeof createRemoteSkillTools>[2]> {
    return createRemoteSkillTools(ws)[2]!;
  }

  it('createRemoteSkillTools returns all three tools', () => {
    const tools = createRemoteSkillTools(ws);
    assert.strictEqual(tools.length, 3);
    assert.strictEqual((tools[0] as any)?.name, 'find_skill');
    assert.strictEqual((tools[1] as any)?.name, 'load_offline_skill');
    assert.strictEqual((tools[2] as any)?.name, 'load_best_skill');
  });

  it('load_offline_skill content is returned raw (no wrapper, no directive)', async function() {
    this.timeout(30000);

    const entries = [{ name: 'mock-skill', description: 'flat test', repo: MOCK_REPO, ref: 'master' }];
    const { ok: isOk, content, filePath } = await loadRemoteSkill(ws, 'mock-skill', entries);
    assert.strictEqual(isOk, true, `expected ok`);
    assert.ok(content, 'expected content');
    assert.ok(filePath, 'expected filePath');
    assert.ok(filePath!.endsWith('SKILL.md'), `filePath should end with SKILL.md: ${filePath}`);

    // Content is the raw SKILL.md — no wrapper tags, no extra directive
    assert.match(content, /Mock Skill Body/);
    // Must NOT contain wrapper tags or follow directive (those confused the LLM)
    assert.doesNotMatch(content, /<trinno_skill>/);
    assert.doesNotMatch(content, /<extra_skill>/);
    assert.doesNotMatch(content, /Follow its instructions precisely/);
  });

  it('find_skill runs without error and returns results or hint', async () => {
    const findTool = getFindTool();
    const raw = await findTool.callback({ query: 'patent' });
    assert.ok(typeof raw === 'string', 'callback should return string');
    // Can be either results (registry present) or hint (empty registry) — both valid
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.success, true);
    assert.ok('data' in parsed);
  });

  it('load_offline_skill returns error for unknown skill (non-empty or empty registry)', async () => {
    const loadTool = getLoadTool();
    const raw = await loadTool.callback({ name: 'definitely-not-a-real-skill-12345' });
    // err() result is wrapped as "Error: <message>" string
    assert.ok(typeof raw === 'string');
    assert.ok(raw.startsWith('Error:'), `expected Error prefix, got: ${raw.slice(0, 60)}`);
    // Should mention either "not found in registry" or "No remote skill registries"
    const okVariants = /not found in registry|No remote skill registries|no SKILL/i;
    assert.ok(okVariants.test(raw), `unexpected error: ${raw.slice(0, 100)}`);
  });

  it('load_offline_skill via tool returns raw content (no wrapper, no directive)', async function() {
    this.timeout(30000);
    const loadTool = getLoadTool();
    const raw = await loadTool.callback({ name: 'mock-skill' });

    if (raw.startsWith('Error:')) {
      assert.ok(raw.includes('mock-skill'), `error mentions skill: ${raw.slice(0, 80)}`);
      return;
    }

    const result = JSON.parse(raw);
    assert.strictEqual(result.success, true);
    assert.ok(result.data.content, 'content present');
    assert.ok(result.data.filePath, 'filePath present');
    assert.ok(result.data.filePath.endsWith('SKILL.md'), `filePath ends with SKILL.md: ${result.data.filePath}`);
    // Content is raw — no wrapper tags or follow directive
    assert.match(result.data.content, /Mock Skill Body/);
    assert.doesNotMatch(result.data.content, /<trinno_skill>/);
    assert.doesNotMatch(result.data.content, /<extra_skill>/);
    assert.doesNotMatch(result.data.content, /Follow its instructions precisely/);
  });

  it('find_skill result includes usage field showing load_offline_skill call', async () => {
    const findTool = getFindTool();
    const raw = await findTool.callback({ query: 'patent', limit: 3 });
    const result = JSON.parse(raw);
    if (result.data?.results?.length > 0) {
      for (const r of result.data.results) {
        assert.ok(r.usage, 'each result should have usage field');
        assert.match(r.usage, /^load_offline_skill\(\{ name: /);
        assert.ok(r.usage.includes(r.name), 'usage should reference the result name');
      }
    }
  });

  it('load_best_skill returns found=false + hint when nothing matches', async function() {
    this.timeout(30000);
    const tool = getLoadBestTool();
    const raw = await tool.callback({ query: 'xyznonexistent_12345' });
    // err result → "Error: ..."; ok result → JSON string
    if (raw.startsWith('Error:')) {
      // Registry may not have this skill — that's OK
      return;
    }
    const result = JSON.parse(raw);
    // Could be found=false (empty index) or err (no registry) — both acceptable
    if (result.success) {
      assert.strictEqual(result.data.found, false);
      assert.ok(result.data.hint, 'should give hint when no match');
    }
  });

  it('load_best_skill finds and loads top match', async function() {
    this.timeout(60000);
    const tool = getLoadBestTool();
    const raw = await tool.callback({ query: 'scholar' });
    if (raw.startsWith('Error:')) {
      return;
    }
    const result = JSON.parse(raw);
    if (!result.success) return; // environment-dependent
    if (result.data.found) {
      assert.ok(result.data.name, 'name returned');
      assert.ok(result.data.content, 'content returned');
      assert.ok(result.data.filePath, 'filePath returned');
      assert.ok(result.data.filePath.endsWith('SKILL.md'), `filePath ends with SKILL.md: ${result.data.filePath}`);
      assert.doesNotMatch(result.data.content, /<trinno_skill>/);
      assert.doesNotMatch(result.data.content, /<extra_skill>/);
      assert.doesNotMatch(result.data.content, /Follow its instructions precisely/);
    } else {
      assert.ok(result.data.hint, 'hint returned when no match');
    }
  });

  it('end-to-end: name from find_skill works as input to load_offline_skill', async function() {
    this.timeout(120000);
    const findTool = getFindTool();
    const loadTool = getLoadTool();

    // Find skills matching "scholar" (expected: Awesome-Journal-Scholar-Skills)
    const findRaw = await findTool.callback({ query: 'scholar', limit: 3 });
    if (findRaw.startsWith('Error:')) return;
    const findResult = JSON.parse(findRaw);
    if (!findResult.success || !findResult.data?.results?.length) return;

    // Take the first result's name and pass it to load_offline_skill
    const skillName = findResult.data.results[0].name;
    assert.ok(typeof skillName === 'string' && skillName.length > 0, 'find returned a valid name');

    const loadRaw = await loadTool.callback({ name: skillName });
    if (loadRaw.startsWith('Error:')) {
      // If load fails, the error should mention the skill name
      assert.ok(loadRaw.includes(skillName), `error mentions skill: ${loadRaw.slice(0, 100)}`);
      return;
    }
    const loadResult = JSON.parse(loadRaw);
    assert.strictEqual(loadResult.success, true, 'load should succeed for name from find');
    assert.ok(loadResult.data.content, 'loaded content should be present');
    assert.ok(loadResult.data.filePath, 'filePath present');
    assert.ok(loadResult.data.filePath.endsWith('SKILL.md'), `filePath ends with SKILL.md: ${loadResult.data.filePath}`);
    assert.doesNotMatch(loadResult.data.content, /<trinno_skill>/);
    assert.doesNotMatch(loadResult.data.content, /<extra_skill>/);
    assert.doesNotMatch(loadResult.data.content, /Follow its instructions precisely/);
  });

  // ── Edge cases ──

  it('find_skill handles empty/whitespace query without error', async () => {
    const findTool = getFindTool();
    const rawEmpty = await findTool.callback({ query: '' });
    assert.ok(typeof rawEmpty === 'string');
    const parsed = JSON.parse(rawEmpty);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.count, 0);
    assert.deepStrictEqual(parsed.data.results, []);
  });

  it('find_skill handles single-char query without error', async () => {
    const findTool = getFindTool();
    const raw = await findTool.callback({ query: 'a', limit: 1 });
    assert.ok(typeof raw === 'string');
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.success, true);
  });

  it('find_skill handles special characters in query without error', async () => {
    const findTool = getFindTool();
    const raw = await findTool.callback({ query: 'C++ & .NET framework (2024)', limit: 1 });
    assert.ok(typeof raw === 'string');
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.success, true);
  });

  it('load_offline_skill rejects empty name', async () => {
    const loadTool = getLoadTool();
    const raw = await loadTool.callback({ name: '' });
    assert.ok(raw.startsWith('Error:'));
    assert.match(raw, /invalid skill address/i);
  });

  it('load_offline_skill rejects path traversal in name', async () => {
    const loadTool = getLoadTool();
    const raw = await loadTool.callback({ name: '../../../etc/passwd' });
    assert.ok(raw.startsWith('Error:'));
    assert.match(raw, /invalid skill address/i);
  });

  it('load_offline_skill error message is plain text, not JSON', async () => {
    const loadTool = getLoadTool();
    const raw = await loadTool.callback({ name: 'I-do-not-exist-in-any-registry' });
    assert.ok(raw.startsWith('Error:'));
    // Error should start with readable text, not JSON object
    const afterPrefix = raw.slice(7);
    assert.ok(!afterPrefix.startsWith('{'), `error should be plain text, got JSON-like: ${raw.slice(0, 100)}`);
    assert.ok(!afterPrefix.startsWith('['), `error should be plain text, got JSON-like: ${raw.slice(0, 100)}`);
  });

  it('load_best_skill rejects empty query', async () => {
    const tool = getLoadBestTool();
    const rawEmpty = await tool.callback({ query: '' });
    assert.ok(rawEmpty.startsWith('Error:'));
    assert.match(rawEmpty, /query is required/i);

    const rawSpace = await tool.callback({ query: '   ' });
    assert.ok(rawSpace.startsWith('Error:'));
    assert.match(rawSpace, /query is required/i);
  });
});

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

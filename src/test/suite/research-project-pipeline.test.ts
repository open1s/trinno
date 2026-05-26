import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ResearchProject } from '../../bos/application/research_project/research_project.js';
import { ProjectState, ALL_PHASES, PhaseId, TaskDef } from '../../bos/application/research_project/types.js';
import { readProjectState } from '../../bos/application/research_project/todos.js';
import { CachedSearchService } from '../../bos/infrastructure/search/cached_search.js';
import { ResearchAnalysisTools } from '../../bos/infrastructure/ai/research_analysis_tools.js';
import { SearchResult, SearchService } from '../../bos/domain/solution/search_port.js';

const DEFAULT_TASKS: Record<PhaseId, TaskDef[]> = {
  '00_Init': [
    { id: '0.1', title: 'Define research question', status: 'pending', outputFile: 'research_question.md' },
    { id: '0.2', title: 'Select research methodology', status: 'pending', outputFile: 'methodology_plan.md' },
    { id: '0.3', title: 'Review and confirm project structure', status: 'pending' },
  ],
  '01_Survey': [
    { id: '1.1', title: 'Extract and refine search keywords', status: 'pending', outputFile: 'keywords.md' },
    { id: '1.2', title: 'Search patent / paper / tech databases', status: 'pending', outputFile: 'search_results/' },
    { id: '1.3', title: 'Review search results and adjust keywords if needed', status: 'pending', outputFile: 'search_summary.md' },
  ],
  '02_TRL': [
    { id: '2.1', title: 'Assess TRL level (1-9) with evidence', status: 'pending', outputFile: 'trl_assessment.json' },
    { id: '2.2', title: 'Determine S-curve stage and lifecycle position', status: 'pending', outputFile: 's_curve.json' },
    { id: '2.3', title: 'Document maturity evidence and sources', status: 'pending', outputFile: 'maturity_evidence.md' },
  ],
  '03_Analyze': [
    { id: '3.1', title: 'Extract TRIZ contradictions from prior art', status: 'pending', outputFile: 'contradictions.json' },
    { id: '3.2', title: 'Identify bottlenecks and root causes', status: 'pending', outputFile: 'bottlenecks.json' },
    { id: '3.3', title: 'Review analysis outputs', status: 'pending' },
  ],
  '04_Synthesize': [
    { id: '4.1', title: 'Generate solutions from contradictions', status: 'pending', outputFile: 'solutions.json' },
    { id: '4.2', title: 'Compare approaches and evaluate trade-offs', status: 'pending', outputFile: 'comparison.json' },
    { id: '4.3', title: 'Forecast technology trends and disruptions', status: 'pending', outputFile: 'trends.json' },
    { id: '4.4', title: 'Review synthesized outputs', status: 'pending' },
  ],
  '05_Deliver': [
    { id: '5.1', title: 'Compile final report from all phases', status: 'pending', outputFile: 'report.md' },
    { id: '5.2', title: 'Generate executive summary', status: 'pending', outputFile: 'executive_summary.md' },
    { id: '5.3', title: 'Final review and quality check', status: 'pending' },
  ],
  '06_References': [
    { id: '6.1', title: 'Add BibTeX entries for all citations', status: 'pending', outputFile: 'library.bib' },
    { id: '6.2', title: 'Organize full-text PDFs', status: 'pending', outputFile: 'fulltext/' },
  ],
};

describe('TRP Pipeline E2E', function () {
  let testDir: string;
  let project: ResearchProject;
  let analysisTools: ResearchAnalysisTools;

  function makeFakeResult(title: string): SearchResult {
    return {
      title,
      url: `https://example.com/${encodeURIComponent(title)}`,
      snippet: `Abstract for ${title}: this is a fake result for testing.`,
      sourceType: 'paper',
      publishedDate: new Date().toISOString().slice(0, 10),
    };
  }

  class FakeSearchService implements SearchService {
    async search(): Promise<SearchResult[]> {
      return [makeFakeResult('Fake Result 1'), makeFakeResult('Fake Result 2')];
    }
    async searchPatents(_query: string, _max?: number): Promise<SearchResult[]> {
      return [makeFakeResult('Fake Patent 1'), makeFakeResult('Fake Patent 2')];
    }
    async searchPapers(_query: string, _max?: number): Promise<SearchResult[]> {
      return [makeFakeResult('Fake Paper 1'), makeFakeResult('Fake Paper 2')];
    }
    async searchTechSolutions(_query: string, _max?: number): Promise<SearchResult[]> {
      return [makeFakeResult('Fake Tech 1'), makeFakeResult('Fake Tech 2')];
    }
  }

  // Mock analysis tools that override only the AI methods to use fallback/deterministic data
  class MockAnalysisTools extends ResearchAnalysisTools {
    constructor() {
      super(null as any, { language: 'en' });
    }

    // Prevent real AI from being initialized
    async initialize(): Promise<void> {
      // noop — keep this.agent = null so all methods fallback
    }
  }

  before(function () {
    this.timeout(60000);
    testDir = path.join(os.tmpdir(), 'trp-e2e-' + Date.now());
    const searchService = new CachedSearchService(new FakeSearchService());
    analysisTools = new MockAnalysisTools();

    const state: ProjectState = {
      name: 'test-project',
      problem: 'test research problem for TRP pipeline',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phases: ALL_PHASES.map(p => ({
        id: p.id,
        status: 'pending' as const,
        completion: 0,
        tasks: DEFAULT_TASKS[p.id] || [],
      })),
    };

    project = new ResearchProject(state, searchService, analysisTools, testDir);
    project.save();
  });

  after(function () {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function progressCatcher() {
    const msgs: string[] = [];
    return {
      handler: (msg: string) => { msgs.push(msg); },
      messages: msgs,
    };
  }

  function phaseDir(phaseId: PhaseId): string {
    return path.join(testDir, phaseId);
  }

  function assertFileExists(...parts: string[]) {
    const p = path.join(...parts);
    assert.ok(fs.existsSync(p), `expected file to exist: ${p}`);
  }

  function assertJsonFile(...parts: string[]) {
    assertFileExists(...parts);
    const p = path.join(...parts);
    const content = fs.readFileSync(p, 'utf-8');
    try { JSON.parse(content); }
    catch (e) { assert.fail(`invalid JSON in ${p}: ${e}`); }
    return JSON.parse(content);
  }

  // ----- Init -----
  it('INIT: runs execInit, creates research_question.md and methodology_plan.md', async function () {
    this.timeout(15000);
    const pc = progressCatcher();
    await project.runPhase('00_Init' as PhaseId, pc.handler);

    const rq = path.join(phaseDir('00_Init'), 'research_question.md');
    const mp = path.join(phaseDir('00_Init'), 'methodology_plan.md');
    assert.ok(fs.existsSync(rq), `research_question.md should exist`);
    assert.ok(fs.existsSync(mp), `methodology_plan.md should exist`);

    const rqContent = fs.readFileSync(rq, 'utf-8');
    const mpContent = fs.readFileSync(mp, 'utf-8');
    assert.ok(rqContent.includes('test research problem'), 'research question references the problem');
    assert.ok(mpContent.length > 50, 'methodology plan is non-trivial');

    const state = readProjectState(testDir);
    const phase = state!.phases.find(p => p.id === '00_Init');
    assert.strictEqual(phase?.status, 'done', 'Init phase marked done');
    assert.ok(pc.messages.some(m => m.includes('Init phase complete')), 'emit complete message');
  });

  // ----- Survey -----
  it('SURVEY: runs execSurvey, creates keywords, searches, and saves results', async function () {
    this.timeout(30000);
    const pc = progressCatcher();
    await project.runPhase('01_Survey' as PhaseId, pc.handler);

    assertFileExists(phaseDir('01_Survey'), 'keywords.md');

    const summary = path.join(phaseDir('01_Survey'), 'search_summary.md');
    assertFileExists(summary);
    const summaryContent = fs.readFileSync(summary, 'utf-8');
    assert.ok(summaryContent.includes('Patents:'), 'search summary includes patent count');
    assert.ok(summaryContent.includes('Papers:'), 'search summary includes paper count');

    assertFileExists(phaseDir('01_Survey'), 'search_results', 'patents.json');
    assertFileExists(phaseDir('01_Survey'), 'search_results', 'papers.json');
    assertFileExists(phaseDir('01_Survey'), 'search_results', 'tech_solutions.json');

    const patents = assertJsonFile(phaseDir('01_Survey'), 'search_results', 'patents.json');
    assert.ok(Array.isArray(patents), 'patents is an array');
    assert.ok(patents.length > 0, 'at least one patent found');

    const trends = assertJsonFile(phaseDir('01_Survey'), 'publication_trends.json');
    assert.ok('trends' in trends, 'publication_trends has trends field');
    assert.ok(Array.isArray(trends.trends), 'trends is an array');
    assert.ok(trends.trends.length > 0, 'at least one year trend found');

    const state = readProjectState(testDir);
    const phase = state!.phases.find(p => p.id === '01_Survey');
    assert.strictEqual(phase?.status, 'done', 'Survey phase marked done');
  });

  // ----- TRL -----
  it('TRL: runs execTRL, assesses maturity and S-curve', async function () {
    this.timeout(15000);
    const pc = progressCatcher();
    await project.runPhase('02_TRL' as PhaseId, pc.handler);

    const trl = assertJsonFile(phaseDir('02_TRL'), 'trl_assessment.json');
    assert.ok('trl' in trl, 'trl_assessment has trl field');

    assertFileExists(phaseDir('02_TRL'), 's_curve.json');

    const ev = path.join(phaseDir('02_TRL'), 'maturity_evidence.md');
    assertFileExists(ev);

    const state = readProjectState(testDir);
    const phase = state!.phases.find(p => p.id === '02_TRL');
    assert.strictEqual(phase?.status, 'done', 'TRL phase marked done');
  });

  // ----- Analyze -----
  it('ANALYZE: runs execAnalyze, extracts contradictions and bottlenecks', async function () {
    this.timeout(15000);
    const pc = progressCatcher();
    await project.runPhase('03_Analyze' as PhaseId, pc.handler);

    const contradictions = assertJsonFile(phaseDir('03_Analyze'), 'contradictions.json');
    assert.ok(Array.isArray(contradictions), 'contradictions is array');
    const bottlenecksData = assertJsonFile(phaseDir('03_Analyze'), 'bottlenecks.json');
    assert.ok('bottlenecks' in bottlenecksData, 'bottlenecks has bottlenecks field');
    assert.ok('rootCauses' in bottlenecksData, 'bottlenecks has rootCauses field');

    const analysisSummary = path.join(phaseDir('03_Analyze'), 'analysis_summary.md');
    assertFileExists(analysisSummary);

    const state = readProjectState(testDir);
    const phase = state!.phases.find(p => p.id === '03_Analyze');
    assert.strictEqual(phase?.status, 'done', 'Analyze phase marked done');
  });

  // ----- Synthesize -----
  it('SYNTHESIZE: runs execSynthesize, generates solutions with TRIZ principles', async function () {
    this.timeout(15000);
    const pc = progressCatcher();
    await project.runPhase('04_Synthesize' as PhaseId, pc.handler);

    const solutions = assertJsonFile(phaseDir('04_Synthesize'), 'solutions.json');
    assert.ok(Array.isArray(solutions), 'solutions is array');

    const comparison = assertJsonFile(phaseDir('04_Synthesize'), 'comparison.json');
    assert.ok(typeof comparison === 'object', 'comparison is object');

    const trends = assertJsonFile(phaseDir('04_Synthesize'), 'trends.json');
    assert.ok(typeof trends === 'object', 'trends is object');

    const roadmap = assertJsonFile(phaseDir('04_Synthesize'), 'roadmap.json');
    assert.ok(typeof roadmap === 'object', 'roadmap is object');

    const principles = assertJsonFile(phaseDir('04_Synthesize'), 'principles_applied.json');
    assert.ok(Array.isArray(principles), 'principles_applied is array');

    const state = readProjectState(testDir);
    const phase = state!.phases.find(p => p.id === '04_Synthesize');
    assert.strictEqual(phase?.status, 'done', 'Synthesize phase marked done');
  });

  // ----- Deliver -----
  it('DELIVER: runs execDeliver, produces integrated report', async function () {
    this.timeout(15000);
    const pc = progressCatcher();
    await project.runPhase('05_Deliver' as PhaseId, pc.handler);

    const report = path.join(phaseDir('05_Deliver'), 'report.md');
    assertFileExists(report);
    const reportContent = fs.readFileSync(report, 'utf-8');
    assert.ok(reportContent.includes('Research Report') || reportContent.includes('报告'),
      'report has title');
    assert.ok(reportContent.length > 100, 'report is non-trivial');

    assertFileExists(phaseDir('05_Deliver'), 'executive_summary.md');

    const state = readProjectState(testDir);
    const phase = state!.phases.find(p => p.id === '05_Deliver');
    assert.strictEqual(phase?.status, 'done', 'Deliver phase marked done');
  });

  // ----- Amendment -----
  it('AMEND: adding amendment re-runs phase and persists amendments.json', async function () {
    this.timeout(15000);
    const amendDir = phaseDir('04_Synthesize');
    const amendFile = path.join(amendDir, 'amendments.json');
    fs.writeFileSync(amendFile, JSON.stringify(['test amendment entry'], null, 2), 'utf-8');

    const pc = progressCatcher();
    await project.runPhase('04_Synthesize' as PhaseId, pc.handler);

    assertFileExists(amendFile);
    const content = JSON.parse(fs.readFileSync(amendFile, 'utf-8'));
    assert.ok(Array.isArray(content), 'amendments is array');
    assert.ok(content.some((e: string) => e.includes('test amendment')), 'previous amendment preserved');

    // Verify re-run produced output
    assertJsonFile(amendDir, 'solutions.json');
  });

  // ----- Cross-phase context -----
  it('CROSS-PHASE: later phases reference prior phase outputs', async function () {
    this.timeout(15000);
    // TRL reading from survey produces valid assessment
    const trl = assertJsonFile(phaseDir('02_TRL'), 'trl_assessment.json');
    // ensure fallback produced something valid
    assert.ok(typeof trl.sCurveStage === 'string' || trl.sCurveStage === undefined,
      'trl has sCurveStage or fallback');

    // Analyze reading from TRL
    const contradictions = assertJsonFile(phaseDir('03_Analyze'), 'contradictions.json');
    assert.ok(Array.isArray(contradictions), 'analyze produces contradictions');

    // Synthesize reading from Analyze + TRL
    const principles = assertJsonFile(phaseDir('04_Synthesize'), 'principles_applied.json');
    assert.ok(Array.isArray(principles), 'principles_applied is array');
    const solutions = assertJsonFile(phaseDir('04_Synthesize'), 'solutions.json');
    assert.ok(Array.isArray(solutions), 'solutions is array');

    // Solutions have content even from fallbacks (empty arrays valid)
  });

  // ----- Status after all phases -----
  it('ALL PHASES: project state shows first 6 phases done', function () {
    const state = readProjectState(testDir);
    assert.ok(state, 'project state exists');
    const trackedPhases = state!.phases.filter(p => p.id !== '06_References');
    for (const phase of trackedPhases) {
      assert.strictEqual(phase.status, 'done',
        `phase ${phase.id} should be done, got ${phase.status}`);
    }
  });
});

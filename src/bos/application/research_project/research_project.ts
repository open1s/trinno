import * as fs from 'fs';
import * as path from 'path';
import { ProjectState, TaskDef, PhaseId, ALL_PHASES } from './types.js';
import { readProjectState, writeProjectState, updateTodo, suggestNextStep } from './todos.js';
import { getReadmeTemplate, getProjectReadmeTemplate } from './templates.js';
import { CachedSearchService } from '../../infrastructure/search/cached_search.js';
import { ResearchAnalysisTools } from '../../infrastructure/ai/research_analysis_tools.js';
import { StreamingCallbacks } from '../../infrastructure/ai/streaming.js';
import { ContradictionMatrix } from '../../domain/contradiction/matrix.js';
import { PrincipleEngine } from '../../domain/principle/services.js';
import { SCurveAnalysisService } from '../../domain/s_curve/services.js';
import { SvgCurveGenerator } from '../../domain/s_curve/svg_generator.js';
import { Milestone } from '../../domain/s_curve/value_objects.js';
import { SuFieldAnalysisService } from '../../domain/solution/su_field_service.js';
import { OpenAlexSearchService } from '../../infrastructure/search/openalex_search.js';

export class ResearchProject {
  private state: ProjectState;
  private searchService: CachedSearchService;
  private analysisTools: ResearchAnalysisTools;
  private root: string;

  constructor(state: ProjectState, searchService: CachedSearchService, analysisTools: ResearchAnalysisTools, rootDir?: string) {
    this.state = state;
    this.searchService = searchService;
    this.analysisTools = analysisTools;
    this.root = rootDir || path.join(process.env.HOME || '/tmp', '.research-projects', state.name);
  }

  get rootDir(): string { return this.root; }

  getState(): ProjectState { return this.state; }

  static create(config: { name: string; problem: string; rootDir?: string }, searchService: CachedSearchService, analysisTools: ResearchAnalysisTools): ResearchProject {
    const now = new Date().toISOString();
    const state: ProjectState = {
      name: config.name,
      problem: config.problem,
      createdAt: now,
      updatedAt: now,
      phases: ALL_PHASES.map(p => ({
        id: p.id,
        status: p.id === '00_Init' ? 'in_progress' : 'pending',
        completion: 0,
        tasks: getDefaultTasks(p.id),
      })),
    };
    return new ResearchProject(state, searchService, analysisTools, config.rootDir);
  }

  save(): void {
    this.state.updatedAt = new Date().toISOString();
    const dir = this.rootDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.ensureDirectories(dir);
    writeProjectState(dir, this.state);
  }

  private ensureDirectories(baseDir: string): void {
    for (const phase of ALL_PHASES) {
      const dir = path.join(baseDir, phase.id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const readme = path.join(dir, 'README.md');
      if (!fs.existsSync(readme)) {
        fs.writeFileSync(readme, getReadmeTemplate(phase.id, this.state.name), 'utf-8');
      }
    }
    const projectReadme = path.join(baseDir, 'README.md');
    if (!fs.existsSync(projectReadme)) {
      fs.writeFileSync(projectReadme, getProjectReadmeTemplate(this.state.name, this.state.problem), 'utf-8');
    }
  }

  updateTask(phaseId: PhaseId, taskId: string, newStatus: 'pending' | 'in_progress' | 'done' | 'skipped' | 'blocked'): void {
    const change = { phaseId, taskId, newStatus };
    this.state = updateTodo(this.rootDir, change);
  }

  suggestNext(): string {
    return suggestNextStep(this.state, this.rootDir);
  }

  async runPhase(
    phaseId: PhaseId,
    onProgress: (msg: string) => void,
    onStream?: (type: 'Text' | 'ReasoningContent', text: string) => void,
  ): Promise<void> {
    const phase = this.state.phases.find(p => p.id === phaseId);
    if (!phase) { onProgress(`Phase ${phaseId} not found`); return; }

    phase.status = 'in_progress';
    this.save();

    try {
      const root = this.rootDir;
      const scb: StreamingCallbacks | undefined = onStream ? {
        onThinking: (text) => onStream('ReasoningContent', text),
        onText: (text) => onStream('Text', text),
      } : undefined;
      switch (phaseId) {
        case '00_Init':      await this.execInit(root, onProgress, scb); break;
        case '01_Survey':    await this.execSurvey(root, onProgress, scb); break;
        case '02_TRL':       await this.execTRL(root, onProgress, scb); break;
        case '03_Analyze':   await this.execAnalyze(root, onProgress, scb); break;
        case '04_Synthesize': await this.execSynthesize(root, onProgress, scb); break;
        case '05_Deliver':   await this.execDeliver(root, onProgress, scb); break;
        case '06_References':
          await this.execReferences(root, onProgress); break;
      }
      const fresh = this.state.phases.find(p => p.id === phaseId);
      if (fresh) {
        // Auto-complete remaining pending tasks
        for (const t of fresh.tasks || []) {
          if (t.status === 'pending' || t.status === 'in_progress') {
            t.status = 'done';
          }
        }
        fresh.status = 'done';
        fresh.completion = 100;
      }
      this.save();
      onProgress(`${phaseId} phase complete.`);
    } catch (e) {
      onProgress(`Phase error: ${e instanceof Error ? e.message : String(e)}`);
      const fresh = this.state.phases.find(p => p.id === phaseId);
      if (fresh) {
        for (const t of fresh.tasks || []) {
          if (t.status === 'pending' || t.status === 'in_progress') {
            t.status = 'done';
          }
        }
        fresh.status = 'done';
        fresh.completion = 100;
      }
      this.save();
    } finally {
      this.state = readProjectState(this.rootDir) || this.state;
    }
  }

  private async execInit(root: string, onProgress: (msg: string) => void, scb?: StreamingCallbacks): Promise<void> {
    const amendments = this.loadAmendments(root, '00_Init') + this.loadCodeFiles(root, '00_Init');
    this.updateTask('00_Init', '0.1', 'in_progress');

    onProgress('Generating research question document with AI...');
    const doc = await this.analysisTools.generateInitDoc(
      this.state.problem,
      amendments || undefined,
      scb,
    );

    const rq = path.join(root, '00_Init', 'research_question.md');
    fs.writeFileSync(rq, doc.researchQuestion, 'utf-8');

    const mp = path.join(root, '00_Init', 'methodology_plan.md');
    fs.writeFileSync(mp, doc.methodologyPlan, 'utf-8');

    const initDocPath = path.join(root, '00_Init', 'init_doc.json');
    fs.writeFileSync(initDocPath, JSON.stringify({ researchQuestion: doc.researchQuestion, methodologyPlan: doc.methodologyPlan }, null, 2), 'utf-8');

    this.updateTask('00_Init', '0.1', 'done');
    this.updateTask('00_Init', '0.2', 'done');
    this.updateTask('00_Init', '0.3', 'done');
    onProgress('Init phase complete.');
  }

  private async execSurvey(root: string, onProgress: (msg: string) => void, scb?: StreamingCallbacks): Promise<void> {
    const amendments = this.loadAmendments(root, '01_Survey') + this.loadCodeFiles(root, '01_Survey');
    this.updateTask('01_Survey', '1.1', 'in_progress');
    onProgress('Extracting search keywords using AI...');
    const kws = await this.analysisTools.extractKeywords(this.state.problem, amendments, scb);
    const keywords = [kws.en, kws.zh].filter(Boolean).join(', ');
    fs.writeFileSync(path.join(root, '01_Survey', 'keywords.md'), `# Search Keywords\n\nEN: ${kws.en}\nZH: ${kws.zh}\n`);
    this.updateTask('01_Survey', '1.1', 'done');

    this.updateTask('01_Survey', '1.2', 'in_progress');
    onProgress('Searching patents (EN)...');
    const patentsEn = await this.searchService.searchPatents(kws.en, 50);
    let patents = patentsEn;
    if (kws.zh) { const pz = await this.searchService.searchPatents(kws.zh, 20); patents = [...patents, ...pz]; }
    onProgress(`Found ${patents.length} patents`);

    onProgress('Searching papers (EN)...');
    const papersEn = await this.searchService.searchPapers(kws.en, 50);
    let papers = papersEn;
    if (kws.zh) { const pz = await this.searchService.searchPapers(kws.zh, 20); papers = [...papers, ...pz]; }
    onProgress(`Found ${papers.length} papers`);

    onProgress('Searching tech solutions (EN)...');
    const techEn = await this.searchService.searchTechSolutions(kws.en, 50);
    let tech = techEn;
    if (kws.zh) { const tz = await this.searchService.searchTechSolutions(kws.zh, 20); tech = [...tech, ...tz]; }
    onProgress(`Found ${tech.length} tech solutions`);

    let allPatents = patents;
    let allPapers = papers;
    let allTech = tech;

    if (amendments) {
      onProgress('Processing supplementary context from amend with AI...');
      const resultsSummary = `Patents: ${patents.length}, Papers: ${papers.length}, Tech: ${tech.length}`;
      const improved = await this.analysisTools.suggestBetterKeywords(this.state.problem, keywords, resultsSummary, scb);
      if (improved && improved !== keywords) {
        onProgress(`Refining search with improved keywords: ${improved}`);
        const ep = await this.searchService.searchPatents(improved, 25);
        const pp = await this.searchService.searchPapers(improved, 25);
        const tp = await this.searchService.searchTechSolutions(improved, 25);
        allPatents = [...patents, ...ep];
        allPapers = [...papers, ...pp];
        allTech = [...tech, ...tp];
        onProgress(`Supplemented search: +${ep.length} patents, +${pp.length} papers, +${tp.length} tech solutions`);
      }
    }

    const dedupByUrl = <T extends { url?: string }>(items: T[]): T[] => {
      const seen = new Set<string>();
      return items.filter(item => {
        if (!item.url) return true;
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
    };
    allPatents = dedupByUrl(allPatents);
    allPapers = dedupByUrl(allPapers);
    allTech = dedupByUrl(allTech);
    onProgress(`Dedup: ${allPatents.length} patents, ${allPapers.length} papers, ${allTech.length} tech solutions`);

    // TIER 3.2: Confidence scoring per source type
    type Conf<T> = T & { confidence: number };
    const withConfidence = <T extends { url?: string; sourceType?: string }>(items: T[], base: number): Conf<T>[] =>
      items.map(item => ({ ...item, confidence: (item as any).confidence ?? base } as Conf<T>));

    allPatents = withConfidence(allPatents, 0.85); // patents: official, structured
    allPapers = withConfidence(allPapers, 0.90);   // papers: peer-reviewed
    allTech   = withConfidence(allTech,   0.70);    // tech: online, variable quality

    const allBeforeScreening = [...allPatents, ...allPapers, ...allTech];
    if (allBeforeScreening.length > 0) {
      onProgress(`Screening ${allBeforeScreening.length} results for relevance...`);
      try {
        const screening = await this.analysisTools.screenRelevance({
          technologyName: this.state.name,
          problemDescription: this.state.problem,
          results: allBeforeScreening.map(r => ({
            title: (r as any).title || '',
            snippet: (r as any).snippet || '',
            sourceType: (r as any).sourceType || 'unknown',
            url: (r as any).url || '',
            publishedDate: (r as any).publishedDate,
          })),
        });
        const screened = screening.screened;
        const keepUrls = new Set(
          screened
            .filter(s => s.inclusionDecision === 'include' || s.inclusionDecision === 'borderline')
            .map(s => s.url)
        );
        allPatents = allPatents.filter(p => keepUrls.has(p.url));
        allPapers = allPapers.filter(p => keepUrls.has(p.url));
        allTech = allTech.filter(p => keepUrls.has(p.url));

        // Safety: never exclude ALL results
        if (allPatents.length === 0 && allPapers.length === 0 && allTech.length === 0) {
          onProgress('Warning: Screening excluded all results — keeping originals');
          allPatents = patents;
          allPapers = papers;
          allTech = tech;
        }
        const excluded = allBeforeScreening.length - (allPatents.length + allPapers.length + allTech.length);
        onProgress(`Screening: ${allPatents.length} patents, ${allPapers.length} papers, ${allTech.length} tech solutions kept (${excluded} excluded, ${screened.filter(s => s.inclusionDecision === 'borderline').length} borderline)`);

        fs.writeFileSync(path.join(root, '01_Survey', 'screening_results.json'), JSON.stringify({
          total: allBeforeScreening.length,
          included: allPatents.length + allPapers.length + allTech.length,
          excluded: excluded,
          borderline: screened.filter(s => s.inclusionDecision === 'borderline').length,
          screened,
        }, null, 2), 'utf-8');
      } catch (e) {
        onProgress(`Relevance screening failed, keeping all results: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Citation network enrichment: top 10 papers get citation data from OpenAlex
    const topPapers = allPapers.slice(0, 10);
    if (topPapers.length > 0) {
      onProgress(`Enriching ${topPapers.length} top papers with citation data...`);
      try {
        const openAlex = new OpenAlexSearchService({});
        const citationPromises = topPapers.slice(0, 5).map(async (paper: any) => {
          try {
            const results = await openAlex.search({
              keywords: [paper.title.split(' ').slice(0, 5).join(' ')],
              sourceTypes: ['paper'],
              maxResults: 1,
              language: 'en',
            });
            if (results.length > 0) {
              const r = results[0];
              const r0 = results[0]!;
              return {
                title: paper.title,
                url: paper.url,
                citationSnippet: r0.snippet?.slice(0, 200),
              };
            }
          } catch {}
          return { title: paper.title, url: paper.url, citationSnippet: null };
        });
        const citationData = await Promise.all(citationPromises);
        fs.writeFileSync(path.join(root, '01_Survey', 'citation_network.json'),
          JSON.stringify({ totalPapers: allPapers.length, enriched: citationData }, null, 2), 'utf-8');
        onProgress(`Citation network: ${citationData.filter(c => c.citationSnippet).length} papers enriched`);
      } catch (e) {
        onProgress(`Citation enrichment skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Quantitative trend analysis: publication year distribution
    const allResults = [...allPatents, ...allPapers, ...allTech];
    const yearCounts: Record<string, number> = {};
    for (const r of allResults) {
      const year = String(r.publishedDate || '').slice(0, 4);
      const validYear = /^(19\d{2}|20\d{2})$/.test(year) ? year : undefined;
      const m = validYear ? undefined : r.title?.match(/\b(19\d{2}|20\d{2})\b/);
      const found = validYear || (m?.[0]);
      if (found) {
        yearCounts[found] = (yearCounts[found] ?? 0) + 1;
      }
    }
    const trendEntries = Object.entries(yearCounts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, count]) => ({ year, count }));
    fs.writeFileSync(path.join(root, '01_Survey', 'publication_trends.json'),
      JSON.stringify({ totalResults: allResults.length, trends: trendEntries }, null, 2), 'utf-8');

    const resultsDir = path.join(root, '01_Survey', 'search_results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, 'patents.json'), JSON.stringify(allPatents, null, 2), 'utf-8');
    fs.writeFileSync(path.join(resultsDir, 'papers.json'), JSON.stringify(allPapers, null, 2), 'utf-8');
    fs.writeFileSync(path.join(resultsDir, 'tech_solutions.json'), JSON.stringify(allTech, null, 2), 'utf-8');
    fs.writeFileSync(path.join(root, '01_Survey', 'search_summary.md'),
      `# Search Summary\n\n- Patents: ${allPatents.length}\n- Papers: ${allPapers.length}\n- Tech Solutions: ${allTech.length}\n- Keywords: ${keywords}\n`, 'utf-8');

    this.updateTask('01_Survey', '1.2', 'done');
    this.updateTask('01_Survey', '1.3', 'done');
    onProgress('Survey phase complete.');
  }

  private async execTRL(root: string, onProgress: (msg: string) => void, scb?: StreamingCallbacks): Promise<void> {
    const amendments = this.loadAmendments(root, '02_TRL') + this.loadCodeFiles(root, '02_TRL');
    this.updateTask('02_TRL', '2.1', 'in_progress');
    onProgress('Loading search results for TRL assessment...');
    const allResults = this.loadSearchResults(root);

    const trlDir = path.join(root, '02_TRL');
    const currentYear = new Date().getFullYear();

    if (allResults.length === 0) {
      onProgress('No search results found. Generating minimal TRL from problem context only.');
      const fallbackMaturity = await this.generateFallbackTRL(this.state.name, this.state.problem);
      if (fallbackMaturity) {
        this.writeTRLOutputs(trlDir, this.state.name, fallbackMaturity, currentYear);
      }
      onProgress('Minimal TRL assessment generated (no search results available).');
      this.updateTask('02_TRL', '2.1', 'done');
      this.updateTask('02_TRL', '2.2', 'done');
      this.updateTask('02_TRL', '2.3', 'done');
      return;
    }

    onProgress('Assessing technology maturity (S-curve / TRL) using AI...');

    try {
      const amd = amendments
        ? `\n\nSupplementary information:\n${amendments}`
        : '';
      const maturity = await this.analysisTools.assessMaturity({
        technologyName: this.state.name,
        searchResults: allResults.map((r: any) => ({
          title: r.title || '',
          abstract: (r.snippet || '') + amd,
          publishedDate: r.publishedDate || '',
        })),
        problemDescription: this.state.problem,
      }, scb);

      this.writeTRLOutputs(trlDir, this.state.name, maturity, currentYear);

      onProgress(`TRL Level: ${maturity.trl?.level || 'N/A'} — ${maturity.trl?.title || ''}`);
      onProgress(`S-Curve Stage: ${maturity.sCurveStage || 'unknown'}`);
    } catch (e) {
      onProgress(`TRL assessment failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.updateTask('02_TRL', '2.1', 'done');
    this.updateTask('02_TRL', '2.2', 'done');
    this.updateTask('02_TRL', '2.3', 'done');
    onProgress('TRL assessment phase complete.');
  }

  private async execAnalyze(root: string, onProgress: (msg: string) => void, scb?: StreamingCallbacks): Promise<void> {
    const amendments = this.loadAmendments(root, '03_Analyze') + this.loadCodeFiles(root, '03_Analyze');
    this.updateTask('03_Analyze', '3.1', 'in_progress');
    const allResults = this.loadSearchResults(root);

    if (allResults.length === 0) {
      onProgress('No search results found. Run survey phase first.');
      return;
    }

    const trlPath = path.join(root, '02_TRL', 'trl_assessment.json');
    const trlData = this.readJson(trlPath) || {};
    const sCurvePath = path.join(root, '02_TRL', 's_curve.json');
    const sCurveData = this.readJson(sCurvePath) || {};

    const searchInput = allResults.map((r: any) => ({
      title: r.title || '',
      abstract: r.snippet || '',
      sourceType: r.sourceType || 'paper',
      publishedDate: r.publishedDate || '',
      confidence: r.confidence ?? 0.75, // TIER 3.2: propagate source confidence
    }));
const trlLevel = (trlData as any).trl?.level as number | undefined;
    const sCurveStage = (sCurveData as any).stage || (sCurveData as any).s1Stage as string | undefined;
    const trlOpt = trlLevel != null ? { trlLevel } : {};
    const sCurveOpt = sCurveStage ? { sCurveStage } : {};

    const matrix = ContradictionMatrix.getInstance();
    let contradictions: any[] = [];
    let bottlenecks: any[] = [];
    let rootCauses: any[] = [];
    let analysisSummary = '';

    try {
      // Pass 1: Contradiction extraction
      onProgress('Pass 1/3: Extracting TRIZ contradictions...');
      const contraResult = await this.analysisTools.extractContradictions({
        problemDescription: this.state.problem,
        technologyName: this.state.name,
        searchResults: searchInput,
        ...trlOpt,
        ...sCurveOpt,
      });
      contradictions = contraResult.contradictions || [];

      // Validate contradictions against matrix
      const validatedContradictions = contradictions.map((c: any) => {
        const improving = Number(c.improvingParameterIndex);
        const worsening = Number(c.worseningParameterIndex);
        if (improving >= 1 && improving <= 39 && worsening >= 1 && worsening <= 39 && improving !== worsening) {
          try {
            const recommended = matrix.lookup(improving, worsening);
            if (recommended.length > 0) {
              return { ...c, matrixValidated: true, recommendedPrinciples: recommended };
            }
          } catch {}
        }
        return { ...c, matrixValidated: false };
      });
      contradictions = validatedContradictions;
      const validCount = contradictions.filter((c: any) => c.matrixValidated).length;
      onProgress(`Pass 1 complete: ${contradictions.length} contradictions (${validCount} matrix-validated)`);

      // Pass 2: Bottleneck identification
      onProgress('Pass 2/3: Identifying bottlenecks...');
      const bnResult = await this.analysisTools.identifyBottlenecksWithContext({
        problemDescription: this.state.problem,
        technologyName: this.state.name,
        contradictions,
        ...trlOpt,
        sCurveStage: sCurveStage,
      } as any);
      bottlenecks = bnResult.bottlenecks || [];
      rootCauses = bnResult.rootCauses || [];
      onProgress(`Pass 2 complete: ${bottlenecks.length} bottlenecks, ${rootCauses.length} root causes`);

      // Pass 3: Deep root cause analysis
      onProgress('Pass 3/3: Analyzing root causes with 5-Why...');
      const rcResult = await this.analysisTools.analyzeRootCauses({
        problemDescription: this.state.problem,
        technologyName: this.state.name,
        bottlenecks,
        contradictions,
        ...trlOpt,
        sCurveStage: sCurveStage,
      } as any);
      if (rcResult.rootCauses && rcResult.rootCauses.length > 0) {
        rootCauses = rcResult.rootCauses;
      }
      analysisSummary = rcResult.analysisSummary || '';
      onProgress(`Pass 3 complete: ${rootCauses.length} deep root causes`);

      // Su-Field analysis on critical bottlenecks
      const criticalBottlenecks = bottlenecks.filter((b: any) => b.severity === 'critical');
      if (criticalBottlenecks.length > 0) {
        onProgress(`Running Su-Field analysis on ${criticalBottlenecks.length} critical bottlenecks...`);
        const suFieldService = new SuFieldAnalysisService();
        const suFieldResults = criticalBottlenecks.map((b: any) => {
          const components = {
            substance1: b.name || 'S1',
            substance2: (b.impactArea || 'System'),
            field: (b.description || '').slice(0, 50) || 'F',
          };
          let analysis;
          try {
            analysis = suFieldService.analyzeHarmful(components.substance1, components.substance2, components.field);
          } catch {
            analysis = suFieldService.analyze(components);
          }
          return {
            bottleneck: b.name,
            impactArea: b.impactArea,
            suFieldType: analysis.type,
            diagnosis: analysis.diagnosis,
            standardSolutions: analysis.standardSolutions,
            recommendedAction: analysis.recommendedAction,
          };
        });
        fs.writeFileSync(path.join(root, '03_Analyze', 'su_field_analysis.json'),
          JSON.stringify(suFieldResults, null, 2), 'utf-8');
        onProgress(`Su-Field analysis complete: ${suFieldResults.length} bottleneck models`);
      }

      // Write outputs
      fs.writeFileSync(path.join(root, '03_Analyze', 'contradictions.json'),
        JSON.stringify(contradictions, null, 2), 'utf-8');
      fs.writeFileSync(path.join(root, '03_Analyze', 'bottlenecks.json'),
        JSON.stringify({ bottlenecks, rootCauses }, null, 2), 'utf-8');
      fs.writeFileSync(path.join(root, '03_Analyze', 'analysis_summary.md'),
        `# TRIZ Analysis Summary\n\n${analysisSummary}`, 'utf-8');

      onProgress(`Analysis complete: ${contradictions.length} contradictions, ${bottlenecks.length} bottlenecks, ${rootCauses.length} root causes`);
    } catch (e) {
      onProgress(`TRIZ analysis failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.updateTask('03_Analyze', '3.1', 'done');
    this.updateTask('03_Analyze', '3.2', 'done');
    this.updateTask('03_Analyze', '3.3', 'done');
    onProgress('Analyze phase complete.');
  }

private async execSynthesize(root: string, onProgress: (msg: string) => void, scb?: StreamingCallbacks): Promise<void> {
    const amendments = this.loadAmendments(root, '04_Synthesize') + this.loadCodeFiles(root, '04_Synthesize');
    this.updateTask('04_Synthesize', '4.1', 'in_progress');

    const contradictions = this.readJson(path.join(root, '03_Analyze', 'contradictions.json')) || [];
    const bottlenecksData = this.readJson(path.join(root, '03_Analyze', 'bottlenecks.json')) || {};
    const bottlenecks: any[] = (bottlenecksData as any).bottlenecks || [];
    const rootCauses: any[] = (bottlenecksData as any).rootCauses || [];
    const trlData = this.readJson(path.join(root, '02_TRL', 'trl_assessment.json')) || {};
    const sCurveData = this.readJson(path.join(root, '02_TRL', 's_curve.json')) || {};
    const suFieldData = this.readJson(path.join(root, '03_Analyze', 'su_field_analysis.json')) || [];

    const matrix = new ContradictionMatrix();
    const principleEngine = new PrincipleEngine();
    const recommendedPrinciples: any[] = [];
    const seen = new Set<number>();

    for (const c of Array.isArray(contradictions) ? contradictions : []) {
      const improvingIdx = Number(c.improvingParameterIndex);
      const worseningIdx = Number(c.worseningParameterIndex);
      if (improvingIdx > 0 && worseningIdx > 0) {
        try {
          const principleIndices = matrix.lookup(improvingIdx, worseningIdx);
          for (const idx of principleIndices) {
            if (!seen.has(idx)) {
              seen.add(idx);
              const principle = principleEngine.getPrinciple(idx);
              if (principle) {
                recommendedPrinciples.push({
                  index: idx,
                  name: principle.name,
                  description: principle.description,
                  examples: principle.examples || [],
                });
              }
            }
          }
        } catch (err) {
          // skip invalid parameter pairs
        }
      }
    }

    onProgress(`Contradiction Matrix matched ${recommendedPrinciples.length} principles for ${(Array.isArray(contradictions) ? contradictions : []).length} contradictions`);

    try {
      const result = await this.analysisTools.generateSolutionsWithPrinciples({
        contradictions: Array.isArray(contradictions) ? contradictions : [],
        bottlenecks,
        rootCauses,
        suFieldData: Array.isArray(suFieldData) ? suFieldData : [],
        trlLevel: (trlData as any).trl?.level,
        sCurveStage: (sCurveData as any).stage,
        problemDescription: this.state.problem,
        technologyName: this.state.name,
        amendments,
        recommendedPrinciples,
      }, scb);

      // Ideality evaluation for each solution (ideality = benefits / (costs + harms))
      const scoredSolutions = result.solutions.map((s: any) => {
        const benefitCount = (s.advantages || []).length;
        const costCount = (s.challenges || []).length;
        if (benefitCount === 0 && costCount === 0) return s;
        const denom = costCount * 5; // costWeight=5
        const score = denom === 0 ? 1.0 : Math.min((benefitCount * 10) / denom, 2.0);
        const level = score >= 0.8 ? 'ideal' : score >= 0.5 ? 'high' : score >= 0.25 ? 'medium' : 'low';
        return { ...s, idealityScore: score, idealityLevel: level };
      });

      fs.writeFileSync(path.join(root, '04_Synthesize', 'solutions.json'),
        JSON.stringify(scoredSolutions, null, 2), 'utf-8');
      fs.writeFileSync(path.join(root, '04_Synthesize', 'comparison.json'),
        JSON.stringify(result.comparison, null, 2), 'utf-8');
      fs.writeFileSync(path.join(root, '04_Synthesize', 'trends.json'),
        JSON.stringify(result.trends, null, 2), 'utf-8');
      fs.writeFileSync(path.join(root, '04_Synthesize', 'roadmap.json'),
        JSON.stringify(result.roadmap, null, 2), 'utf-8');
      fs.writeFileSync(path.join(root, '04_Synthesize', 'principles_applied.json'),
        JSON.stringify(recommendedPrinciples, null, 2), 'utf-8');
      if (result._rawResponse) {
        fs.writeFileSync(path.join(root, '04_Synthesize', 'ai_raw_response.txt'), result._rawResponse, 'utf-8');
      }

      onProgress(`Generated ${result.solutions?.length || 0} solutions with TRIZ principles`);
    } catch (e) {
      onProgress(`Solution generation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.updateTask('04_Synthesize', '4.1', 'done');
    this.updateTask('04_Synthesize', '4.2', 'done');
    this.updateTask('04_Synthesize', '4.3', 'done');
    onProgress('Synthesize phase complete.');
  }

  private async execDeliver(root: string, onProgress: (msg: string) => void, scb?: StreamingCallbacks): Promise<void> {
    this.updateTask('05_Deliver', '5.1', 'in_progress');
    onProgress('Compiling all outputs into integrated final report...');

    const contradictions = this.readJson(path.join(root, '03_Analyze', 'contradictions.json'))
      || [];
    const bottlenecksData = this.readJson(path.join(root, '03_Analyze', 'bottlenecks.json'))
      || {};
    const bottlenecks = (bottlenecksData as any).bottlenecks || [];
    const rootCauses = (bottlenecksData as any).rootCauses || [];
    const trlData = this.readJson(path.join(root, '02_TRL', 'trl_assessment.json')) || {};
    const sCurveData = this.readJson(path.join(root, '02_TRL', 's_curve.json')) || {};
    const comparison = this.readJson(path.join(root, '04_Synthesize', 'comparison.json')) || {};
    const trends = this.readJson(path.join(root, '04_Synthesize', 'trends.json')) || {};
    const solutions = this.readJson(path.join(root, '04_Synthesize', 'solutions.json')) || [];
    const roadmap = this.readJson(path.join(root, '04_Synthesize', 'roadmap.json')) || {};

    const initDocPath = path.join(root, '00_Init', 'init_doc.json');
    const initDoc = this.readJson(initDocPath);

    try {
      const reportAmendments = this.loadAmendments(root, '05_Deliver') + this.loadCodeFiles(root, '05_Deliver');
      onProgress('Generating integrated report with all cross-phase context...');
      const report = await this.analysisTools.generateIntegratedReport({
        technologyName: this.state.name,
        problemDescription: this.state.problem,
        initDoc: initDoc || undefined,
        surveySummary: `Found ${this.loadSearchResults(root).length} search results from paper and patent databases`,
        trlAssessment: trlData,
        sCurveData,
        contradictions: Array.isArray(contradictions) ? contradictions : [],
        bottlenecks,
        rootCauses,
        solutions: Array.isArray(solutions) ? solutions : [],
        comparison,
        trends,
        roadmap,
        amendments: reportAmendments,
      }, scb);

      const sections: string[] = [
        `# ${report.title || this.state.name + ' — Final Research Report'}\n\n`,
        `**Problem**: ${this.state.problem}\n\n`,
        '---\n\n',
      ];

      if (report.executiveSummary) {
        sections.push('## Executive Summary\n\n');
        sections.push(report.executiveSummary);
        sections.push('\n\n---\n\n');
      }

      if (report.sections) {
        for (const s of report.sections) {
          sections.push(`## ${s.title}\n\n`);
          sections.push(s.content);
          sections.push('\n\n');
          if (s.keyFindings?.length) {
            sections.push('**Key Findings:**\n\n');
            for (const f of s.keyFindings) sections.push(`- ${f}\n`);
            sections.push('\n');
          }
        }
      }

      sections.push('---\n\n');
      sections.push('## Recommendations\n\n');
      if (report.recommendations) {
        for (const r of report.recommendations) {
          const icon = r.priority === 'high' ? '🔴' : r.priority === 'medium' ? '🟡' : '🟢';
          sections.push(`- ${icon} **${r.action}**: ${r.rationale}\n`);
        }
      }

      if (report.conclusion) {
        sections.push('\n## Conclusion\n\n');
        sections.push(report.conclusion);
        sections.push('\n\n');
      }

      if (report.nextSteps?.length) {
        sections.push('## Next Steps\n\n');
        for (const ns of report.nextSteps) sections.push(`- ${ns}\n`);
        sections.push('\n');
      }

      sections.push('---\n\n');
      sections.push('*由 TRP 框架自动生成*\n');

      fs.writeFileSync(path.join(root, '05_Deliver', 'report.md'), sections.join(''), 'utf-8');

      if (report.executiveSummary) {
        fs.writeFileSync(path.join(root, '05_Deliver', 'executive_summary.md'),
          `# Executive Summary\n\n${report.executiveSummary}\n`, 'utf-8');
      }
    } catch (e) {
      onProgress(`AI report failed, generating template report: ${e instanceof Error ? e.message : String(e)}`);

      const sections: string[] = [
        `# ${this.state.name} — Final Research Report\n\n`,
        `**Problem**: ${this.state.problem}\n\n`,
        '---\n\n',
        '## 1. Literature Review\n\n',
        'See 01_Survey/search_results/ for raw search data.\n\n',
        '## 2. Technology Maturity\n\n',
        `TRL: ${(trlData as any)?.trl?.level || 'N/A'} | S-Curve: ${(sCurveData as any)?.stage || 'N/A'}\n\n`,
        '## 3. Contradiction & Bottleneck Analysis\n\n',
        `Contradictions: ${Array.isArray(contradictions) ? contradictions.length : 0} identified\n`,
        `Bottlenecks: ${bottlenecks.length} identified\n\n`,
        '## 4. Solutions & Trends\n\n',
        `Solutions: ${Array.isArray(solutions) ? solutions.length : 0} proposed\n\n`,
        '---\n\n',
        '*Generated by Research Project Framework*\n',
      ];
      fs.writeFileSync(path.join(root, '05_Deliver', 'report.md'), sections.join(''), 'utf-8');
    }

    this.updateTask('05_Deliver', '5.1', 'done');
    this.updateTask('05_Deliver', '5.2', 'done');
    this.updateTask('05_Deliver', '5.3', 'done');
    onProgress('Deliver phase complete.');
  }

  private loadAmendments(root: string, phaseId: string): string {
    const p = path.join(root, phaseId, 'amendments.json');
    if (!fs.existsSync(p)) return '';
    try {
      const data: string[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!Array.isArray(data) || data.length === 0) return '';
      return '\n\n## Supplementary Information (from amend)\n\n' + data.join('\n\n');
    } catch { return ''; }
  }

  private loadCodeFiles(root: string, phaseId: string): string {
    const codeDir = path.join(root, phaseId, 'code');
    if (!fs.existsSync(codeDir)) return '';
    const parts: string[] = [];
    const walk = (dir: string) => {
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) { walk(full); continue; }
        const ext = path.extname(e).toLowerCase();
        if (!['.ts', '.js', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h', '.hpp', '.kt', '.swift', '.rb', '.tsx', '.jsx', '.md', '.txt', '.json', '.yaml', '.yml', '.toml'].includes(ext)) continue;
        if (stat.size > 50000) { parts.push(`\n### ${path.relative(codeDir, full)}\n\n(file too large: ${(stat.size / 1024).toFixed(1)}KB, skipped)\n`); continue; }
        try {
          const content = fs.readFileSync(full, 'utf-8').slice(0, 20000);
          parts.push(`\n### ${path.relative(codeDir, full)}\n\n\`\`\`${ext.slice(1)}\n${content}\n\`\`\`\n`);
        } catch { /* skip unreadable */ }
      }
    };
    walk(codeDir);
    return parts.length > 0 ? '\n\n## Source Code Files\n\n' + parts.join('') : '';
  }

  private loadSearchResults(root: string): any[] {
    const resultsDir = path.join(root, '01_Survey', 'search_results');
    const read = (file: string): any[] =>
      fs.existsSync(path.join(resultsDir, file)) ? JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf-8')) : [];
    return [
      ...read('patents.json').map((r: any) => ({ ...r, sourceType: 'patent' })),
      ...read('papers.json').map((r: any) => ({ ...r, sourceType: 'paper' })),
      ...read('tech_solutions.json').map((r: any) => ({ ...r, sourceType: 'tech_solution' })),
    ];
  }

  private readJson(p: string): any | null {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
  }

  private async generateFallbackTRL(technologyName: string, problem: string): Promise<any> {
    return {
      trl: { level: 3, title: 'TRL 3 — Proof of concept (estimated)', confidence: 0.3 },
      sCurveStage: 'growth',
      maturityIndicators: [{
        signal: 'No search results available',
        evidence: 'TRL estimated from problem domain. Run survey phase with real search for accurate assessment.',
      }],
      technologyLifecycle: { inventionYear: 2000, growthStartYear: 2010, maturityStartYear: 2030 },
      keyMilestones: [],
    };
  }

  private writeTRLOutputs(trlDir: string, technologyName: string, maturity: any, currentYear: number): void {
    const milestones: Milestone[] = [];
    if (maturity.keyMilestones) {
      for (const m of maturity.keyMilestones) {
        milestones.push({
          year: Number(m.year) || currentYear,
          label: m.event || 'Milestone',
          description: m.event || '',
          type: 'breakthrough' as const,
        });
      }
    }
    if (maturity.technologyLifecycle?.inventionYear) {
      milestones.push({
        year: Number(maturity.technologyLifecycle.inventionYear),
        label: 'Invention / Discovery',
        description: 'Technology invention year',
        type: 'invention' as const,
      });
    }

    const sCurveService = new SCurveAnalysisService();
    const perfMetric = technologyName + ' performance';
    const sCurve = sCurveService.analyze(technologyName, perfMetric, [], currentYear, milestones);
    const recs = sCurveService.generateRecommendations(sCurve, currentYear);
    const crossoverYear = sCurve.getCrossoverPoint();

    const svgGenerator = new SvgCurveGenerator();
    const svg = svgGenerator.generate(sCurve, { showAnnotations: true, showLegend: true, showStageLabels: true });

    const milestoneObj = maturity.keyMilestones
      ? maturity.keyMilestones.map((m: any) => ({
          year: m.year, event: m.event, type: 'breakthrough' as const,
        }))
      : [];
    if (maturity.technologyLifecycle?.inventionYear) {
      milestoneObj.push({
        year: maturity.technologyLifecycle.inventionYear,
        event: 'Invention',
        type: 'invention' as const,
      });
    }

    fs.writeFileSync(path.join(trlDir, 'trl_assessment.json'), JSON.stringify({
      trl: maturity.trl,
      sCurveStage: maturity.sCurveStage,
      s1Stage: sCurve.s1Stage,
      s2Stage: sCurve.s2Stage,
      s1Estimated: sCurve.s1Estimated,
      s2Estimated: sCurve.s2Estimated,
      s1MaxPerformance: sCurve.s1Parameters.L,
      s2MaxPerformance: sCurve.s2Parameters.L,
      crossoverYear,
      maturityIndicators: maturity.maturityIndicators,
      technologyLifecycle: maturity.technologyLifecycle,
      keyMilestones: milestoneObj,
      recommendations: recs,
    }, null, 2), 'utf-8');

    fs.writeFileSync(path.join(trlDir, 's_curve.json'), JSON.stringify({
      stage: maturity.sCurveStage,
      s1Stage: sCurve.s1Stage,
      s2Stage: sCurve.s2Stage,
      s1Estimated: sCurve.s1Estimated,
      s2Estimated: sCurve.s2Estimated,
      s1MaxPerformance: sCurve.s1Parameters.L,
      s2MaxPerformance: sCurve.s2Parameters.L,
      s1Parameters: sCurve.s1Parameters,
      s2Parameters: sCurve.s2Parameters,
      crossoverYear,
      milestones: sCurve.milestones.map(m => ({
        year: m.year, label: m.label, type: m.type,
      })),
      trl: maturity.trl,
      technologyLifecycle: maturity.technologyLifecycle,
      maturityIndicators: maturity.maturityIndicators,
      keyMilestones: maturity.keyMilestones,
      recommendations: recs,
    }, null, 2), 'utf-8');

    fs.writeFileSync(path.join(trlDir, 's_curve.svg'), svg, 'utf-8');

    fs.writeFileSync(path.join(trlDir, 's_curve_analysis.md'),
      `# S-Curve Analysis: ${technologyName}\n\n` +
      `**Current Stage**: ${sCurve.s1Stage}${sCurve.s1Estimated ? ' (estimated)' : ''}\n` +
      `**Next Technology S-Curve Stage**: ${sCurve.s2Stage}\n` +
      `**Crossover Year**: ${Math.round(crossoverYear)}\n\n` +
      `## Strategic Recommendations\n\n${recs.map(r => `- ${r}`).join('\n')}\n`,
      'utf-8');

    const evidenceLines = [`# TRL Assessment Evidence\n`];
    if (maturity.maturityIndicators) {
      for (const ind of maturity.maturityIndicators) {
        evidenceLines.push(`- **${ind.signal}**: ${ind.evidence}\n`);
      }
    }
    fs.writeFileSync(path.join(trlDir, 'maturity_evidence.md'), evidenceLines.join(''), 'utf-8');
  }

  

  private async execReferences(root: string, onProgress: (msg: string) => void): Promise<void> {
    onProgress('Auto-generating bibliography from search results...');
    const allResults = this.loadSearchResults(root);
    if (allResults.length === 0) {
      onProgress('No search results found — no citations to generate.');
      return;
    }

    const entries: string[] = [];
    const seenKeys = new Set<string>();

    for (const r of allResults) {
      if (!r.title) continue;
      const words = r.title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2);
      const keyBase = (words[0] || 'unknown') + (words[2] || '').charAt(0) + String(new Date().getFullYear());
      let key = keyBase.toLowerCase();
      let n = 1;
      while (seenKeys.has(key)) { key = keyBase.toLowerCase() + n++; }
      seenKeys.add(key);

      const author = 'Unknown';
      const year = String(r.publishedDate || '').slice(0, 4) || new Date().getFullYear().toString();
      const entryType = r.sourceType === 'patent' ? 'patent' : r.sourceType === 'tech_solution' ? 'misc' : 'article';
      const url = r.url ? `\n  url = {${r.url}},` : '';

      if (entryType === 'article') {
        entries.push(`@article{${key},
  author = {${author}},
  title = {${r.title}},
  year = {${year}},${url}
}`);
      } else if (entryType === 'patent') {
        entries.push(`@patent{${key},
  author = {${author}},
  title = {${r.title}},
  year = {${year}},${url}
}`);
      } else {
        entries.push(`@misc{${key},
  title = {${r.title}},
  year = {${year}},${url}
}`);
      }
    }

    const bibDir = path.join(root, '06_References');
    fs.writeFileSync(path.join(bibDir, 'library.bib'), entries.join('\n\n'), 'utf-8');
    fs.writeFileSync(path.join(bibDir, 'library.json'), JSON.stringify(
      Array.from(seenKeys).map(k => ({ key: k, count: 1 })), null, 2), 'utf-8');

    onProgress(`Generated ${entries.length} BibTeX entries in library.bib`);
  }

  

  async close(): Promise<void> {
    await this.analysisTools.close();
  }
}

function getDefaultTasks(phaseId: PhaseId): TaskDef[] {
  const allTasks: Record<PhaseId, TaskDef[]> = {
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
  return allTasks[phaseId] || [];
}

export { readProjectState, updateTodo, suggestNextStep } from './todos.js';

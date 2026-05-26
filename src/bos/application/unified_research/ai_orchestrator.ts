import { Agent, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../../infrastructure/agent-factory.js';
import { SearchResult } from '../../domain/solution/search_port.js';
import { CachedSearchService } from '../../infrastructure/search/cached_search.js';
import { streamAgent, streamAgentCollect } from '../../infrastructure/ai/streaming.js';
import { ResearchAnalysisTools } from '../../infrastructure/ai/research_analysis_tools.js';
import {
  UnifiedResearchRequest,
  UnifiedResearchResult,
  ResearchError,
  ResearchMetadata,
  PriorArtItem,
} from './types.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt, t, progressMsg } from '../../domain/shared/i18n.js';
import { setupProxy } from '../../infrastructure/search/proxy_fetch.js';

export interface AIResearchConfig {
  maxSearchResults?: number;
  onProgress?: (step: string, message: string) => void;
  onThinking?: (text: string) => void;
  showThinking?: boolean;
  skillContent?: string;
  preferences?: string;
}

export class AIResearchOrchestrator {
  private agent: Agent | null = null;
  private brain: BrainOS;
  private tools: any[];
  private hooks: any[];
  private searchService: CachedSearchService;
  private analysisTools: ResearchAnalysisTools;
  private errors: ResearchError[] = [];
  private metadata: Partial<ResearchMetadata> = {};
  private locale: LocaleConfig;

  constructor(
    brain: BrainOS,
    searchService: CachedSearchService,
    analysisTools: ResearchAnalysisTools,
    tools: any[] = [],
    hooks: any[] = [],
    locale?: LocaleConfig,
  ) {
    this.brain = brain;
    this.searchService = searchService;
    this.analysisTools = analysisTools;
    this.tools = tools;
    this.hooks = hooks;
    this.locale = locale || DEFAULT_LOCALE;
  }

  async initialize(): Promise<void> {
    setupProxy();

    const langPrefix = this.locale.language === 'zh'
      ? '【中文模式】你必须用中文进行所有思考、推理和输出。\n\n'
      : '';

    await this.analysisTools.initialize();

    initAgentFactory(this.brain, {
      defaultTools: this.tools,
      defaultHooks: this.hooks,
    });

    const orchestrator = this;

    const factory = getAgentFactory();
    const builder = factory.create({
      name: 'triz-research-orchestrator',
      systemPrompt: `${langPrefix}You are a TRIZ research expert. Your task is to produce a comprehensive technical research report by following a structured workflow using your tools.

REQUIRED REPORT SECTIONS (in order):
1. Patent Landscape Map — technology trends, top assignees, filing activity
2. Academic Literature Review — key papers, research directions, emerging findings
3. Technical Solutions Analysis — practical implementations, product approaches
4. Technology Bottlenecks — critical unresolved challenges with TRIZ contradiction mapping
5. Technology Maturity Assessment — TRL, S-curve stage, key milestones
6. Technology Trends Forecast — convergence direction, disruptive threats, time horizons
7. TRIZ Contradiction Analysis — identified contradictions with inventive principle recommendations
8. Comparative Analysis — comparison matrix of different technical approaches
9. Recommendations — prioritized actionable next steps citing specific prior art

WORKFLOW — You MUST follow these phases in order:

PHASE 1 — SEARCH
- Extract 3-5 core keywords per query language (EN + ZH)
- Use search_prior_art to find patents, papers, and tech solutions
- Collect all search results before moving on

PHASE 2 — TRIZ ANALYSIS (analyze each result)
- For each patent/paper/tech solution found in search: call analyze_prior_art
- Collect the TRIZ parameter mappings, principle applications, and summaries

PHASE 3 — SYNTHESIS
- Call identify_bottlenecks with the summarized search data
- Call assess_maturity with publication dates and technology context  
- Call forecast_trends with bottlenecks + maturity data
- Call compare_approaches to compare different technical paths

PHASE 4 — REPORT GENERATION
- Using ALL gathered data from phases 1-3, compile the final report
- Include ALL 9 required sections with substantial detail
- Cite specific patents/papers by title and URL in the report
- End with numbered references section listing all cited prior art

CRITICAL RULES — VIOLATING ANY OF THESE PRODUCES A USELESS REPORT:
- You MUST call search_prior_art as your VERY FIRST action. Do NOT write anything before searching.
- If search returns 0 results for a category, explicitly state "No patents/papers/tech solutions found" in the report.
- You MUST call at least one analysis tool (analyze_prior_art, identify_bottlenecks, assess_maturity, forecast_trends, compare_approaches) before writing the final report.
- NEVER fabricate data — if search returns nothing, the report section for that category should say "No data available from search."
- Each fact in the report MUST be traceable to a tool result. If you cannot trace it, delete it.
- Before writing Phase 4, verify: did I call search_prior_art? Did I call at least one analysis tool? If not, go back and call them.`,

      temperature: 0.3,
      extraTools: [
        {
          name: 'search_prior_art',
          description: 'Search for patents, papers, and tech solutions. Provide focused keyword queries (3-5 terms each). Call with different EN and ZH queries for broader coverage.',
          parameters: {
            type: 'object',
            properties: {
              patentQueryEn: { type: 'string', description: 'English patent search keywords (3-5 terms)' },
              patentQueryZh: { type: 'string', description: 'Chinese patent search keywords (3-5 terms)' },
              paperQueryEn: { type: 'string', description: 'English paper search keywords (3-5 terms)' },
              paperQueryZh: { type: 'string', description: 'Chinese paper search keywords (3-5 terms)' },
              techQueryEn: { type: 'string', description: 'English tech solution keywords (3-5 terms)' },
              techQueryZh: { type: 'string', description: 'Chinese tech solution keywords (3-5 terms)' },
            },
            required: ['patentQueryEn'],
          },
          execute: async (args: any) => {
            const { patentQueryEn, patentQueryZh, paperQueryEn, paperQueryZh, techQueryEn, techQueryZh } = args;
            const maxResults = 5;

            const [pEn, paEn, tEn] = await Promise.all([
              orchestrator.searchService.searchPatents(patentQueryEn || args.paperQueryEn, maxResults),
              orchestrator.searchService.searchPapers(paperQueryEn || args.paperQueryEn, maxResults),
              orchestrator.searchService.searchTechSolutions(techQueryEn || args.techQueryEn, maxResults),
            ]);

            let pZh: SearchResult[] = [], paZh: SearchResult[] = [], tZh: SearchResult[] = [];
            if (patentQueryZh || paperQueryZh || techQueryZh) {
              [pZh, paZh, tZh] = await Promise.all([
                orchestrator.searchService.searchPatents(patentQueryZh || '', maxResults),
                orchestrator.searchService.searchPapers(paperQueryZh || '', maxResults),
                orchestrator.searchService.searchTechSolutions(techQueryZh || '', maxResults),
              ]);
            }

            const mergeResults = (en: SearchResult[], zh: SearchResult[]): Partial<SearchResult>[] => {
              const seen = new Set<string>();
              const merged: Partial<SearchResult>[] = [];
              for (const r of [...en, ...zh]) {
                const key = r.title.toLowerCase().trim();
                if (!seen.has(key)) {
                  seen.add(key);
                  merged.push({
                    title: r.title,
                    snippet: r.snippet.slice(0, 600),
                    url: r.url,
                    publishedDate: r.publishedDate,
                    authors: r.authors,
                  });
                }
              }
              return merged;
            };

            const result = {
              patents: mergeResults(pEn, pZh),
              papers: mergeResults(paEn, paZh),
              techSolutions: mergeResults(tEn, tZh),
              summary: `Found ${pEn.length + pZh.length} patents, ${paEn.length + paZh.length} papers, ${tEn.length + tZh.length} tech solutions`,
            };

            return JSON.stringify(result);
          },
        },
        {
          name: 'analyze_prior_art',
          description: 'Analyze a single patent/paper/tech solution for TRIZ relevance. Returns contradiction parameters, applicable inventive principles, technical summary, and limitations.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Title of the work' },
              abstract: { type: 'string', description: 'Full abstract text of the work' },
              sourceType: { type: 'string', description: 'patent, paper, or tech_solution' },
              problemDescription: { type: 'string', description: 'The overall research problem' },
            },
            required: ['title', 'sourceType', 'problemDescription'],
          },
          execute: async (args: any) => {
            try {
              const result = await orchestrator.analysisTools.analyzePriorArt({
                title: args.title,
                abstract: args.abstract || '',
                sourceType: args.sourceType,
                problemDescription: args.problemDescription,
              });
              return JSON.stringify(result);
            } catch (err) {
              return JSON.stringify({ relevant: false, relevanceScore: 0, error: String(err) });
            }
          },
        },
        {
          name: 'compare_approaches',
          description: 'Compare multiple technical approaches side-by-side. Provide strengths, weaknesses, maturity, trade-offs, and recommendations.',
          parameters: {
            type: 'object',
            properties: {
              approaches: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    improvingParameter: { type: 'string' },
                    worseningParameter: { type: 'string' },
                    trizPrinciples: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, name: { type: 'string' } } } },
                    technologyApproach: { type: 'string' },
                  },
                },
              },
              problemDescription: { type: 'string' },
            },
            required: ['approaches', 'problemDescription'],
          },
          execute: async (args: any) => {
            try {
              const result = await orchestrator.analysisTools.compareApproaches({
                approaches: args.approaches || [],
                problemDescription: args.problemDescription,
              });
              return JSON.stringify(result);
            } catch (err) {
              return JSON.stringify({ error: String(err) });
            }
          },
        },
        {
          name: 'assess_maturity',
          description: 'Assess technology readiness (TRL 1-9), S-curve stage, lifecycle timeline, and key milestones.',
          parameters: {
            type: 'object',
            properties: {
              technologyName: { type: 'string' },
              searchResults: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { title: { type: 'string' }, abstract: { type: 'string' }, publishedDate: { type: 'string' } },
                },
              },
              problemDescription: { type: 'string' },
            },
            required: ['technologyName', 'problemDescription'],
          },
          execute: async (args: any) => {
            try {
              const result = await orchestrator.analysisTools.assessMaturity({
                technologyName: args.technologyName,
                searchResults: args.searchResults || [],
                problemDescription: args.problemDescription,
              });
              return JSON.stringify(result);
            } catch (err) {
              return JSON.stringify({ error: String(err) });
            }
          },
        },
        {
          name: 'identify_bottlenecks',
          description: 'Identify critical technology bottlenecks with TRIZ contradiction mapping for each.',
          parameters: {
            type: 'object',
            properties: {
              technologyName: { type: 'string' },
              searchResults: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { title: { type: 'string' }, abstract: { type: 'string' } },
                },
              },
              problemDescription: { type: 'string' },
              currentTRL: { type: 'number' },
              currentSCurveStage: { type: 'string' },
            },
            required: ['technologyName', 'problemDescription'],
          },
          execute: async (args: any) => {
            try {
              const result = await orchestrator.analysisTools.identifyBottlenecks({
                technologyName: args.technologyName,
                searchResults: args.searchResults || [],
                problemDescription: args.problemDescription,
                currentTRL: args.currentTRL || 5,
                currentSCurveStage: args.currentSCurveStage || 'growth',
              });
              return JSON.stringify(result);
            } catch (err) {
              return JSON.stringify({ error: String(err) });
            }
          },
        },
        {
          name: 'forecast_trends',
          description: 'Forecast technology trends — convergence points, disruptive threats, time horizons, and actionable recommendations.',
          parameters: {
            type: 'object',
            properties: {
              technologyName: { type: 'string' },
              searchResults: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { title: { type: 'string' }, abstract: { type: 'string' }, publishedDate: { type: 'string' } },
                },
              },
              bottlenecks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { name: { type: 'string' }, severity: { type: 'string' } },
                },
              },
              currentSCurveStage: { type: 'string' },
              problemDescription: { type: 'string' },
            },
            required: ['technologyName', 'problemDescription'],
          },
          execute: async (args: any) => {
            try {
              const result = await orchestrator.analysisTools.forecastTrends({
                technologyName: args.technologyName,
                searchResults: args.searchResults || [],
                bottlenecks: args.bottlenecks || [],
                currentSCurveStage: args.currentSCurveStage || 'growth',
                problemDescription: args.problemDescription,
              });
              return JSON.stringify(result);
            } catch (err) {
              return JSON.stringify({ error: String(err) });
            }
          },
        },
      ],
    });

    this.agent = await builder.start();
  }

  async research(
    problemDescription: string,
    config: AIResearchConfig = {},
  ): Promise<UnifiedResearchResult> {
    const lang = this.locale.language;
    const langPrefix = this.locale.language === 'zh'
      ? '【中文模式】你必须用中文进行所有思考、推理和输出。\n\n'
      : '';
    this.errors = [];
    this.metadata = {
      startedAt: Date.now(),
      sourcesUsed: [],
      cacheHits: 0,
      cacheMisses: 0,
      aiCallsMade: 0,
    };

    if (!this.agent) {
      await this.withRetry('initialization', () => this.initialize());
    }

    const onProgress = config.onProgress || (() => {});
    const onThinking = config.onThinking || (() => {});
    const showThinking = config.showThinking ?? true;
    const maxResults = config.maxSearchResults || 5;
    const maxRetries = config.maxRetries || 2;

    // ======= PHASE 1: CODE-FORCED SEARCH =======
    const allSearchResults = await this.executeSearchPhase(
      problemDescription, lang, langPrefix, maxResults, onProgress
    );

    const technologyName = this.parsedTechnologyName || problemDescription.slice(0, 40);

    // ======= PHASE 2: PER-RESULT TRIZ ANALYSIS (sequential — Agent.stream() is not reentrant) =======
    onProgress('analysis', `${progressMsg('analyzingPriorArt', lang)} (${allSearchResults.length} results)...`);
    const artAnalyses: any[] = [];
    for (let i = 0; i < allSearchResults.length; i++) {
      const r = allSearchResults[i];
      const result = await this.withRetry(`prior-art-${i}`, () =>
        this.analysisTools.analyzePriorArt({
          title: r.title,
          abstract: r.snippet,
          sourceType: r.sourceType,
          problemDescription,
        }),
        maxRetries
      );
      artAnalyses.push(result);
      this.metadata.aiCallsMade = (this.metadata.aiCallsMade || 0) + 1;
    }

    // ======= PHASE 3: SYNTHESIS (sequential, each retryable) =======
    onProgress('analysis', `${progressMsg('identifyingBottlenecks', lang)}...`);
    const bottlenecks = await this.withRetry('bottlenecks', () =>
      this.analysisTools.identifyBottlenecks({
        technologyName,
        searchResults: allSearchResults.map(r => ({ title: r.title, abstract: r.snippet })),
        problemDescription,
        currentTRL: 5,
        currentSCurveStage: 'unknown',
      }),
      maxRetries
    );
    this.metadata.aiCallsMade = (this.metadata.aiCallsMade || 0) + 1;

    onProgress('analysis', `${progressMsg('assessingMaturity', lang)}...`);
    const maturity = await this.withRetry('maturity', () =>
      this.analysisTools.assessMaturity({
        technologyName,
        searchResults: allSearchResults.map(r => ({ title: r.title, abstract: r.snippet, publishedDate: r.publishedDate || '' })),
        problemDescription,
      }),
      maxRetries
    );
    this.metadata.aiCallsMade = (this.metadata.aiCallsMade || 0) + 1;

    onProgress('analysis', `${progressMsg('forecastingTrends', lang)}...`);
    const trends = await this.withRetry('trends', () =>
      this.analysisTools.forecastTrends({
        technologyName,
        searchResults: allSearchResults.map(r => ({ title: r.title, abstract: r.snippet, publishedDate: r.publishedDate || '' })),
        bottlenecks: (bottlenecks?.bottlenecks || []).map((b: any) => ({ name: b.name, severity: b.severity })),
        currentSCurveStage: maturity?.sCurveStage || 'unknown',
        problemDescription,
      }),
      maxRetries
    );
    this.metadata.aiCallsMade = (this.metadata.aiCallsMade || 0) + 1;

    onProgress('analysis', `${progressMsg('comparingApproaches', lang)}...`);
    const comparison = await this.withRetry('comparison', () =>
      this.analysisTools.compareApproaches({
        approaches: artAnalyses
          .filter((a: any) => a && a.relevant !== false)
          .map((a: any) => ({
            title: a.summary?.slice(0, 60) || 'Unknown',
            summary: a.summary || a.keyFindings?.join('; ') || '',
            improvingParameter: a.improvingParameter || 'unknown',
            worseningParameter: a.worseningParameter || 'unknown',
            trizPrinciples: a.trizPrinciples || [],
            technologyApproach: a.technologyApproach || 'unknown',
          })),
        problemDescription,
      }),
      maxRetries
    );
    this.metadata.aiCallsMade = (this.metadata.aiCallsMade || 0) + 1;

    // ======= PHASE 4: REPORT GENERATION =======
    onProgress('report', `${progressMsg('generatingReport', lang)}...`);
    const finalReport = await this.generateReport({
      lang, langPrefix, problemDescription, config,
      allSearchResults, artAnalyses, bottlenecks, maturity, trends, comparison, technologyName,
      onProgress, onThinking, showThinking
    });

    this.metadata.completedAt = Date.now();
    this.metadata.durationMs = this.metadata.completedAt - (this.metadata.startedAt || 0);
    this.metadata.sourcesUsed = allSearchResults.length > 0
      ? [...new Set(allSearchResults.map(r => r.sourceType))]
      : [];

    return {
      summary: finalReport || t('noReportGenerated', lang),
      priorArt: {
        patents: allSearchResults.filter(r => r.sourceType === 'patent') as PriorArtItem[],
        papers: allSearchResults.filter(r => r.sourceType === 'paper') as PriorArtItem[],
        techSolutions: allSearchResults.filter(r => r.sourceType === 'tech_solution') as PriorArtItem[],
      },
      recommendations: [],
      errors: this.errors,
      metadata: this.metadata as ResearchMetadata,
    };
  }

  private parsedTechnologyName = '';

  private async executeSearchPhase(
    problemDescription: string, lang: string, langPrefix: string, maxResults: number,
    onProgress: (phase: string, msg: string) => void
  ): Promise<{ title: string; snippet: string; url: string; publishedDate?: string; authors?: string[]; sourceType: string }[]> {
    onProgress('search', `CODE-FORCED: ${progressMsg('extractingKeywords', lang)}...`);
    let allSearchResults: { title: string; snippet: string; url: string; publishedDate?: string; authors?: string[]; sourceType: string }[] = [];

    try {
      const keywordPrompt = `${langPrefix}Extract research keywords. Return ONLY JSON.

Problem: ${problemDescription}

{
  "patentQueryEn": "3-5 English patent keywords",
  "patentQueryZh": "3-5 Chinese patent keywords",
  "paperQueryEn": "3-5 English paper keywords",
  "paperQueryZh": "3-5 Chinese paper keywords",
  "techQueryEn": "3-5 English tech solution keywords",
  "techQueryZh": "3-5 Chinese tech solution keywords",
  "technologyName": "short technology name"
}`;

      const keywordResponse = await streamAgentCollect(this.agent!, keywordPrompt);
      this.metadata.aiCallsMade = (this.metadata.aiCallsMade || 0) + 1;
      const kw = this.parseKeywords(keywordResponse);
      this.parsedTechnologyName = kw.technologyName;

      const [[pEn, paEn, tEn], [pZh, paZh, tZh]] = await Promise.all([
        Promise.all([
          this.searchService.searchPatents(kw.patentQueryEn, maxResults),
          this.searchService.searchPapers(kw.paperQueryEn, maxResults),
          this.searchService.searchTechSolutions(kw.techQueryEn, maxResults),
        ]),
        Promise.all([
          this.searchService.searchPatents(kw.patentQueryZh || kw.patentQueryEn, maxResults),
          this.searchService.searchPapers(kw.paperQueryZh || kw.paperQueryEn, maxResults),
          this.searchService.searchTechSolutions(kw.techQueryZh || kw.techQueryEn, maxResults),
        ]),
      ]);

      const pushResults = (items: SearchResult[], sourceType: string) => {
        for (const item of items) {
          allSearchResults.push({
            title: item.title,
            snippet: item.snippet.slice(0, 600),
            url: item.url,
            publishedDate: item.publishedDate,
            authors: item.authors,
            sourceType,
          });
        }
      };

      pushResults(pEn, 'patent');
      pushResults(paEn, 'paper');
      pushResults(tEn, 'tech_solution');
      pushResults(pZh, 'patent');
      pushResults(paZh, 'paper');
      pushResults(tZh, 'tech_solution');

      const seen = new Set<string>();
      allSearchResults = allSearchResults.filter(r => {
        const key = r.title.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      onProgress('search', `${progressMsg('foundResults', lang)} ${allSearchResults.length} results total`);
    } catch (err) {
      this.addError('search', `Code-forced search failed: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }

    return allSearchResults;
  }

  private async generateReport(params: {
    lang: string; langPrefix: string; problemDescription: string; config: AIResearchConfig;
    allSearchResults: any[]; artAnalyses: any[]; bottlenecks: any; maturity: any; trends: any; comparison: any; technologyName: string;
    onProgress: (phase: string, msg: string) => void; onThinking: (text: string) => void; showThinking: boolean;
  }): Promise<string> {
    const { lang, langPrefix, problemDescription, config, allSearchResults, artAnalyses, bottlenecks, maturity, trends, comparison, technologyName } = params;

    const searchDataBlock = allSearchResults.length > 0
      ? allSearchResults.map(r =>
          `[${r.sourceType.toUpperCase()}] ${r.title} (${r.publishedDate || 'N/A'})\n  Abstract: ${r.snippet}\n  URL: ${r.url}`
        ).join('\n\n')
      : 'NO SEARCH RESULTS FOUND.';

    const prefs = config.preferences ? `\nRESEARCHER PREFERENCES: ${config.preferences}` : '';

    const analysesBlock = [
      `TRIZ PRIOR ART ANALYSES (${artAnalyses.length} items):`,
      ...artAnalyses.map((a, i) => `[${i + 1}] ${JSON.stringify(a)}`),
      `\nBOTTLENECKS: ${JSON.stringify(bottlenecks)}`,
      `MATURITY: ${JSON.stringify(maturity)}`,
      `TRENDS: ${JSON.stringify(trends)}`,
      `COMPARISON: ${JSON.stringify(comparison)}`,
    ].join('\n');

    const reportPrompt = `${langPrefix}FINAL REPORT GENERATION

TECHNOLOGY: ${technologyName}
PROBLEM: ${problemDescription}${prefs}
${config.skillContent ? `\nDOMAIN KNOWLEDGE:\n${config.skillContent}` : ''}

CITED LITERATURE (${allSearchResults.length} search results):
${searchDataBlock}

ANALYSIS DATA (pre-computed by specialized agents):
${analysesBlock}

Generate a comprehensive data-driven research report with all 9 standard sections.
- Cite specific sources by number: [1], [2], etc. matching the cited literature above.
- The analysis data is pre-computed — synthesize it, do not re-analyze.
- If any data is missing or analysis returned an error, note the gap honestly.
- Express uncertainty where data is limited.
- Use numbered references with a bibliography section at the end.`;

    try {
      const report = await streamAgent(this.agent!, reportPrompt, {
        onThinking: (text) => {
          if (params.showThinking) params.onThinking(text);
        },
        onToolCall: (name) => {
          params.onProgress('tool', `${progressMsg('callingTool', lang)}: ${name}`);
        },
      });
      this.metadata.aiCallsMade = (this.metadata.aiCallsMade || 0) + 1;
      return report;
    } catch (err) {
      this.addError('report', `Report generation failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return this.buildFallbackReport({
        lang, problemDescription, technologyName, allSearchResults, artAnalyses, bottlenecks, maturity, trends, comparison, config
      });
    }
  }

  private buildFallbackReport(data: {
    lang: string; problemDescription: string; technologyName: string;
    allSearchResults: any[]; artAnalyses: any[]; bottlenecks: any; maturity: any; trends: any; comparison: any; config: AIResearchConfig;
  }): string {
    const { lang, problemDescription, technologyName, allSearchResults, artAnalyses, bottlenecks, maturity, trends, comparison, config } = data;
    const results = allSearchResults.map((r, i) => `[${i + 1}] **${r.title}** (${r.sourceType}) — ${r.snippet.slice(0, 150)}`);
    const sections = [
      `# ${technologyName} Research Report\n\n**Problem:** ${problemDescription}\n`,
      `## Methodology\n${t('methodologyText', lang)} (${allSearchResults.length} sources, ${artAnalyses.length} analyzed)`,
      `## Search Results\n${results.join('\n') || 'No search results found.'}`,
      `## TRIZ Analysis\n\`\`\`json\n${JSON.stringify({ bottlenecks, maturity, trends, comparison }, null, 2)}\n\`\`\``,
    ];
    if (config.preferences) {
      sections.push(`## Notes\nResearcher preferences: ${config.preferences}`);
    }
    return sections.join('\n\n');
  }

  private async withRetry<T>(
    phase: string,
    fn: () => Promise<T>,
    maxRetries = 2,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          this.addError(phase, `Phase ${phase} attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}. Retrying...`, 'warning');
        }
      }
    }
    this.addError(phase, `Phase ${phase} failed after ${maxRetries + 1} attempts: ${lastErr instanceof Error ? (lastErr as Error).message : String(lastErr)}`, 'error');
    throw lastErr;
  }

  private parseKeywords(raw: string): { patentQueryEn: string; patentQueryZh: string; paperQueryEn: string; paperQueryZh: string; techQueryEn: string; techQueryZh: string; technologyName: string } {
    const defaults = { patentQueryEn: 'patent technology', patentQueryZh: '', paperQueryEn: 'research paper', paperQueryZh: '', techQueryEn: 'technical solution', techQueryZh: '', technologyName: 'Technology' };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return defaults;
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        patentQueryEn: parsed.patentQueryEn || defaults.patentQueryEn,
        patentQueryZh: parsed.patentQueryZh || '',
        paperQueryEn: parsed.paperQueryEn || defaults.paperQueryEn,
        paperQueryZh: parsed.paperQueryZh || '',
        techQueryEn: parsed.techQueryEn || defaults.techQueryEn,
        techQueryZh: parsed.techQueryZh || '',
        technologyName: parsed.technologyName || defaults.technologyName,
      };
    } catch {
      return defaults;
    }
  }

  private addError(component: string, message: string, severity: 'warning' | 'error'): void {
    this.errors.push({
      component,
      message,
      severity,
      timestamp: Date.now(),
    });
  }

  async close(): Promise<void> {
    if (this.agent) {
      await this.agent.close();
      this.agent = null;
    }
    await this.analysisTools.close();
  }
}
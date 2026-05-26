import { SearchResult } from '../../domain/solution/search_port.js';
import { CachedSearchService } from '../../infrastructure/search/cached_search.js';
import { ContradictionAnalysisService } from '../../domain/contradiction/services.js';
import { ContradictionMatrix } from '../../domain/contradiction/matrix.js';
import { PrincipleEngine } from '../../domain/principle/services.js';
import { AnalyzeSCurveHandler } from '../analyze_s_curve/handler.js';
import { TRLAssessor } from '../../infrastructure/triz/trl_assessor.js';
import { AiSCurveDataExtractor } from '../../infrastructure/s_curve/ai_data_extractor.js';
import {
  UnifiedResearchRequest,
  UnifiedResearchResult,
  ResearchError,
  PriorArtItem,
} from './types.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LocaleConfig, DEFAULT_LOCALE, t, stageLabel, stageStrategy, trlTitle, progressMsg, srv } from '../../domain/shared/i18n.js';

export class UnifiedResearchService {
  private searchService: CachedSearchService;
  private contradictionService: ContradictionAnalysisService;
  private principleEngine: PrincipleEngine;
  private sCurveHandler: AnalyzeSCurveHandler;
  private trlAssessor: TRLAssessor;
  private dataExtractor: AiSCurveDataExtractor;
  private errors: ResearchError[] = [];
  private locale: LocaleConfig;

  constructor(deps: {
    searchService: CachedSearchService;
    contradictionService: ContradictionAnalysisService;
    principleEngine: PrincipleEngine;
    sCurveHandler: AnalyzeSCurveHandler;
    trlAssessor: TRLAssessor;
    dataExtractor: AiSCurveDataExtractor;
    locale?: LocaleConfig;
  }) {
    this.searchService = deps.searchService;
    this.contradictionService = deps.contradictionService;
    this.principleEngine = deps.principleEngine;
    this.sCurveHandler = deps.sCurveHandler;
    this.trlAssessor = deps.trlAssessor;
    this.dataExtractor = deps.dataExtractor;
    this.locale = deps.locale || DEFAULT_LOCALE;
  }

  async research(request: UnifiedResearchRequest): Promise<UnifiedResearchResult> {
    const lang = this.locale.language;
    this.errors = [];
    const maxResults = request.maxSearchResults !== undefined ? request.maxSearchResults : 5;
    const searchQuery = request.searchQuery || request.problemDescription;
    const onProgress = request.onProgress || (() => {});

    // Step 1: Search prior art (real data from free APIs) - skip if maxResults is 0
    let patents: SearchResult[] = [];
    let papers: SearchResult[] = [];
    let techSolutions: SearchResult[] = [];

    if (maxResults > 0) {
      try {
        onProgress('search', `${progressMsg('searching', lang)}...`);
        [patents, papers, techSolutions] = await Promise.all([
          this.searchService.searchPatents(searchQuery, maxResults),
          this.searchService.searchPapers(searchQuery, maxResults),
          this.searchService.searchTechSolutions(searchQuery, maxResults),
        ]);
        onProgress('search', `${progressMsg('foundResults', lang)} ${patents.length} ${progressMsg('patents', lang)}, ${papers.length} ${progressMsg('papers', lang)}, ${techSolutions.length} ${progressMsg('techSolutions', lang)}`);
      } catch (err) {
        this.addError('search', `${progressMsg('failedSearch', lang) || 'Search failed'}: ${err instanceof Error ? err.message : String(err)}`, 'warning');
      }
    }

    // Step 2: Analyze contradiction if parameters provided
    let contradictionAnalysis;
    if (request.improvingParameter && request.worseningParameter) {
      const improvingParam = this.resolveParameter(request.improvingParameter);
      const worseningParam = this.resolveParameter(request.worseningParameter);

      if (improvingParam && worseningParam) {
        try {
          onProgress('contradiction', `${progressMsg('lookingUpMatrix', lang) || 'Looking up matrix'}: ${request.improvingParameter} vs ${request.worseningParameter}...`);
          const result = this.contradictionService.analyze(
            improvingParam,
            worseningParam,
            request.problemDescription,
          );
          contradictionAnalysis = {
            improvingParameter: request.improvingParameter,
            worseningParameter: request.worseningParameter,
            contradictionId: result.contradiction.id,
            principles: result.principles.map(p => ({
              index: p.index,
              name: p.name,
              description: p.description,
            })),
          };
          onProgress('contradiction', `${progressMsg('foundPrinciples', lang) || 'Found'} ${result.principles.length} ${progressMsg('principles', lang)}: ${result.principles.slice(0, 3).map(p => `#${p.index} ${p.name}`).join(', ')}`);
        } catch (err) {
          this.addError('contradiction', `${progressMsg('contradictionFailed', lang)}: ${err instanceof Error ? err.message : String(err)}`, 'warning');
        }
      } else {
        this.addError('contradiction', `${progressMsg('couldNotResolve', lang) || 'Could not resolve parameters'}: improving="${request.improvingParameter}", worsening="${request.worseningParameter}"`, 'warning');
      }
    }

    // Step 3: Analyze S-curve and TRL if technology provided
    let technologyMaturity;
    if (request.technologyName && request.performanceMetric) {
      try {
        onProgress('s_curve', `${progressMsg('extractingSCurve', lang)} ${request.technologyName} (${request.performanceMetric})...`);
        const extracted = await this.dataExtractor.extractData(
          request.technologyName,
          request.performanceMetric,
        );

        const hasRealData = extracted.dataPoints && extracted.dataPoints.length > 0;
        const isEstimated = !hasRealData;
        onProgress('s_curve', `${progressMsg('dataPoints', lang)}: ${extracted.dataPoints?.length || 0} (${isEstimated ? t('report.estimated', lang) : t('report.real', lang)})`);

        if (!hasRealData) {
          this.addError('s_curve', progressMsg('noRealData', lang), 'warning');
        }

        onProgress('s_curve', progressMsg('fittingCurve', lang));
        const sCurveResult = await this.sCurveHandler.execute({
          technologyName: request.technologyName,
          performanceMetric: request.performanceMetric,
          dataPoints: extracted.dataPoints || [],
          milestones: extracted.milestones || [],
        });
        onProgress('s_curve', `S1 ${progressMsg('stage', lang)}: ${t('report.sCurveStage', lang)} ${sCurveResult.s1Stage}, S2 ${progressMsg('stage', lang)}: ${sCurveResult.s2Stage}, ${progressMsg('crossover', lang)}: ~${sCurveResult.crossoverYear}`);

        // Save SVG to file
        const svgPath = this.saveSvgToFile(sCurveResult.svg, request.technologyName);
        onProgress('s_curve', `${progressMsg('svgSaved', lang)}: ${svgPath}`);

        if (sCurveResult.s1TRL && sCurveResult.s2TRLRange) {
          technologyMaturity = {
            sCurveStage: sCurveResult.s1Stage,
            sCurveStageNext: sCurveResult.s2Stage,
            crossoverYear: sCurveResult.crossoverYear,
            trl: {
              level: sCurveResult.s1TRL.level,
              title: sCurveResult.s1TRL.title,
              confidence: sCurveResult.s1TRL.confidence,
              isEstimated,
            },
            trlNext: {
              min: sCurveResult.s2TRLRange.min,
              max: sCurveResult.s2TRLRange.max,
              mostLikely: sCurveResult.s2TRLRange.mostLikely,
            },
            sCurveData: {
              isEstimated,
              dataPointCount: extracted.dataPoints?.length || 0,
              confidence: isEstimated ? 0.3 : 0.8,
            },
            svgPath,
            unicodeChart: sCurveResult.unicodeChart,
            milestones: sCurveResult.milestones,
          };
        }
      } catch (err) {
        this.addError('s_curve', `${progressMsg('sCurveFailed', lang)}: ${err instanceof Error ? err.message : String(err)}`, 'warning');
      }
    }

    // Build prior art items
    const toPriorArt = (items: SearchResult[], type: 'patent' | 'paper' | 'tech_solution'): PriorArtItem[] =>
      items.map(item => ({ ...item, sourceType: type }));

    // Step 4: Generate recommendations (with citations to specific prior art)
    const recommendations = this.generateRecommendations({
      contradictionAnalysis,
      priorArt: {
        patents: toPriorArt(patents, 'patent'),
        papers: toPriorArt(papers, 'paper'),
        techSolutions: toPriorArt(techSolutions, 'tech_solution'),
      },
      technologyMaturity,
      problemDescription: request.problemDescription,
      preferences: request.preferences,
    });

    // Step 5: Build comprehensive report
    const summary = this.buildReport(request, {
      contradictionAnalysis,
      priorArt: {
        patents: toPriorArt(patents, 'patent'),
        papers: toPriorArt(papers, 'paper'),
        techSolutions: toPriorArt(techSolutions, 'tech_solution'),
      },
      technologyMaturity,
      preferences: request.preferences,
    });

    return {
      summary,
      contradictionAnalysis,
      priorArt: {
        patents: toPriorArt(patents, 'patent'),
        papers: toPriorArt(papers, 'paper'),
        techSolutions: toPriorArt(techSolutions, 'tech_solution'),
      },
      technologyMaturity,
      recommendations,
      errors: this.errors,
    };
  }

  private resolveParameter(param: unknown): number | null {
    if (!param) return null;

    if (typeof param === 'number') {
      return param >= 1 && param <= 39 ? param : null;
    }

    if (typeof param === 'string') {
      // Try parsing as number first
      const num = parseInt(param, 10);
      if (!isNaN(num) && num >= 1 && num <= 39) return num;

      // Handle comma-separated parameters (take the first match)
      const parts = param.split(',').map(p => p.trim());
      for (const part of parts) {
        const resolved = this.resolveSingleParameter(part);
        if (resolved !== null) return resolved;
      }
    }

    if (Array.isArray(param) && param.length > 0) {
      return this.resolveParameter(param[0]);
    }

    return null;
  }

  private resolveSingleParameter(input: string): number | null {
    const matrix = ContradictionMatrix.getInstance();
    const allParams = matrix.getAllParameters();
    const lower = input.toLowerCase().trim();

    // Clean up common AI response patterns
    const cleaned = lower
      .replace(/^\d+[\.\)\-]\s*/, '')  // Remove leading "1. ", "2) ", etc.
      .replace(/\(.*?\)/g, '')          // Remove parenthetical notes
      .replace(/\s+/g, ' ')             // Normalize whitespace
      .trim();

    // Exact match
    for (const p of allParams) {
      if (p.name.toLowerCase() === cleaned) return p.index;
    }

    // Parameter name contains the input
    for (const p of allParams) {
      if (p.name.toLowerCase().includes(cleaned)) return p.index;
    }

    // Input contains parameter name
    for (const p of allParams) {
      if (cleaned.includes(p.name.toLowerCase())) return p.index;
    }

    // Keyword-based matching for common AI responses
    const keywordMap: Record<string, number> = {
      'weight': 1,
      'speed': 9,
      'force': 10,
      'strength': 14,
      'stability': 13,
      'temperature': 17,
      'power': 21,
      'energy': 19,
      'time': 25,
      'reliability': 27,
      'accuracy': 28,
      'productivity': 39,
      'complexity': 36,
      'automation': 38,
      'range': 9,
      'duration': 15,
      'cost': 39,
      'volume': 8,
      'area': 6,
      'length': 4,
      'size': 4,
      'shape': 12,
      'brightness': 18,
      'manufactur': 32,
      'repair': 33,
      'adapt': 35,
      'detect': 37,
    };

    for (const [keyword, index] of Object.entries(keywordMap)) {
      if (cleaned.includes(keyword)) return index;
    }

    return null;
  }

  private generateRecommendations(result: {
    contradictionAnalysis?: { principles: Array<{ index: number; name: string; description: string }> };
    priorArt: { patents: PriorArtItem[]; papers: PriorArtItem[]; techSolutions: PriorArtItem[] };
    technologyMaturity?: { trl: { level: number }; sCurveStage: string };
    problemDescription: string;
    preferences?: string;
  }): string[] {
    const lang = this.locale.language;
    const recs: string[] = [];
    const prefs = (result.preferences || '').toLowerCase();

    // Preference-based focus
    const focusCost = prefs.includes('cost') || prefs.includes('成本');
    const focusPerf = prefs.includes('performance') || prefs.includes('性能');
    const focusQuality = prefs.includes('quality') || prefs.includes('质量');
    const focusSpeed = prefs.includes('speed') || prefs.includes('速度');

    // Collect all prior art with their relevance signals
    const allPriorArt = [
      ...result.priorArt.patents.map(p => ({ ...p, category: 'patent' as const })),
      ...result.priorArt.papers.map(p => ({ ...p, category: 'paper' as const })),
      ...result.priorArt.techSolutions.map(t => ({ ...t, category: 'tech_solution' as const })),
    ];
    const topCited = allPriorArt.slice(0, 4);

    // 1. TRIZ principle recommendations with prior art citations
    if (result.contradictionAnalysis && result.contradictionAnalysis.principles.length > 0) {
      const principles = result.contradictionAnalysis.principles.slice(0, 3);
      for (let i = 0; i < principles.length; i++) {
        const p = principles[i];
        const citing = topCited.filter(item =>
          (item.summary?.trizPrinciples || []).some(sp => sp.includes(String(p.index)) || sp.includes(p.name))
        );
        let rec = `${t('applyTrizPrinciples', lang)} **#${p.index} ${p.name}** — ${p.description.slice(0, 80)}`;
        if (citing.length > 0) {
          rec += `\n  - ${t('supportingPriorArt', lang)}: ${citing.map(c => `[${c.title.slice(0, 50)}](${c.url})`).join(', ')}`;
        } else if (topCited.length > 0) {
          const fallback = topCited[Math.min(i, topCited.length - 1)];
          rec += `\n  - ${t('relatedWork', lang)}: [${fallback.title.slice(0, 50)}](${fallback.url})`;
        }
        recs.push(rec);
      }
    }

    // 2. Prior-art-driven recommendations (cite most relevant items)
    if (topCited.length > 0) {
      const best = topCited[0];
      recs.push(srv('recommendationDeepDive', lang, {
        title: best.title.slice(0, 60),
        url: best.url,
        sourceType: t(`report.type${best.category === 'patent' ? 'Patent' : best.category === 'paper' ? 'Paper' : 'Tech'}`, lang),
      }));
    }

    // 3. Preference-aware recommendation
    if (focusCost && result.contradictionAnalysis) {
      const costPrincipls = result.contradictionAnalysis.principles.filter(p =>
        p.name.toLowerCase().includes('composite') || p.name.toLowerCase().includes('cheap')
      );
      if (costPrincipls.length > 0) {
        recs.push(srv('recommendationCostFocus', lang, {
          principle: costPrincipls.map(p => `#${p.index} ${p.name}`).join(', '),
        }));
      }
    }
    if (focusPerf && result.contradictionAnalysis) {
      const perfPrincipls = result.contradictionAnalysis.principles.filter(p =>
        p.name.toLowerCase().includes('dynam') || p.name.toLowerCase().includes('segment')
      );
      if (perfPrincipls.length > 0) {
        recs.push(srv('recommendationPerfFocus', lang, {
          principle: perfPrincipls.map(p => `#${p.index} ${p.name}`).join(', '),
        }));
      }
    }

    // 4. Technology maturity recommendation
    if (result.technologyMaturity) {
      const { trl, sCurveStage } = result.technologyMaturity;
      if (trl.level >= 7) {
        recs.push(`${t('techMature', lang)}（TRL ${trl.level}，${sCurveStage}）`);
      } else if (trl.level >= 4) {
        recs.push(`${t('techDeveloping', lang)}（TRL ${trl.level}）。${t('acceleratePrototyping', lang) || 'Accelerate prototyping and validation'}`);
      } else {
        recs.push(`${t('techEarly', lang)}（TRL ${trl.level}）。${t('investResearch', lang) || 'Invest in fundamental research'}`);
      }
    }

    // 5. Citation list
    if (topCited.length > 0) {
      recs.push('');
      recs.push(`**${t('references', lang)}**`);
      for (let i = 0; i < topCited.length; i++) {
        const item = topCited[i];
        const authors = item.authors?.slice(0, 2).join(', ') || '';
        recs.push(`${i + 1}. ${authors ? `${authors}, ` : ''}"${item.title}." ${item.publishedDate || ''}. [${item.url}](${item.url})`);
      }
    }

    return recs;
  }

  private detectDomain(problem: string, preferences?: string): string {
    const text = `${problem} ${preferences || ''}`.toLowerCase();
    if (/\b(ai|machine learning|neural|deep learning|nlp|computer vision|llm|transformer|reinforcement)\b/.test(text)) return 'ai';
    if (/\b(material|alloy|polymer|ceramic|composite|nanomaterial|coating)\b/.test(text)) return 'materials';
    if (/\b(mechanical|mechanism|gear|bearing|actuator|hydraulic|pneumatic|robotic)\b/.test(text)) return 'mechanical';
    if (/\b(software|algorithm|protocol|interface|api|framework|microservice|database)\b/.test(text)) return 'software';
    if (/\b(chemical|catalyst|reaction|synthesis|separation|distillation|electrochemical)\b/.test(text)) return 'chemical';
    if (/\b(energy|battery|solar|fuel cell|photovoltaic|thermoelectric|power)\b/.test(text)) return 'energy';
    if (/\b(bio|medical|pharma|drug|diagnostic|therapeutic|clinical|surgical)\b/.test(text)) return 'biomedical';
    if (/\b(manufactur|production|assembly|fabrication|supply chain|logistic)\b/.test(text)) return 'manufacturing';
    return 'general';
  }

  private determineSectionOrder(
    priorArt: { patents: PriorArtItem[]; papers: PriorArtItem[]; techSolutions: PriorArtItem[] },
    domain: string,
  ): ('patents' | 'papers' | 'techSolutions')[] {
    const counts: Record<string, number> = {
      patents: priorArt.patents.length,
      papers: priorArt.papers.length,
      techSolutions: priorArt.techSolutions.length,
    };

    const domainPrefs: Record<string, ('patents' | 'papers' | 'techSolutions')[]> = {
      ai: ['papers', 'patents', 'techSolutions'],
      biomedical: ['papers', 'patents', 'techSolutions'],
      materials: ['papers', 'patents', 'techSolutions'],
      chemical: ['patents', 'papers', 'techSolutions'],
      mechanical: ['patents', 'techSolutions', 'papers'],
      manufacturing: ['patents', 'techSolutions', 'papers'],
      energy: ['patents', 'papers', 'techSolutions'],
      software: ['techSolutions', 'papers', 'patents'],
    };

    const order = domainPrefs[domain] || ['patents', 'papers', 'techSolutions'];

    const populated = order.filter(s => counts[s] > 0);
    return populated.length > 0
      ? populated
      : (['patents', 'papers', 'techSolutions'] as const).filter(s => counts[s] > 0);
  }

  private analyzeSolutionPath(
    item: PriorArtItem,
    improvingParam: string,
    worseningParam: string,
    lang: string,
  ): string {
    const snippet = `${item.title} ${item.snippet}`.toLowerCase();
    const improves = improvingParam ? snippet.includes(improvingParam.toLowerCase().split(' ').slice(0, 2).join(' ')) : false;
    const worsens = worseningParam ? snippet.includes(worseningParam.toLowerCase().split(' ').slice(0, 2).join(' ')) : false;

    const improvingShort = improvingParam.replace(/ of (moving|stationary) (object|part)/i, '').trim();
    const worseningShort = worseningParam.replace(/ of (moving|stationary) (object|part)/i, '').trim();

    if (improves && worsens) {
      return lang === 'zh'
        ? `同时解决${improvingShort}和${worseningShort}的矛盾`
        : `Addresses both ${improvingShort} and ${worseningShort} trade-off`;
    }
    if (improves) {
      return lang === 'zh'
        ? `侧重${improvingShort}的改进`
        : `Focuses on improving ${improvingShort}`;
    }
    if (worsens) {
      return lang === 'zh'
        ? `涉及${worseningShort}的限制`
        : `Constrained by ${worseningShort}`;
    }
    // Extract key technical approach from snippet
    const words = item.snippet.split(/\s+/).filter(w => w.length > 5).slice(0, 5);
    return words.length > 0 ? words.join(' ').slice(0, 40) : (lang === 'zh' ? '相关技术方案' : 'Related approach');
  }

  private buildReport(request: UnifiedResearchRequest, result: {
    contradictionAnalysis?: {
      improvingParameter: unknown;
      worseningParameter: unknown;
      principles: Array<{ index: number; name: string; description: string }>;
    };
    priorArt: { patents: PriorArtItem[]; papers: PriorArtItem[]; techSolutions: PriorArtItem[] };
    technologyMaturity?: {
      trl: { level: number; title: string; confidence: number; isEstimated?: boolean };
      trlNext: { min: number; max: number; mostLikely: number };
      sCurveStage: string;
      sCurveStageNext: string;
      crossoverYear: number;
      sCurveData?: { isEstimated: boolean; dataPointCount: number };
      svgPath?: string;
      unicodeChart?: string;
      milestones?: Array<{ year: number; label: string; description: string; type: string }>;
    };
    preferences?: string;
  }): string {
    const lang = this.locale.language;
    const lines: string[] = [];

    lines.push(`# ${t('title', lang)}`);
    lines.push('');
    lines.push(`**${t('problem', lang)}:** ${request.problemDescription}`);
    lines.push(`**${t('date', lang)}:** ${new Date().toISOString().split('T')[0]}`);
    lines.push('');

    // Methodology section
    lines.push(`## ${t('methodologyTitle', lang)}`);
    lines.push('');
    const hasPriorArt = result.priorArt.patents.length > 0 || result.priorArt.papers.length > 0 || result.priorArt.techSolutions.length > 0;
    const hasSynthesis = !!result.contradictionAnalysis || !!result.technologyMaturity;
    lines.push(srv('methodologyText', lang, {
      patentCount: result.priorArt.patents.length,
      paperCount: result.priorArt.papers.length,
      techCount: result.priorArt.techSolutions.length,
      hasPriorArt: hasPriorArt ? '✓' : '✗',
      hasSynthesis: hasSynthesis ? '✓' : '✗',
      hasContradiction: result.contradictionAnalysis ? '✓' : '✗',
      hasMaturity: result.technologyMaturity ? '✓' : '✗',
    }));
    lines.push('');

    // Executive Summary
    lines.push(`## ${t('executiveSummary', lang)}`);
    lines.push('');
    const totalPriorArt = result.priorArt.patents.length + result.priorArt.papers.length + result.priorArt.techSolutions.length;
    if (result.contradictionAnalysis) {
      lines.push(srv('executiveSummaryContradiction', lang, {
        principles: result.contradictionAnalysis.principles.length,
        total: totalPriorArt,
        patents: result.priorArt.patents.length,
        papers: result.priorArt.papers.length,
        tech: result.priorArt.techSolutions.length,
      }));
    } else {
      lines.push(srv('executiveSummaryNoContradiction', lang, {
        total: totalPriorArt,
        patents: result.priorArt.patents.length,
        papers: result.priorArt.papers.length,
        tech: result.priorArt.techSolutions.length,
      }));
    }

    if (result.technologyMaturity) {
      const { trl, sCurveStage, crossoverYear } = result.technologyMaturity;
      const estBadge = trl.isEstimated ? ` (_${t('aiEstimate', lang)}_)` : '';
      lines.push(srv('maturitySummary', lang, {
        trl: trl.level,
        trlTitle: trlTitle(trl.level, lang),
        estBadge,
        stage: sCurveStage,
        year: crossoverYear,
      }));
    }
    lines.push('');

    // Contradiction Analysis
    if (result.contradictionAnalysis) {
      lines.push(`## 1. ${t('contradictionAnalysis', lang)}`);
      lines.push('');
      lines.push(`**${t('improvingParameter', lang)}:** ${result.contradictionAnalysis.improvingParameter}`);
      lines.push(`**${t('worseningParameter', lang)}:** ${result.contradictionAnalysis.worseningParameter}`);
      lines.push('');
      const topPrinciples = result.contradictionAnalysis.principles.slice(0, 3);
      lines.push(srv('principlesIntro', lang, { count: result.contradictionAnalysis.principles.length }));
      lines.push('');
      for (let i = 0; i < topPrinciples.length; i++) {
        const p = topPrinciples[i];
        const prefix = srv('principleItemPrefix', lang);
        lines.push(`${i + 1}. **${prefix} #${p.index}: ${p.name}** - ${p.description.slice(0, 120)}...`);
      }
      lines.push('');
    }

    // Prior Art Analysis with Solution Path Comparison
    lines.push(`## 2. ${t('priorArtAnalysis', lang)}`);
    lines.push('');

    const domain = this.detectDomain(request.problemDescription, result.preferences);
    const improvingName = result.contradictionAnalysis
      ? String(result.contradictionAnalysis.improvingParameter)
      : '';
    const worseningName = result.contradictionAnalysis
      ? String(result.contradictionAnalysis.worseningParameter)
      : '';

    // Determine section ordering by result abundance and domain
    const sectionOrder = this.determineSectionOrder(result.priorArt, domain);

    for (const key of sectionOrder) {
      const items = key === 'patents' ? result.priorArt.patents
        : key === 'papers' ? result.priorArt.papers
        : result.priorArt.techSolutions;
      if (items.length === 0) continue;

      const label = key === 'patents' ? t('patentLandscape', lang)
        : key === 'papers' ? t('academicResearch', lang)
        : t('techSolutions', lang);
      const insightFn = key === 'patents' ? this.getPatentInsight.bind(this)
        : key === 'papers' ? this.getResearchInsight.bind(this)
        : this.getTechSolutionInsight.bind(this);

      lines.push(`### ${label}（${items.length} ${t('found', lang) || 'found'}）`);
      lines.push('');

      // Dynamic detail: show full table if ≤8 items, compact if more
      if (items.length <= 8) {
        // Detailed table with solution path analysis
        lines.push(`| # | ${t('title', lang)} | ${t('date', lang)} | ${t('solutionPath', lang) || 'Solution Path'} |`);
        lines.push(`|---|-------|------|---------|`);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const solutionPath = this.analyzeSolutionPath(item, improvingName, worseningName, lang);
          lines.push(`| ${i + 1} | [${item.title.slice(0, 45)}${item.title.length > 45 ? '...' : ''}](${item.url}) | ${item.publishedDate || 'N/A'} | ${solutionPath} |`);
        }
      } else {
        // Compact: just list with URLs
        lines.push(`| # | ${t('title', lang)} | ${t('date', lang)} |`);
        lines.push(`|---|-------|------|`);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          lines.push(`| ${i + 1} | [${item.title.slice(0, 50)}${item.title.length > 50 ? '...' : ''}](${item.url}) | ${item.publishedDate || 'N/A'} |`);
        }
      }
      lines.push('');
      lines.push(`**${t('keyInsight', lang)}:** ${insightFn(items)}`);
      lines.push('');
    }

    // Technology Maturity
    if (result.technologyMaturity) {
      const { trl, trlNext, sCurveStage, sCurveStageNext, crossoverYear, sCurveData, svgPath, unicodeChart, milestones } = result.technologyMaturity;
      lines.push(`## 3. ${t('technologyMaturity', lang)}`);
      lines.push('');

      const estBadge = trl.isEstimated ? ` (_${t('aiEstimate', lang)}_)` : '';
      const dataBadge = sCurveData?.isEstimated ? ` (_${t('aiEstimatedData', lang)}_)` : '';

      lines.push(`### ${t('summary', lang)}`);
      lines.push('');
      lines.push(srv('maturityDetailIntro', lang, {
        trl: trl.level,
        trlTitle: trlTitle(trl.level, lang),
        estBadge,
        stage: sCurveStage,
        dataBadge,
        maturitySummary: this.getMaturitySummary(sCurveStage, trl.level),
        trlNextMostLikely: trlNext.mostLikely,
        crossoverYear,
      }));
      lines.push('');

      lines.push(`### ${t('currentTechnology', lang)}`);
      lines.push('');
      lines.push(`| ${t('metric', lang)} | ${t('value', lang)} |`);
      lines.push(`|--------|-------|`);
      lines.push(`| **${t('sCurveStage', lang)}** | ${sCurveStage} |`);
      lines.push(`| **TRL** | ${trl.level}/9 - ${trlTitle(trl.level, lang)} |`);
      lines.push(`| **${t('confidence', lang)}** | ${Math.round(trl.confidence * 100)}% |`);
      if (sCurveData?.dataPointCount) {
        lines.push(`| **${t('dataPoints', lang)}** | ${sCurveData.dataPointCount}${sCurveData.isEstimated ? ` (${t('estimated', lang)})` : ` (${t('real', lang)})` } |`);
      }
      lines.push('');

      lines.push(`**${t('strategy', lang)}:** ${stageStrategy(sCurveStage, lang)}`);
      lines.push('');

      lines.push(`### ${t('nextGenTechnology', lang)}`);
      lines.push('');
      lines.push(`| ${t('metric', lang)} | ${t('value', lang)} |`);
      lines.push(`|--------|-------|`);
      lines.push(`| **${t('sCurveStage', lang)}** | ${sCurveStageNext} |`);
      lines.push(`| **TRL ${t('value', lang) || 'Range'}** | ${trlNext.min}-${trlNext.max}/9 (${t('mostLikely', lang)}: ${trlNext.mostLikely}) |`);
      lines.push(`| **${t('sCurveCrossover', lang)}** | ~${crossoverYear} |`);
      lines.push('');

      const yearsToCrossover = crossoverYear - new Date().getFullYear();
      if (yearsToCrossover > 0) {
        lines.push(`**${t('strategicWarning', lang)}:** ${t('willSurpass', lang)} **${yearsToCrossover} ${t('years', lang)}**。` +
          `${t('beginInvesting', lang)}`);
      } else {
        lines.push(`**${t('criticalAlert', lang)}:** ${t('hasSurpassed', lang)}` +
          `${t('immediateTransition', lang)}`);
      }
      lines.push('');

      // S-Curve Visualization
      if (result.technologyMaturity.svgPath) {
        lines.push(`### ${t('scurveVisualization', lang)}`);
        lines.push('');
        lines.push(`**${t('svgChart', lang)}:** \`${result.technologyMaturity.svgPath}\``);
        lines.push('');
        if (result.technologyMaturity.unicodeChart) {
          lines.push(`**${t('asciiPreview', lang)}:**`);
          lines.push('```');
          lines.push(result.technologyMaturity.unicodeChart);
          lines.push('```');
          lines.push('');
        }
      }

      // Key Events / Milestones
      if (result.technologyMaturity.milestones && result.technologyMaturity.milestones.length > 0) {
        lines.push(`### ${t('keyEventsMilestones', lang)}`);
        lines.push('');
        lines.push(`| ${t('year', lang)} | ${t('event', lang)} | ${t('type', lang)} |`);
        lines.push(`|------|-------|------|`);
        for (const m of result.technologyMaturity.milestones) {
          lines.push(`| ${m.year} | ${m.label} - ${m.description.slice(0, 60)}${m.description.length > 60 ? '...' : ''} | ${m.type} |`);
        }
        lines.push('');
      }
    }

    // Recommendations
    lines.push(`## 4. ${t('recommendations', lang)}`);
    lines.push('');

    if (result.contradictionAnalysis && result.contradictionAnalysis.principles.length > 0) {
      const topPrinciples = result.contradictionAnalysis.principles.slice(0, 3);
      lines.push(`### ${t('immediateActions', lang)}`);
      lines.push('');
      for (let i = 0; i < topPrinciples.length; i++) {
        const p = topPrinciples[i];
        lines.push(`${i + 1}. **${t('applyPrinciple', lang)} #${p.index} (${p.name})**: ${p.description.slice(0, 100)}...`);
      }
      lines.push('');
    }

    lines.push(`### ${t('researchPriorities', lang)}`);
    lines.push('');
    lines.push(`1. **${t('patentLandscape', lang)}**: ${t('reviewPatents', lang)} ${result.priorArt.patents.length} ${t('identifiedPatents', lang)}`);
    lines.push(`2. **${t('academicResearch', lang)}**: ${t('studyPapers', lang)} ${result.priorArt.papers.length} ${t('academicPapers', lang)}`);
    lines.push(`3. **${t('techRoadmap', lang) || '技术路线图'}**: ${t('techRoadmap', lang)}`);
    lines.push('');

    return lines.join('\n');
  }

  private addError(component: string, message: string, severity: 'warning' | 'error'): void {
    this.errors.push({
      component,
      message,
      severity,
      timestamp: Date.now(),
    });
  }

  private getContradictionInsight(principles: Array<{ name: string }>): string {
    const lang = this.locale.language;
    if (principles.length === 0) return srv('contradictionInsightDefault', lang);
    const names = principles.slice(0, 2).map(p => p.name.toLowerCase());
    if (names.some(n => n.includes('segment'))) return srv('contradictionInsightSegment', lang);
    if (names.some(n => n.includes('dynam'))) return srv('contradictionInsightDynamic', lang);
    if (names.some(n => n.includes('composite'))) return srv('contradictionInsightComposite', lang);
    return srv('contradictionInsightDefault', lang);
  }

  private extractTopAuthors(results: SearchResult[]): string {
    const lang = this.locale.language;
    const authors = results
      .flatMap(r => r.authors || [])
      .filter(Boolean)
      .slice(0, 3);
    return authors.length > 0 ? authors.join(', ') : srv('multipleTeams', lang);
  }

  private extractDateRange(results: SearchResult[]): string {
    const lang = this.locale.language;
    const dates = results
      .map(r => r.publishedDate)
      .filter(Boolean)
      .sort();
    if (dates.length === 0) return srv('noDates', lang);
    if (dates.length === 1) return dates[0];
    return srv('dateRange', lang, { start: dates[0], end: dates[dates.length - 1] });
  }

  private getPatentTrend(results: SearchResult[]): string {
    const lang = this.locale.language;
    const dates = results.map(r => r.publishedDate).filter(Boolean);
    if (dates.length === 0) return srv('patentTrendActive', lang);
    const recent = dates.filter(d => {
      const year = parseInt(d.slice(0, 4));
      return year > 2020;
    }).length;
    if (recent > dates.length / 2) return srv('patentTrendGrowing', lang);
    return srv('patentTrendMature', lang);
  }

  private getPatentInsight(results: SearchResult[]): string {
    const lang = this.locale.language;
    if (results.length === 0) return srv('patentInsightText', lang);
    const topAuthors = this.extractTopAuthors(results);
    const yearRange = this.extractDateRange(results);
    const trend = this.getPatentTrend(results);
    const uniqueAssignees = new Set(results.flatMap(r => r.authors || []).filter(Boolean)).size;
    return srv('patentInsightDynamic', lang, {
      count: results.length,
      authors: topAuthors,
      yearRange,
      trend,
      assigneeCount: uniqueAssignees,
    });
  }

  private getResearchTrend(results: SearchResult[]): string {
    const lang = this.locale.language;
    const dates = results.map(r => r.publishedDate).filter(Boolean);
    if (dates.length === 0) return t('report.researchTrend', lang);
    const recent = dates.filter(d => {
      const year = parseInt(d.slice(0, 4));
      return year > 2022;
    }).length;
    if (recent > dates.length / 2) return lang === 'zh' ? '近期研究活跃，新兴成果不断涌现' : 'recent research activity is high with emerging findings';
    if (recent > 0) return lang === 'zh' ? '研究活动持续，部分近期成果值得关注' : 'ongoing research activity with some recent findings';
    return lang === 'zh' ? '研究主要基于较早的成果，需关注最新进展' : 'research is primarily based on earlier work; check for recent updates';
  }

  private getResearchInsight(results: SearchResult[]): string {
    const lang = this.locale.language;
    if (results.length === 0) return t('report.researchInsight', lang);
    const topAuthors = this.extractTopAuthors(results);
    const yearRange = this.extractDateRange(results);
    const trend = this.getResearchTrend(results);
    const institutions = results.flatMap(r => r.authors || []).filter(Boolean);
    const uniqueInstitutions = new Set(institutions).size;
    return srv('researchInsightDynamic', lang, {
      count: results.length,
      authors: topAuthors,
      yearRange,
      trend,
      institutionCount: uniqueInstitutions,
    });
  }

  private getTechSolutionTrend(results: SearchResult[]): string {
    const lang = this.locale.language;
    const dates = results.map(r => r.publishedDate).filter(Boolean);
    if (dates.length === 0) return t('report.techSolutionTrend', lang);
    const recent = dates.filter(d => {
      const year = parseInt(d.slice(0, 4));
      return year > 2021;
    }).length;
    if (recent > dates.length / 2) return lang === 'zh' ? '近期技术方案快速迭代，实用化程度高' : 'recent solutions show rapid iteration and high practicality';
    return lang === 'zh' ? '技术方案持续累积，部分经典方案仍为参考基准' : 'solutions continue to accumulate; classic references remain relevant';
  }

  private getTechSolutionInsight(results: SearchResult[]): string {
    const lang = this.locale.language;
    if (results.length === 0) return t('report.techSolutionInsight', lang);
    const yearRange = this.extractDateRange(results);
    const trend = this.getTechSolutionTrend(results);
    const uniqueSources = new Set(results.map(r => r.url).filter(Boolean)).size;
    return srv('techSolutionInsightDynamic', lang, {
      count: results.length,
      yearRange,
      trend,
      sourceCount: uniqueSources,
    });
  }

  private getMaturitySummary(stage: string, trl: number): string {
    const lang = this.locale.language;
    if (trl >= 8) return t('maturityHigh', lang);
    if (trl >= 6) return t('maturityMid', lang);
    if (trl >= 4) return t('maturityLow', lang);
    return t('maturityEarly', lang);
  }

  private saveSvgToFile(svg: string, technologyName: string): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const outputDir = join(__dirname, '..', '..', '..', 'output');

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rawName = technologyName || 'unknown_tech';
    const sanitizedName = rawName.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g, '_').slice(0, 30).replace(/^_+|_+$/g, '');
    const namePart = sanitizedName || 's_curve';
    const filename = `scurve_${namePart}_${timestamp}.svg`;
    const filePath = join(outputDir, filename);

    writeFileSync(filePath, svg, 'utf-8');
    return filePath;
  }

  private getStageStrategy(stage: string): string {
    return stageStrategy(stage, this.locale.language);
  }
}

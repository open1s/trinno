import { defineTool, ok, err } from '@open1s/ezbos';
import { ContradictionMatrix } from '../../domain/contradiction/matrix.js';
import { PrincipleEngine } from '../../domain/principle/services.js';
import { SuFieldAnalysisService } from '../../domain/solution/su_field_service.js';
import { EvaluateIdealityHandler } from '../../application/evaluate_ideality/handler.js';
import { AnalyzeContradictionHandler } from '../../application/analyze_contradiction/handler.js';
import { AiTrizAgent } from '../ai/triz_ai_agent.js';
import { CachedSearchService } from '../search/cached_search.js';
import { AISummarizer } from '../search/ai_summarizer.js';

import { AnalyzeSCurveHandler } from '../../application/analyze_s_curve/handler.js';
import { AiSCurveEstimator } from '../s_curve/ai_estimator.js';
import { AiSCurveDataExtractor } from '../s_curve/ai_data_extractor.js';

import { getParameterByIndex } from '../../domain/principle/parameters.js';
import type { ExtractedDataPoint } from '../s_curve/ai_data_extractor.js';

const sCurveDataCache = new Map<string, ExtractedDataPoint[]>();

export function createTrizTools(
  principleEngine: PrincipleEngine,
  suFieldService: SuFieldAnalysisService,
  analyzeContradictionHandler: AnalyzeContradictionHandler,
  idealityHandler: EvaluateIdealityHandler,
  aiAgent?: AiTrizAgent,
  cachedSearch?: CachedSearchService,
  summarizer?: AISummarizer,
  sCurveHandler?: AnalyzeSCurveHandler,
  aiSCurveEstimator?: AiSCurveEstimator,
  aiSCurveDataExtractor?: AiSCurveDataExtractor,
) {
  const matrix = ContradictionMatrix.getInstance();

  const analyzeContradiction = defineTool(
    'triz_analyze_contradiction',
    'Analyze a technical contradiction using TRIZ Contradiction Matrix & persist for follow-up. Returns recommended inventive principles with parameter names resolved.',
  )
    .required('improvingParameter', 'number', 'TRIZ parameter index (1-39) that you want to improve')
    .required('worseningParameter', 'number', 'TRIZ parameter index (1-39) that gets worse')
    .param('description', 'string', 'Description of the contradiction context')
    .param('type', 'string', 'Contradiction type: "technical" or "physical" (default: technical)')
    .param('context', 'string', 'Additional context for deeper analysis')
    .handle(async (args) => {
      try {
        const improvingName = getParameterByIndex(args.improvingParameter)?.name ?? `#${args.improvingParameter}`;
        const worseningName = getParameterByIndex(args.worseningParameter)?.name ?? `#${args.worseningParameter}`;
        const result = await analyzeContradictionHandler.execute({
          improvingParameter: args.improvingParameter,
          worseningParameter: args.worseningParameter,
          description: args.description || '',
          type: (args.type as 'technical' | 'physical') || 'technical',
          context: args.context,
        });
        return ok({
          contradictionId: result.contradictionId,
          improvingParameter: { index: args.improvingParameter, name: improvingName },
          worseningParameter: { index: args.worseningParameter, name: worseningName },
          recommendedPrinciples: result.recommendedPrinciples,
        });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const lookupMatrix = defineTool(
    'triz_lookup_matrix',
    'Look up the TRIZ Contradiction Matrix for a parameter pair. Returns resolved parameter names and recommended inventive principles.',
  )
    .required('improvingParameter', 'number', 'Improving parameter index (1-39)')
    .required('worseningParameter', 'number', 'Worsening parameter index (1-39)')
    .handle((args) => {
      try {
        const principles = matrix.lookup(args.improvingParameter, args.worseningParameter);
        const improvingName = getParameterByIndex(args.improvingParameter)?.name ?? `#${args.improvingParameter}`;
        const worseningName = getParameterByIndex(args.worseningParameter)?.name ?? `#${args.worseningParameter}`;
        const detailed = principles
          .map(idx => principleEngine.getPrinciple(idx))
          .filter((p): p is NonNullable<typeof p> => p !== undefined)
          .map(p => ({ index: p.index, name: p.name, nameZh: p.nameZh, description: p.description }));
        return ok({
          improvingParameter: { index: args.improvingParameter, name: improvingName },
          worseningParameter: { index: args.worseningParameter, name: worseningName },
          principles: detailed,
          principleCount: detailed.length,
        });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const getPrinciple = defineTool(
    'triz_get_principle',
    'Get details of a specific TRIZ Inventive Principle (bilingual, with examples).',
  )
    .required('index', 'number', 'Principle index (1-40)')
    .param('includeExamples', 'boolean', 'Include usage examples (default: true)')
    .handle((args) => {
      const principle = principleEngine.getPrinciple(args.index);
      if (!principle) return err(`Principle ${args.index} not found (valid range: 1-40)`);
      if (args.includeExamples === false) {
        const { examples, ...rest } = principle;
        return ok(rest);
      }
      return ok(principle);
    });

  const searchPrinciples = defineTool(
    'triz_search_principles',
    'Search TRIZ Inventive Principles by keyword, ranked by relevance. Matches name (highest), description, then examples.',
  )
    .required('query', 'string', 'Search keyword')
    .handle((args) => {
      const q = args.query.toLowerCase();
      const scored = principleEngine.getAllPrinciples()
        .map(p => {
          let relevance = 0;
          if (p.name.toLowerCase().includes(q)) relevance += 3;
          if (p.description.toLowerCase().includes(q)) relevance += 2;
          if (p.examples.some(e => e.toLowerCase().includes(q))) relevance += 1;
          return { ...p, relevance };
        })
        .filter(p => p.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance);
      return ok({ count: scored.length, results: scored });
    });

  const listPrinciples = defineTool(
    'triz_list_principles',
    'List all 40 TRIZ Inventive Principles with bilingual names and descriptions.',
  ).handle(() => {
    const principles = principleEngine.getAllPrinciples();
    return ok({ count: principles.length, principles });
  });

  const listParameters = defineTool(
    'triz_list_parameters',
    'List all 39 TRIZ engineering parameters with names and descriptions.',
  ).handle(() => {
    const parameters = matrix.getAllParameters();
    return ok({ count: parameters.length, parameters });
  });

  const analyzeSuField = defineTool(
    'triz_analyze_su_field',
    'Analyze a Substance-Field (Su-Field) model and suggest improvements aligned with the 76 Standard Solutions.',
  )
    .required('substance1', 'string', 'First substance (S1) — the active component (tool)')
    .required('substance2', 'string', 'Second substance (S2) — the passive component (object)')
    .required('field', 'string', 'Field type: mechanical, thermal, chemical, electrical, magnetic, optical, acoustic, biological, or custom')
    .param('problemType', 'string', 'Problem type: harmful, insufficient, excessive, or complete (default: complete)')
    .handle((args) => {
      const components = { substance1: args.substance1, substance2: args.substance2, field: args.field };
      let result;
      switch (args.problemType) {
        case 'harmful':
          result = suFieldService.analyzeHarmful(args.substance1, args.substance2, args.field);
          break;
        case 'insufficient':
          result = suFieldService.analyzeInsufficient(args.substance1, args.substance2, args.field);
          break;
        case 'excessive':
          result = {
            type: 'excessive' as const,
            diagnosis: `Excessive Su-Field: ${args.substance1} applies excessive ${args.field} on ${args.substance2}.`,
            standardSolutions: [
              '1.2.1 — Introduce S3 between S1 and S2 to absorb excess field',
              '1.2.2 — Modify S2 to be less sensitive to the field',
              '1.2.3 — Replace the field with a less intense type',
              '2.2.1 — Introduce a bucking field to cancel the excess',
            ],
            recommendedAction: 'Apply Standard Solutions 1.2.x to eliminate excessive interaction, or 2.2.x for field cancellation.',
          };
          break;
        default:
          result = suFieldService.analyze(components);
      }
      return ok(result);
    });

  const evaluateIdeality = defineTool(
    'triz_evaluate_ideality',
    'Evaluate system ideality = Benefits / (Costs + Harms). Optionally customize per-item weights.',
  )
    .required('problemId', 'string', 'Problem identifier')
    .param('benefits', 'array', 'List of benefit descriptions')
    .param('costs', 'array', 'List of cost/resource descriptions')
    .param('harms', 'array', 'List of harmful effect descriptions')
    .param('benefitWeight', 'number', 'Score per benefit item (default: 10)')
    .param('costWeight', 'number', 'Score per cost item (default: 5)')
    .param('harmWeight', 'number', 'Score per harm item (default: 8)')
    .handle(async (args) => {
      try {
        const result = await idealityHandler.execute({
          problemId: args.problemId,
          benefits: args.benefits || [],
          costs: args.costs || [],
          harms: args.harms || [],
          benefitWeight: args.benefitWeight,
          costWeight: args.costWeight,
          harmWeight: args.harmWeight,
        });
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    });

  const aiAnalyzeContradiction = defineTool(
    'triz_ai_analyze',
    'Use AI to analyze a contradiction and provide creative insights.',
  )
    .required('improvingParam', 'string', 'Description of improving parameter')
    .required('worseningParam', 'string', 'Description of worsening parameter')
    .required('description', 'string', 'Problem description')
    .handle(async (args) => {
      if (!aiAgent) return err('AI agent not configured');
      try {
        const result = await aiAgent.analyzeContradiction(
          args.improvingParam,
          args.worseningParam,
          args.description,
        );
        return ok({ analysis: result });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const aiGenerateInsight = defineTool(
    'triz_ai_insight',
    'Use AI to generate insights for applying a specific TRIZ principle to a problem.',
  )
    .required('problemDescription', 'string', 'Description of the problem')
    .required('principleIndex', 'number', 'TRIZ principle index (1-40)')
    .param('context', 'string', 'Additional context')
    .handle(async (args) => {
      if (!aiAgent) return err('AI agent not configured');
      const principle = principleEngine.getPrinciple(args.principleIndex);
      if (!principle) return err(`Principle ${args.principleIndex} not found`);
      try {
        const result = await aiAgent.generateInsight(
          args.problemDescription,
          principle,
          args.context,
        );
        return ok({ insight: result });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const triggerSearchPatents = defineTool(
    'triz_trigger_search_patents',
    'Search patents via real API. Returns cached results immediately if available; otherwise fetches from API and caches.',
  )
    .required('query', 'string', 'Patent search query')
    .param('maxResults', 'number', 'Maximum results (default: 5)')
    .param('forceRefresh', 'boolean', 'Bypass cache and re-fetch from API (default: false)')
    .handle(async (args) => {
      if (!cachedSearch) return err('Search service not configured');
      const max = args.maxResults || 5;

      const cached = cachedSearch.getCachedPatents(args.query, max);
      if (cached.length > 0 && !args.forceRefresh) {
        return ok({ count: cached.length, results: cached, source: 'cache' });
      }

      try {
        const results = await cachedSearch.searchPatents(args.query, max);
        return ok({ count: results.length, results, source: 'api' });
      } catch (e: unknown) {
        return err(`Patent search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  const triggerSearchPapers = defineTool(
    'triz_trigger_search_papers',
    'Search academic papers via real API. Returns cached results immediately if available; otherwise fetches from API and caches.',
  )
    .required('query', 'string', 'Paper search query')
    .param('maxResults', 'number', 'Maximum results (default: 5)')
    .param('forceRefresh', 'boolean', 'Bypass cache and re-fetch from API (default: false)')
    .handle(async (args) => {
      if (!cachedSearch) return err('Search service not configured');
      const max = args.maxResults || 5;

      const cached = cachedSearch.getCachedPapers(args.query, max);
      if (cached.length > 0 && !args.forceRefresh) {
        return ok({ count: cached.length, results: cached, source: 'cache' });
      }

      try {
        const results = await cachedSearch.searchPapers(args.query, max);
        return ok({ count: results.length, results, source: 'api' });
      } catch (e: unknown) {
        return err(`Paper search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  const triggerSearchPriorArt = defineTool(
    'triz_trigger_search_prior_art',
    'Search patents + papers + tech solutions via real APIs in parallel. Results are cached.',
  )
    .required('query', 'string', 'Search query')
    .param('maxResults', 'number', 'Maximum results per source (default: 5)')
    .handle(async (args) => {
      if (!cachedSearch) return err('Search service not configured');
      const max = args.maxResults || 5;

      try {
        const [patents, papers, tech] = await Promise.all([
          cachedSearch.searchPatents(args.query, max),
          cachedSearch.searchPapers(args.query, max),
          cachedSearch.searchTechSolutions(args.query, max),
        ]);
        const allResults = [...patents, ...papers, ...tech];
        return ok({
          count: allResults.length,
          patents: { count: patents.length, results: patents },
          papers: { count: papers.length, results: papers },
          techSolutions: { count: tech.length, results: tech },
          total: allResults.length,
        });
      } catch (e: unknown) {
        return err(`Prior art search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  const getCachedPatents = defineTool(
    'triz_get_cached_patents',
    'Get previously cached patent search results. Use triz_trigger_search_patents first.',
  )
    .required('query', 'string', 'Original search query')
    .param('maxResults', 'number', 'Maximum results (default: 5)')
    .handle((args) => {
      if (!cachedSearch) return err('Search service not configured');
      const max = args.maxResults || 5;
      const results = cachedSearch.getCachedPatents(args.query, max);
      return ok({ count: results.length, results, empty: results.length === 0 });
    });

  const getCachedPapers = defineTool(
    'triz_get_cached_papers',
    'Get previously cached paper search results. Use triz_trigger_search_papers first.',
  )
    .required('query', 'string', 'Original search query')
    .param('maxResults', 'number', 'Maximum results (default: 5)')
    .handle((args) => {
      if (!cachedSearch) return err('Search service not configured');
      const max = args.maxResults || 5;
      const results = cachedSearch.getCachedPapers(args.query, max);
      return ok({ count: results.length, results, empty: results.length === 0 });
    });

  const getCachedPriorArt = defineTool(
    'triz_get_cached_prior_art',
    'Get all previously cached prior art (patents + papers + tech). Use triz_trigger_search_prior_art first.',
  )
    .required('query', 'string', 'Original search query')
    .param('maxResults', 'number', 'Maximum results per source (default: 5)')
    .handle((args) => {
      if (!cachedSearch) return err('Search service not configured');
      const max = args.maxResults || 5;
      const results = cachedSearch.getCachedPriorArt(args.query, max);
      return ok({ count: results.length, results, empty: results.length === 0 });
    });

  const listCachedSearches = defineTool(
    'triz_list_cached_searches',
    'List all cached search results with age info.',
  ).handle(() => {
    if (!cachedSearch) return err('Search service not configured');
    const cached = cachedSearch.getCache().getAll();
    return ok({
      count: cached.length,
      searches: cached.map(c => ({
        query: c.query,
        resultCount: c.results.length,
        ageMs: Date.now() - c.timestamp,
      })),
    });
  });

  const analyzeSCurve = defineTool(
    'triz_analyze_s_curve',
    'Analyze the S-curve of a technology. Returns current (S1) and next-gen (S2) curves with stage detection, TRL assessment, strategic recommendations, and an SVG chart.',
  )
    .required('technologyName', 'string', 'Name of the technology (e.g., "lithium-ion batteries")')
    .required('performanceMetric', 'string', 'Performance metric (e.g., "Wh/kg", "MPG", "TFLOPS")')
    .param('dataPoints', 'array', 'Optional data points as [{x: year, y: performance}]')
    .param('currentYear', 'number', 'Current year for analysis (default: this year)')
    .param('trl', 'number', 'Optional user-provided TRL (1-9) to override AI assessment')
    .param('trlReasoning', 'string', 'Reasoning for user-provided TRL override')
    .handle(async (args) => {
      if (!sCurveHandler) return err('S-Curve analysis not configured');
      try {
        const result = await sCurveHandler.execute({
          technologyName: args.technologyName,
          performanceMetric: args.performanceMetric,
          dataPoints: args.dataPoints || [],
          currentYear: args.currentYear,
          trl: args.trl,
          trlReasoning: args.trlReasoning,
        });
        return ok({
          technologyName: result.technologyName,
          performanceMetric: result.performanceMetric,
          s1Stage: result.s1Stage,
          s2Stage: result.s2Stage,
          s1Estimated: result.s1Estimated,
          s2Estimated: result.s2Estimated,
          unicodeChart: result.unicodeChart,
          analysis: result.analysis,
          recommendations: result.recommendations,
          crossoverYear: result.crossoverYear,
          s1MaxPerformance: result.s1MaxPerformance,
          s2MaxPerformance: result.s2MaxPerformance,
          milestones: result.milestones,
          s1TRL: result.s1TRL,
          s2TRLRange: result.s2TRLRange,
          trlReconciliation: result.trlReconciliation,
          svg: result.svg,
        });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const extractSCurveData = defineTool(
    'triz_extract_s_curve_data',
    'Use AI to search & extract historical performance data for a technology. Returns data points for S-curve analysis. Cached after first extraction.',
  )
    .required('technologyName', 'string', 'Name of the technology')
    .required('performanceMetric', 'string', 'Performance metric to track')
    .handle(async (args) => {
      if (!aiSCurveDataExtractor) return err('AI S-Curve data extractor not configured');
      try {
        const key = `${args.technologyName}:${args.performanceMetric}`;
        const cached = sCurveDataCache.get(key);
        if (cached) {
          return ok({
            technology: args.technologyName,
            metric: args.performanceMetric,
            dataPoints: cached,
            dataPointCount: cached.length,
            source: 'cache',
          });
        }

        const result = await aiSCurveDataExtractor.extractData(args.technologyName, args.performanceMetric);
        if (result.dataPoints.length > 0) {
          sCurveDataCache.set(key, result.dataPoints);
        }
        return ok({
          technology: args.technologyName,
          metric: args.performanceMetric,
          dataPoints: result.dataPoints,
          milestones: result.milestones,
          sources: result.sources,
          reasoning: result.reasoning,
          dataPointCount: result.dataPoints.length,
          source: 'ai',
        });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const enrichSCurve = defineTool(
    'triz_enrich_s_curve',
    'Use AI to estimate S-curve parameters for a technology when no historical data points are available. Returns logistic curve params, stage estimate, and S2 offset.',
  )
    .required('technologyName', 'string', 'Name of the technology')
    .required('performanceMetric', 'string', 'Performance metric')
    .handle(async (args) => {
      if (!aiSCurveEstimator) return err('AI S-Curve estimator not configured');
      try {
        const result = await aiSCurveEstimator.estimate(args.technologyName, args.performanceMetric);
        return ok({
          technology: args.technologyName,
          estimatedParameters: result.estimatedParameters,
          estimatedStage: result.estimatedStage,
          s2Offset: result.s2Offset,
          reasoning: result.reasoning,
        });
      } catch (e: any) {
        return err(e.message);
      }
    });

  return [
    analyzeContradiction,
    lookupMatrix,
    getPrinciple,
    searchPrinciples,
    listPrinciples,
    listParameters,
    analyzeSuField,
    evaluateIdeality,
    aiAnalyzeContradiction,
    aiGenerateInsight,
    triggerSearchPatents,
    triggerSearchPapers,
    triggerSearchPriorArt,
    getCachedPatents,
    getCachedPapers,
    getCachedPriorArt,
    listCachedSearches,
    extractSCurveData,
    analyzeSCurve,
    enrichSCurve,
  ];
}

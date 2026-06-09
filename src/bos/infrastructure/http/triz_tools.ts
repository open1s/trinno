import { defineTool, ok, err } from '@open1s/ezbos';
import { ContradictionMatrix } from '../../domain/contradiction/matrix.js';
import { PrincipleEngine } from '../../domain/principle/services.js';
import { SuFieldAnalysisService } from '../../domain/solution/su_field_service.js';
import { EvaluateIdealityHandler } from '../../application/evaluate_ideality/handler.js';
import { AnalyzeContradictionHandler } from '../../application/analyze_contradiction/handler.js';
import { AiTrizAgent } from '../ai/triz_ai_agent.js';
import { CachedSearchService } from '../search/cached_search.js';

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
  sCurveHandler?: AnalyzeSCurveHandler,
  aiSCurveEstimator?: AiSCurveEstimator,
  aiSCurveDataExtractor?: AiSCurveDataExtractor,
) {
  const matrix = ContradictionMatrix.getInstance();

  const principles = defineTool(
    'triz_principles',
    'Access TRIZ inventive principles (40). action="get" (by index), "search" (by keyword), "list" (all 40).',
  )
    .required('action', 'string', 'One of: "get", "search", "list"')
    .param('index', 'number', '1-40 (required for action="get")')
    .param('query', 'string', 'Search keyword, supports Chinese + multi-token (required for action="search")')
    .param('limit', 'number', 'Max results for search (default 10)')
    .param('minScore', 'number', 'Min relevance score for search (default 0)')
    .param('includeExamples', 'boolean', 'Include usage examples for get (default true)')
    .handle((args) => {
      if (args.action === 'list') {
        const all = principleEngine.getAllPrinciples();
        return ok({ count: all.length, principles: all });
      }
      if (args.action === 'get') {
        if (typeof args.index !== 'number') return err('action="get" requires index (1-40)');
        const principle = principleEngine.getPrinciple(args.index);
        if (!principle) return err(`Principle ${args.index} not found (valid range: 1-40)`);
        if (args.includeExamples === false) {
          const { examples, ...rest } = principle;
          return ok(rest);
        }
        return ok(principle);
      }
      if (args.action === 'search') {
        if (!args.query) return err('action="search" requires query');
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(40, Math.floor(args.limit)) : 10;
        const minScore = typeof args.minScore === 'number' ? args.minScore : 0;
        const scored = principleEngine.searchPrinciplesScored(args.query, { limit, minScore });
        return ok({ count: scored.length, query: args.query, results: scored });
      }
      return err(`Unknown action: ${args.action}. Use "get", "search", or "list".`);
    });

  const parameters = defineTool(
    'triz_parameters',
    'List all 39 TRIZ engineering parameters with names and descriptions.',
  ).handle(() => {
    const all = matrix.getAllParameters();
    return ok({ count: all.length, parameters: all });
  });

  const contradiction = defineTool(
    'triz_contradiction',
    'Resolve a technical contradiction. action="analyze" persists & returns principles, "lookup" is read-only matrix lookup, "ai" is AI creative analysis.',
  )
    .required('action', 'string', 'One of: "analyze", "lookup", "ai"')
    .required('improvingParameter', 'number', 'TRIZ parameter index (1-39) to improve')
    .required('worseningParameter', 'number', 'TRIZ parameter index (1-39) that gets worse')
    .param('description', 'string', 'Problem context (recommended for "analyze" and "ai")')
    .param('type', 'string', '"technical" or "physical" (default: technical)')
    .param('context', 'string', 'Additional context for deeper analysis')
    .handle(async (args) => {
      const improvingName = getParameterByIndex(args.improvingParameter)?.name ?? `#${args.improvingParameter}`;
      const worseningName = getParameterByIndex(args.worseningParameter)?.name ?? `#${args.worseningParameter}`;
      try {
        if (args.action === 'lookup') {
          const principles = matrix.lookup(args.improvingParameter, args.worseningParameter);
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
        }
        if (args.action === 'analyze') {
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
        }
        if (args.action === 'ai') {
          if (!aiAgent) return err('AI agent not configured');
          if (!args.description) return err('action="ai" requires description');
          const result = await aiAgent.analyzeContradiction(
            improvingName,
            worseningName,
            args.description,
          );
          return ok({ analysis: result });
        }
        return err(`Unknown action: ${args.action}. Use "analyze", "lookup", or "ai".`);
      } catch (e: any) {
        return err(e.message);
      }
    });

  const insight = defineTool(
    'triz_insight',
    'AI insight on applying a specific TRIZ principle to a problem.',
  )
    .required('problemDescription', 'string', 'Description of the problem')
    .required('principleIndex', 'number', 'TRIZ principle index (1-40)')
    .param('context', 'string', 'Additional context')
    .handle(async (args) => {
      if (!aiAgent) return err('AI agent not configured');
      const principle = principleEngine.getPrinciple(args.principleIndex);
      if (!principle) return err(`Principle ${args.principleIndex} not found`);
      try {
        const result = await aiAgent.generateInsight(args.problemDescription, principle, args.context);
        return ok({ insight: result });
      } catch (e: any) {
        return err(e.message);
      }
    });

  const suField = defineTool(
    'triz_su_field',
    'Analyze a Substance-Field (Su-Field) model. problemType: harmful, insufficient, excessive, complete.',
  )
    .required('substance1', 'string', 'Active component (S1, tool)')
    .required('substance2', 'string', 'Passive component (S2, object)')
    .required('field', 'string', 'Field: mechanical, thermal, chemical, electrical, magnetic, optical, acoustic, biological, or custom')
    .param('problemType', 'string', 'harmful, insufficient, excessive, complete (default: complete)')
    .handle((args) => {
      const components = { substance1: args.substance1, substance2: args.substance2, field: args.field };
      switch (args.problemType) {
        case 'harmful':
          return ok(suFieldService.analyzeHarmful(args.substance1, args.substance2, args.field));
        case 'insufficient':
          return ok(suFieldService.analyzeInsufficient(args.substance1, args.substance2, args.field));
        case 'excessive':
          return ok({
            type: 'excessive' as const,
            diagnosis: `Excessive Su-Field: ${args.substance1} applies excessive ${args.field} on ${args.substance2}.`,
            standardSolutions: [
              '1.2.1 — Introduce S3 between S1 and S2 to absorb excess field',
              '1.2.2 — Modify S2 to be less sensitive to the field',
              '1.2.3 — Replace the field with a less intense type',
              '2.2.1 — Introduce a bucking field to cancel the excess',
            ],
            recommendedAction: 'Apply Standard Solutions 1.2.x to eliminate excessive interaction, or 2.2.x for field cancellation.',
          });
        default:
          return ok(suFieldService.analyze(components));
      }
    });

  const ideality = defineTool(
    'triz_ideality',
    'Score system ideality = Benefits / (Costs + Harms). Returns score, level, dominant factor, confidence.',
  )
    .required('problemId', 'string', 'Problem identifier')
    .param('benefits', 'array', 'Benefit descriptions')
    .param('costs', 'array', 'Cost/resource descriptions')
    .param('harms', 'array', 'Harmful effect descriptions')
    .param('benefitWeight', 'number', 'Default per-benefit score (default 10)')
    .param('costWeight', 'number', 'Default per-cost score (default 5)')
    .param('harmWeight', 'number', 'Default per-harm score (default 8)')
    .param('benefitWeights', 'array', 'Per-benefit weights override (in benefits order)')
    .param('costWeights', 'array', 'Per-cost weights override (in costs order)')
    .param('harmWeights', 'array', 'Per-harm weights override (in harms order)')
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
          benefitWeights: args.benefitWeights,
          costWeights: args.costWeights,
          harmWeights: args.harmWeights,
        });
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    });

  const sCurve = defineTool(
    'triz_s_curve',
    'S-curve technology analysis. action="analyze" (full TRL + stage + SVG), "extract" (AI pulls historical data), "enrich" (AI estimates params when no data).',
  )
    .required('action', 'string', 'One of: "analyze", "extract", "enrich"')
    .required('technologyName', 'string', 'e.g. "lithium-ion batteries"')
    .required('performanceMetric', 'string', 'e.g. "Wh/kg", "MPG", "TFLOPS"')
    .param('dataPoints', 'array', '[{x: year, y: performance}] for "analyze"')
    .param('currentYear', 'number', 'For "analyze" (default: this year)')
    .param('trl', 'number', 'User-provided TRL 1-9 override for "analyze"')
    .param('trlReasoning', 'string', 'Reasoning for TRL override')
    .handle(async (args) => {
      try {
        if (args.action === 'analyze') {
          if (!sCurveHandler) return err('S-Curve analysis not configured');
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
        }
        if (args.action === 'extract') {
          if (!aiSCurveDataExtractor) return err('AI S-Curve data extractor not configured');
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
          if (result.dataPoints.length > 0) sCurveDataCache.set(key, result.dataPoints);
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
        }
        if (args.action === 'enrich') {
          if (!aiSCurveEstimator) return err('AI S-Curve estimator not configured');
          const result = await aiSCurveEstimator.estimate(args.technologyName, args.performanceMetric);
          return ok({
            technology: args.technologyName,
            estimatedParameters: result.estimatedParameters,
            estimatedStage: result.estimatedStage,
            s2Offset: result.s2Offset,
            reasoning: result.reasoning,
          });
        }
        return err(`Unknown action: ${args.action}. Use "analyze", "extract", or "enrich".`);
      } catch (e: any) {
        return err(e.message);
      }
    });

  const search = defineTool(
    'triz_search',
    'Search prior art. target="papers" (cache-first), "patents" (cache-first), or "all" (patents + papers + tech in parallel, no cache). forceRefresh applies to papers/patents only.',
  )
    .required('target', 'string', 'One of: "papers", "patents", "all"')
    .required('query', 'string', 'Search query')
    .param('maxResults', 'number', 'Max results (default 5; per source for target="all")')
    .param('forceRefresh', 'boolean', 'Bypass cache for papers/patents (default false)')
    .handle(async (args) => {
      if (!cachedSearch) return err('Search service not configured');
      const max = args.maxResults || 5;
      try {
        if (args.target === 'papers') {
          const cached = cachedSearch.getCachedPapers(args.query, max);
          if (cached.length > 0 && !args.forceRefresh) {
            return ok({ target: 'papers', count: cached.length, results: cached, source: 'cache' });
          }
          const results = await cachedSearch.searchPapers(args.query, max);
          return ok({ target: 'papers', count: results.length, results, source: 'api' });
        }
        if (args.target === 'patents') {
          const cached = cachedSearch.getCachedPatents(args.query, max);
          if (cached.length > 0 && !args.forceRefresh) {
            return ok({ target: 'patents', count: cached.length, results: cached, source: 'cache' });
          }
          const results = await cachedSearch.searchPatents(args.query, max);
          return ok({ target: 'patents', count: results.length, results, source: 'api' });
        }
        if (args.target === 'all') {
          const [patents, papers, tech] = await Promise.all([
            cachedSearch.searchPatents(args.query, max),
            cachedSearch.searchPapers(args.query, max),
            cachedSearch.searchTechSolutions(args.query, max),
          ]);
          return ok({
            target: 'all',
            patents: { count: patents.length, results: patents },
            papers: { count: papers.length, results: papers },
            techSolutions: { count: tech.length, results: tech },
          });
        }
        return err(`Unknown target: ${args.target}. Use "papers", "patents", or "all".`);
      } catch (e: unknown) {
        return err(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  const currentDatetime = defineTool(
    'current_datetime',
    'Get the current date and time. Returns ISO 8601 formatted datetime, Unix timestamp, and human-readable local time in multiple formats.',
  )
    .handle(() => {
      const now = new Date();
      return ok({
        iso: now.toISOString(),
        unix: Math.floor(now.getTime() / 1000),
        local: now.toLocaleString(),
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        utc: now.toUTCString(),
      });
    });

  return [
    principles,
    parameters,
    contradiction,
    insight,
    suField,
    ideality,
    sCurve,
    search,
    currentDatetime,
  ];
}

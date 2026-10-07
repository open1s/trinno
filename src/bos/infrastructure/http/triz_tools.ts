import { defineTool, ok, err } from '@open1s/ezbos';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
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
import type { TRLLevel } from '../../domain/s_curve/value_objects.js';

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

  const principles = defineTool({
    name: 'triz_principles',
    description: 'Access TRIZ inventive principles (40). action="get" (by index), "search" (by keyword), "list" (all 40).',
    parameters: z.object({
      action: z.enum(['get', 'search', 'list']).describe('One of: "get", "search", "list"'),
      index: z.number().optional().describe('1-40 (required for action="get")'),
      query: z.string().optional().describe('Search keyword, supports Chinese + multi-token (required for action="search")'),
      limit: z.number().optional().describe('Max results for search (default 10)'),
      minScore: z.number().optional().describe('Min relevance score for search (default 0)'),
      includeExamples: z.boolean().optional().describe('Include usage examples for get (default true)'),
    }),
    execute: ({ action, index, query, limit, minScore, includeExamples }) => {
      if (action === 'list') {
        const all = principleEngine.getAllPrinciples();
        return ok({ count: all.length, principles: all });
      }
      if (action === 'get') {
        if (typeof index !== 'number') return err('action="get" requires index (1-40)');
        const principle = principleEngine.getPrinciple(index);
        if (!principle) return err(`Principle ${index} not found (valid range: 1-40)`);
        if (includeExamples === false) {
          const { examples, ...rest } = principle;
          return ok(rest);
        }
        return ok(principle);
      }
      if (action === 'search') {
        if (!query) return err('action="search" requires query');
        const effLimit = typeof limit === 'number' && limit > 0 ? Math.min(40, Math.floor(limit)) : 10;
        const effMinScore = typeof minScore === 'number' ? minScore : 0;
        const scored = principleEngine.searchPrinciplesScored(query, { limit: effLimit, minScore: effMinScore });
        return ok({ count: scored.length, query, results: scored });
      }
      return err(`Unknown action: ${action}. Use "get", "search", or "list".`);
    },
  });

  const parameters = defineTool({
    name: 'triz_parameters',
    description: 'List all 39 TRIZ engineering parameters with names and descriptions.',
    parameters: z.object({}),
    execute: () => {
      const all = matrix.getAllParameters();
      return ok({ count: all.length, parameters: all });
    },
  });

  const contradiction = defineTool({
    name: 'triz_contradiction',
    description: 'Resolve a technical/physical contradiction. action="analyze" (rule-based), "lookup" (matrix lookup), "ai" (LLM analysis).',
    parameters: z.object({
      action: z.enum(['analyze', 'lookup', 'ai']).describe('One of: "analyze", "lookup", "ai"'),
      improvingParameter: z.number().describe('TRIZ parameter index (1-39) to improve'),
      worseningParameter: z.number().describe('TRIZ parameter index (1-39) that gets worse'),
      description: z.string().optional().describe('Problem context (recommended for "analyze" and "ai")'),
      type: z.enum(['technical', 'physical']).optional().describe('"technical" or "physical" (default: technical)'),
      context: z.string().optional().describe('Additional context for deeper analysis'),
    }),
    execute: async ({ action, improvingParameter, worseningParameter, description, type, context }) => {
      const improvingName = getParameterByIndex(improvingParameter)?.name ?? `#${improvingParameter}`;
      const worseningName = getParameterByIndex(worseningParameter)?.name ?? `#${worseningParameter}`;
      try {
        if (action === 'lookup') {
          const principles = matrix.lookup(improvingParameter, worseningParameter);
          const detailed = principles
            .map(idx => principleEngine.getPrinciple(idx))
            .filter((p): p is NonNullable<typeof p> => p !== undefined)
            .map(p => ({ index: p.index, name: p.name, nameZh: p.nameZh, description: p.description }));
          return ok({
            improvingParameter: { index: improvingParameter, name: improvingName },
            worseningParameter: { index: worseningParameter, name: worseningName },
            principles: detailed,
            principleCount: detailed.length,
          });
        }
        if (action === 'analyze') {
          const result = await analyzeContradictionHandler.execute({
            improvingParameter,
            worseningParameter,
            description: description || '',
            type: type || 'technical',
            ...(context !== undefined ? { context } : {}),
          });
          return ok({
            contradictionId: result.contradictionId,
            improvingParameter: { index: improvingParameter, name: improvingName },
            worseningParameter: { index: worseningParameter, name: worseningName },
            recommendedPrinciples: result.recommendedPrinciples,
          });
        }
        if (action === 'ai') {
          if (!aiAgent) return err('AI agent not configured');
          if (!description) return err('action="ai" requires description');
          const result = await aiAgent.analyzeContradiction(
            improvingName,
            worseningName,
            description,
          );
          return ok({ analysis: result });
        }
        return err(`Unknown action: ${action}. Use "analyze", "lookup", or "ai".`);
      } catch (e: any) {
        return err(e.message);
      }
    },
  });

  const insight = defineTool({
    name: 'triz_insight',
    description: 'AI insight on applying a specific TRIZ principle to a problem.',
    parameters: z.object({
      problemDescription: z.string().describe('Description of the problem'),
      principleIndex: z.number().describe('TRIZ principle index (1-40)'),
      context: z.string().optional().describe('Additional context'),
    }),
    execute: async ({ problemDescription, principleIndex, context }) => {
      if (!aiAgent) return err('AI agent not configured');
      const principle = principleEngine.getPrinciple(principleIndex);
      if (!principle) return err(`Principle ${principleIndex} not found`);
      try {
        const result = await aiAgent.generateInsight(problemDescription, principle, context);
        return ok({ insight: result });
      } catch (e: any) {
        return err(e.message);
      }
    },
  });

  const suField = defineTool({
    name: 'triz_su_field',
    description: 'Analyze a Substance-Field (Su-Field) model. problemType: harmful, insufficient, excessive, complete.',
    parameters: z.object({
      substance1: z.string().describe('Active component (S1, tool)'),
      substance2: z.string().describe('Passive component (S2, object)'),
      field: z.string().describe('Field: mechanical, thermal, chemical, electrical, magnetic, optical, acoustic, biological, or custom'),
      problemType: z.enum(['harmful', 'insufficient', 'excessive', 'complete']).optional().describe('harmful, insufficient, excessive, complete (default: complete)'),
    }),
    execute: ({ substance1, substance2, field, problemType }) => {
      const components = { substance1, substance2, field };
      switch (problemType) {
        case 'harmful':
          return ok(suFieldService.analyzeHarmful(substance1, substance2, field));
        case 'insufficient':
          return ok(suFieldService.analyzeInsufficient(substance1, substance2, field));
        case 'excessive':
          return ok({
            type: 'excessive' as const,
            diagnosis: `Excessive Su-Field: ${substance1} applies excessive ${field} on ${substance2}.`,
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
    },
  });

  const ideality = defineTool({
    name: 'triz_ideality',
    description: 'Score system ideality = Benefits / (Costs + Harms). Returns score, level, dominant factor, confidence.',
    parameters: z.object({
      problemId: z.string().describe('Problem identifier'),
      benefits: z.array(z.string()).optional().describe('Benefit descriptions'),
      costs: z.array(z.string()).optional().describe('Cost/resource descriptions'),
      harms: z.array(z.string()).optional().describe('Harmful effect descriptions'),
      benefitWeight: z.number().optional().describe('Default per-benefit score (default 10)'),
      costWeight: z.number().optional().describe('Default per-cost score (default 5)'),
      harmWeight: z.number().optional().describe('Default per-harm score (default 8)'),
      benefitWeights: z.array(z.number()).optional().describe('Per-benefit weights override (in benefits order)'),
      costWeights: z.array(z.number()).optional().describe('Per-cost weights override (in costs order)'),
      harmWeights: z.array(z.number()).optional().describe('Per-harm weights override (in harms order)'),
    }),
    execute: async ({ problemId, benefits, costs, harms, benefitWeight, costWeight, harmWeight, benefitWeights, costWeights, harmWeights }) => {
      try {
        const result = await idealityHandler.execute({
          problemId,
          benefits: benefits || [],
          costs: costs || [],
          harms: harms || [],
          ...(benefitWeight !== undefined ? { benefitWeight } : {}),
          ...(costWeight !== undefined ? { costWeight } : {}),
          ...(harmWeight !== undefined ? { harmWeight } : {}),
          ...(benefitWeights !== undefined ? { benefitWeights } : {}),
          ...(costWeights !== undefined ? { costWeights } : {}),
          ...(harmWeights !== undefined ? { harmWeights } : {}),
        });
        return ok(result);
      } catch (e: any) {
        return err(e.message);
      }
    },
  });

  const sCurve = defineTool({
    name: 'triz_s_curve',
    description: 'S-curve technology analysis. action="analyze" (full TRL + stage + SVG), "extract" (AI pulls historical data), "enrich" (AI estimates params when no data).',
    parameters: z.object({
      action: z.enum(['analyze', 'extract', 'enrich']).describe('One of: "analyze", "extract", "enrich"'),
      technologyName: z.string().describe('e.g. "lithium-ion batteries"'),
      performanceMetric: z.string().describe('e.g. "Wh/kg", "MPG", "TFLOPS"'),
      dataPoints: z.array(z.any()).optional().describe('[{x: year, y: performance}] for "analyze"'),
      currentYear: z.number().optional().describe('For "analyze" (default: this year)'),
      trl: z.number().optional().describe('User-provided TRL 1-9 override for "analyze"'),
      trlReasoning: z.string().optional().describe('Reasoning for TRL override'),
    }),
    execute: async ({ action, technologyName, performanceMetric, dataPoints, currentYear, trl, trlReasoning }) => {
      try {
        if (action === 'analyze') {
          if (!sCurveHandler) return err('S-Curve analysis not configured');
          const result = await sCurveHandler.execute({
            technologyName,
            performanceMetric,
            dataPoints: dataPoints || [],
            ...(currentYear !== undefined ? { currentYear } : {}),
            ...(trl !== undefined ? { trl: trl as TRLLevel } : {}),
            ...(trlReasoning !== undefined ? { trlReasoning } : {}),
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
        if (action === 'extract') {
          if (!aiSCurveDataExtractor) return err('AI S-Curve data extractor not configured');
          const key = `${technologyName}:${performanceMetric}`;
          const cached = sCurveDataCache.get(key);
          if (cached) {
            return ok({
              technology: technologyName,
              metric: performanceMetric,
              dataPoints: cached,
              dataPointCount: cached.length,
              source: 'cache',
            });
          }
          const result = await aiSCurveDataExtractor.extractData(technologyName, performanceMetric);
          if (result.dataPoints.length > 0) sCurveDataCache.set(key, result.dataPoints);
          return ok({
            technology: technologyName,
            metric: performanceMetric,
            dataPoints: result.dataPoints,
            milestones: result.milestones,
            sources: result.sources,
            reasoning: result.reasoning,
            dataPointCount: result.dataPoints.length,
            source: 'ai',
          });
        }
        if (action === 'enrich') {
          if (!aiSCurveEstimator) return err('AI S-Curve estimator not configured');
          const result = await aiSCurveEstimator.estimate(technologyName, performanceMetric);
          return ok({
            technology: technologyName,
            estimatedParameters: result.estimatedParameters,
            estimatedStage: result.estimatedStage,
            s2Offset: result.s2Offset,
            reasoning: result.reasoning,
          });
        }
        return err(`Unknown action: ${action}. Use "analyze", "extract", or "enrich".`);
      } catch (e: any) {
        return err(e.message);
      }
    },
  });

  const search = defineTool({
    name: 'triz_search',
    description: 'Search prior art. target="papers" (cache-first), "patents" (cache-first), or "all" (patents + papers + tech in parallel, no cache). forceRefresh applies to papers/patents only.',
    parameters: z.object({
      target: z.enum(['papers', 'patents', 'all']).describe('One of: "papers", "patents", "all"'),
      query: z.string().describe('Search query'),
      maxResults: z.number().optional().describe('Max results (default 5; per source for target="all")'),
      forceRefresh: z.boolean().optional().describe('Bypass cache for papers/patents (default false)'),
    }),
    execute: async ({ target, query, maxResults, forceRefresh }) => {
      if (!cachedSearch) return err('Search service not configured');
      const max = maxResults || 5;
      try {
        if (target === 'papers') {
          const cached = cachedSearch.getCachedPapers(query, max);
          if (cached.length > 0 && !forceRefresh) {
            return ok({ target: 'papers', count: cached.length, results: cached, source: 'cache' });
          }
          const results = await cachedSearch.searchPapers(query, max);
          return ok({ target: 'papers', count: results.length, results, source: 'api' });
        }
        if (target === 'patents') {
          const cached = cachedSearch.getCachedPatents(query, max);
          if (cached.length > 0 && !forceRefresh) {
            return ok({ target: 'patents', count: cached.length, results: cached, source: 'cache' });
          }
          const results = await cachedSearch.searchPatents(query, max);
          return ok({ target: 'patents', count: results.length, results, source: 'api' });
        }
        if (target === 'all') {
          const [patentsResult, papersResult, techResult] = await Promise.allSettled([
            cachedSearch.searchPatents(query, max),
            cachedSearch.searchPapers(query, max),
            cachedSearch.searchTechSolutions(query, max),
          ]);
          const patents = patentsResult.status === 'fulfilled' ? patentsResult.value : [];
          const papers = papersResult.status === 'fulfilled' ? papersResult.value : [];
          const tech = techResult.status === 'fulfilled' ? techResult.value : [];
          const errors: string[] = [];
          if (patentsResult.status === 'rejected') errors.push(`patents: ${patentsResult.reason?.message || patentsResult.reason}`);
          if (papersResult.status === 'rejected') errors.push(`papers: ${papersResult.reason?.message || papersResult.reason}`);
          if (techResult.status === 'rejected') errors.push(`tech: ${techResult.reason?.message || techResult.reason}`);
          return ok({
            target: 'all',
            patents: { count: patents.length, results: patents },
            papers: { count: papers.length, results: papers },
            techSolutions: { count: tech.length, results: tech },
            ...(errors.length > 0 ? { errors } : {}),
          });
        }
        return err(`Unknown target: ${target}. Use "papers", "patents", or "all".`);
      } catch (e: unknown) {
        return err(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });

  const currentDatetime = defineTool({
    name: 'current_datetime',
    description: 'Get the current date and time. Returns ISO 8601 formatted datetime, Unix timestamp, and human-readable local time in multiple formats.',
    parameters: z.object({}),
    execute: () => {
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
    },
  });

  const updateGoal = defineTool({
    name: 'update_goal',
    description: 'Update the goal status. Agent can ONLY set "complete" or "blocked" — pause/resume/budget-limit are system operations (use /goal pause, /goal resume, /goal status <note>, /goal log). For "complete": only after every acceptance criterion is measured against current-state evidence (file content, command output, test result, metric value). For "blocked": only after 3 consecutive turns with the same blocking reason, and you have attempted multiple verification approaches.',
    parameters: z.object({
      status: z.string().describe('Only "complete" or "blocked" — other statuses are system-managed and will be rejected'),
      reasoning: z.string().optional().describe('REQUIRED. For "complete": list EACH acceptance criterion alongside its measured evidence (e.g. "criterion: file X exists → evidence: ls shows X at 1204 bytes; criterion: tests pass → evidence: npm test output shows 7 passing"). For "blocked": describe the blocker AND what verification commands you already ran (full command + output).'),
    }),
    execute: ({ status, reasoning }) => {
      const root: string = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
      const fp = path.join(root, '.trinno', 'goal.json');
      let goal: any = {};
      let previousStatus: string | undefined;
      try {
        goal = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        previousStatus = goal.status;
      } catch {
        return err('No goal is currently set. Use /goal <text> to create one first.');
      }

      // HARD GATE: agent can ONLY set complete or blocked
      if (status !== 'complete' && status !== 'blocked') {
        return err('Agent can only set "complete" or "blocked". Pause/resume/budget-limit are system operations. Rejected: "' + status + '".');
      }

      // Blocked audit: track consecutive reasons
      if (status === 'blocked') {
        if (!reasoning) return err('"blocked" requires reasoning describing the blocker.');
        if (!Array.isArray(goal.blockedReasons)) goal.blockedReasons = [];
        const lastReason = goal.blockedReasons.length > 0 ? goal.blockedReasons[goal.blockedReasons.length - 1] : null;
        goal.blockedReasons.push(reasoning);

        // Check consecutive: 3+ turns with same blocking reason needed
        const sameCount = lastReason === reasoning ? (goal.blockedCount ?? 0) + 1 : 1;
        goal.blockedCount = sameCount;
        goal.status = 'blocked';

        if (sameCount < 3) {
          // Write to disk but return a HARD FAIL — agent is blocked from calling this too early
          goal.updatedAt = Date.now();
          if (!Array.isArray(goal.history)) goal.history = [];
          goal.history.push({ at: Date.now(), from: previousStatus ?? 'none', to: 'blocked', note: `attempt ${sameCount}/3: ${reasoning}` });
          const dir = path.dirname(fp);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fp, JSON.stringify(goal, null, 2));
          return err(`Blocked audit: only ${sameCount}/3 consecutive blocked reasons with same blocker. Agent must verify this blocker persists for 3 consecutive goal turns before calling update_goal(status="blocked"). Do NOT call update_goal blocked again this turn — continue working.`);
        }
        // 3+ consecutive → allow
      }

      // Evidence gate for 'complete': reject subjective reasoning
      if (status === 'complete') {
        if (!reasoning || reasoning.trim().length < 80) {
          return err('complete requires reasoning with evidence per criterion (min 80 chars). List each acceptance criterion alongside its measured evidence (file content / command output / test result / metric value). Rejected: reasoning too short.');
        }
        const lowered = reasoning.toLowerCase();
        const forbidden = ['looks good', 'looks correct', 'seems complete', 'i reviewed', 'i checked', 'appears correct', 'should be done'];
        for (const phrase of forbidden) {
          if (lowered.includes(phrase)) {
            return err(`complete requires MEASURABLE evidence, not subjective statements. Reasoning contains forbidden phrase "${phrase}". List each criterion with its concrete evidence: file path + content, command + stdout, test name + pass, metric + value.`);
          }
        }
      }

      goal.status = status;
      goal.updatedAt = Date.now();
      if (reasoning) goal.lastReasoning = reasoning;
      goal.blockedCount = 0; // Reset for next use
      if (!Array.isArray(goal.history)) goal.history = [];
      goal.history.push({ at: Date.now(), from: previousStatus ?? 'none', to: status, note: reasoning });

      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(goal, null, 2));

      return ok({
        previousStatus: previousStatus ?? 'none',
        newStatus: status,
        goalText: goal.text,
        reasoning,
        tokensUsed: goal.tokensUsed ?? 0,
        tokenBudget: goal.tokenBudget,
        createdAt: goal.createdAt,
      });
    },
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
    updateGoal,
  ];
}

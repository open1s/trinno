import { BrainOS } from '@open1s/ezbos';
import { ContradictionMatrix } from '../../domain/contradiction/matrix.js';
import { PrincipleEngine } from '../../domain/principle/services.js';
import { SuFieldAnalysisService } from '../../domain/solution/su_field_service.js';
import { AiTrizAgent } from '../ai/triz_ai_agent.js';
import { MultiSourceSearchService, MultiSourceSearchConfig } from '../search/multi_source_search.js';
import { CachedSearchService } from '../search/cached_search.js';
import { PersistentSearchCache, defaultSearchCachePath } from '../search/persistent_search_cache.js';
import { AISummarizer } from '../search/ai_summarizer.js';
import { AiSCurveEstimator } from '../s_curve/ai_estimator.js';
import { AiSCurveDataExtractor } from '../s_curve/ai_data_extractor.js';
import { TRLAssessor } from '../triz/trl_assessor.js';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { createTrizTools } from '../http/triz_tools.js';
import { createCodingTools } from '../http/coding_tools.js';
import { createPapersTools } from '../http/papers_tools.js';
import { createMemoryTools } from '../http/memory_tools.js';
import { createTodoTools } from '../http/todo_tools.js';
import { createTypstTools } from '../http/typst_tools.js';
import { createWebsearchTools } from '../http/websearch_tools.js';
import { ToolPermissionConfig, DEFAULT_TOOL_PERMISSIONS } from './toolPermissions.js';
import { createToolPermissionHook, wrapAllTools } from './toolPermissionHook.js';
import { LocaleConfig, DEFAULT_LOCALE } from '../../domain/shared/i18n.js';
import { ContradictionAnalysisService } from '../../domain/contradiction/services.js';
import { AnalyzeContradictionHandler } from '../../application/analyze_contradiction/handler.js';
import { GenerateSolutionsHandler } from '../../application/generate_solutions/handler.js';
import { EvaluateIdealityHandler } from '../../application/evaluate_ideality/handler.js';
import { AnalyzeSCurveHandler } from '../../application/analyze_s_curve/handler.js';
import { InMemoryContradictionRepository } from '../persistence/in_memory_repository.js';
import { InMemorySolutionRepository } from '../persistence/solution_repository.js';
import { InMemorySCurveRepository } from '../persistence/s_curve_repository.js';
import { RawFactsSaver } from '../persistence/raw_facts_saver.js';
import { PhaseWriter } from '../persistence/phase_writer.js';

// Re-export for src/bos files (excluded from tsc but used by other modules)
export { ContradictionAnalysisService } from '../../domain/contradiction/services.js';
export { AnalyzeContradictionHandler } from '../../application/analyze_contradiction/handler.js';
export { GenerateSolutionsHandler } from '../../application/generate_solutions/handler.js';
export { EvaluateIdealityHandler } from '../../application/evaluate_ideality/handler.js';
export { AnalyzeSCurveHandler } from '../../application/analyze_s_curve/handler.js';
export { InMemoryContradictionRepository } from '../persistence/in_memory_repository.js';
export { InMemorySolutionRepository } from '../persistence/solution_repository.js';
export { InMemorySCurveRepository } from '../persistence/s_curve_repository.js';
export { RawFactsSaver } from '../persistence/raw_facts_saver.js';

export interface TrizDeps {
  brain: BrainOS;
  analysisService: any;
  principleEngine: PrincipleEngine;
  suFieldService: SuFieldAnalysisService;
  contradictionRepo: any;
  solutionRepo: any;
  sCurveRepo: any;
  rawFactsSaver: any;
  analyzeContradictionHandler: any;
  generateSolutionsHandler: any;
  idealityHandler: any;
  sCurveHandler: any;
  aiAgent: AiTrizAgent;
  aiSCurveEstimator: AiSCurveEstimator;
  aiSCurveDataExtractor: AiSCurveDataExtractor;
  trlAssessor: TRLAssessor;
  searchService: CachedSearchService;
  summarizer: AISummarizer;
  phaseWriter: PhaseWriter;
  tools: any[];
  toolPermissionHook: any;
  afterToolHook: any;
}

export async function composeRoot(options: {
  searchConfig?: MultiSourceSearchConfig;
  locale?: LocaleConfig;
  apiKey?: string;
  workspaceRoot?: string;
  toolPermissions?: ToolPermissionConfig;
  sandboxEnabled?: boolean;
} = {}): Promise<TrizDeps> {
  const locale = options.locale || DEFAULT_LOCALE;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const toolPermissions = options.toolPermissions || DEFAULT_TOOL_PERMISSIONS;
  const sandboxEnabled = options.sandboxEnabled || false;

  const brainOptions: any = {};
  if (options.apiKey) brainOptions.apiKey = options.apiKey;
  const brain = new BrainOS(brainOptions);
  await brain.start();

  const principleEngine = new PrincipleEngine();
  const suFieldService = new SuFieldAnalysisService();
  const aiAgent = new AiTrizAgent(brain, 'triz-expert', locale);

  const searchConfig = options.searchConfig || {
    semanticScholar: {},
    crossRef: { email: 'triz-tool@example.com' },
    openAlex: {},
  };
  const innerSearch = new MultiSourceSearchService(searchConfig);
  const persistentCache = new PersistentSearchCache({ cacheFilePath: defaultSearchCachePath(workspaceRoot) });
  const searchService = new CachedSearchService(innerSearch, persistentCache);
  const summarizer = new AISummarizer(brain, locale);
  const aiSCurveDataExtractor = new AiSCurveDataExtractor(searchService, brain, locale);
  const trlAssessor = new TRLAssessor(brain, locale);
  const aiSCurveEstimator = new AiSCurveEstimator(brain, locale);

  const trizTools = createTrizTools(
    principleEngine,
    suFieldService,
    undefined as any,
    undefined as any,
    aiAgent,
    searchService,
    undefined as any,
    aiSCurveEstimator,
    aiSCurveDataExtractor,
  );

  const codingTools = createCodingTools(workspaceRoot, sandboxEnabled);

  const analysisService = new ContradictionAnalysisService();
  const contradictionRepo = new InMemoryContradictionRepository();
  const solutionRepo = new InMemorySolutionRepository();
  const sCurveRepo = new InMemorySCurveRepository();
  const rawFactsSaver = new RawFactsSaver();
  const phaseWriter = new PhaseWriter(workspaceRoot);
  const papersTools = createPapersTools(phaseWriter);
  const memoryTools = createMemoryTools(workspaceRoot);
  const todoTools = createTodoTools(workspaceRoot);
  const typstTools = createTypstTools(workspaceRoot);
  const analyzeContradictionHandler = new AnalyzeContradictionHandler(analysisService, contradictionRepo);
  const generateSolutionsHandler = new GenerateSolutionsHandler(contradictionRepo, principleEngine, solutionRepo);
  const idealityHandler = new EvaluateIdealityHandler(locale);
  const sCurveHandler = new AnalyzeSCurveHandler(trlAssessor, locale, sCurveRepo, rawFactsSaver);

  const { beforeHook, afterHook } = createToolPermissionHook(toolPermissions);
  const websearchTools = createWebsearchTools();
  const allTools = [...trizTools, ...codingTools, ...papersTools, ...memoryTools, ...todoTools, ...typstTools, ...websearchTools];
  const tools = wrapAllTools(allTools, toolPermissions);

  initAgentFactory(brain, {
    defaultTools: tools,
    defaultHooks: [beforeHook, afterHook],
  });

  return {
    brain,
    analysisService,
    principleEngine,
    suFieldService,
    contradictionRepo,
    solutionRepo,
    sCurveRepo,
    rawFactsSaver,
    analyzeContradictionHandler,
    generateSolutionsHandler,
    idealityHandler,
    sCurveHandler,
    aiAgent,
    aiSCurveEstimator,
    aiSCurveDataExtractor,
    trlAssessor,
    searchService,
    summarizer,
    phaseWriter,
    tools,
    toolPermissionHook: beforeHook,
    afterToolHook: afterHook,
  };
}

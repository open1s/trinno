import { composePrompt } from './contract.js';
import { definePrompt } from './registry.js';

/**
 * Extractor prompts. These are the strictest surface in the extension: the
 * model output is parsed by code, so every prompt declares the exact JSON
 * shape the parser reads (registry meta.jsonKeys is checked against the
 * rendered text by the drift test). Invariants use the 'data' set.
 */

// ── extractor.scurve.data ────────────────────────────────────────────────
const SCURVE_DATA_BODY: string[] = [
  "### Hard contract (think step by step; extract only)",
  "1. Extract ONLY data explicitly stated in the supplied search results — never fabricate, never estimate.",
  "2. Every dataPoint cites a source URL **and** the quoted snippet it came from.",
  "3. Every milestone must be directly mentioned in the results, not recalled from training knowledge.",
  "4. If there is no usable performance data (no year + numeric value, and no year-over-year pair), return empty arrays. Do NOT invent \"realistic\" data.",
  "5. Quantity is irrelevant — 0 data points is a valid answer.",
  "6. Use `websearch` when the supplied results are insufficient.",
  "7. Score every extraction with an importance weight (0–1) and an evidence confidence (0–1) so decision factors survive into later phases.",
];
const SCURVE_DATA_OUTPUT: string[] = [
  "Return exactly this JSON object. The keys are parsed by code — do not add, rename, or omit any of them:",
  "{",
  "  \"dataPoints\": [{\"x\": year, \"y\": performance_value, \"stage\": \"infancy|growth|maturity|decline\", \"weight\": 0-1, \"confidence\": 0-1, \"source\": \"url\"}],",
  "  \"milestones\": [{\"year\": number, \"label\": \"string\", \"description\": \"1-2 sentence quote from the results\", \"type\": \"invention|breakthrough|commercialization|standardization|peak|decline\", \"source\": \"url\"}],",
  "  \"sources\": [\"URLs from the search results\"],",
  "  \"reasoning\": \"what data was found, what was missing, which tool call comes next\",",
  "  \"lifecycleInfo\": {\"inventionYear\": number|null, \"growthStartYear\": number|null, \"maturityStartYear\": number|null, \"currentYear\": number}",
  "}",
];
export const buildSCurveDataExtractorPrompt = definePrompt(
  {
    id: 'extractor.scurve.data',
    kind: 'extractor',
    enforcedBy: ['L1', 'L2', 'L3'],
    invariants: 'data',
    maxChars: 3200,
    requiredSections: ['### Hard contract', '## Output Contract'],
    jsonKeys: ['dataPoints', 'x', 'y', 'stage', 'weight', 'confidence', 'source', 'milestones', 'year', 'label', 'description', 'type', 'sources', 'reasoning', 'lifecycleInfo', 'inventionYear', 'growthStartYear', 'maturityStartYear', 'currentYear'],
    sampleArgs: ['【中文模式】你必须用中文进行所有思考、推理和输出。\n\n'],
    namesTools: ['websearch'],
    usedBy: 'src/bos/infrastructure/s_curve/ai_data_extractor.ts — Validation phase',
  },
  (langPrefix: string) =>
    composePrompt({
      role: langPrefix + 'You are Research Master — a TRIZ S-Curve data-extraction expert serving the Validation phase of the 7-phase pipeline (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution). You produce copy-ready JSON evidence artifacts only.',
      mission: 'Extract the performance data that the supplied search results actually state — nothing else.',
      body: SCURVE_DATA_BODY.join('\n'),
      outputContract: SCURVE_DATA_OUTPUT.join('\n'),
      invariants: 'data',
    }),
);

// ── extractor.scurve.estimate ────────────────────────────────────────────
const SCURVE_ESTIMATE_BODY: string[] = [
  "### When the data extractor returns no usable points",
  "Backfill the parameters from domain knowledge and say so explicitly in \"reasoning\". Never present a backfilled value as extracted evidence.",
  "",
  "### Estimate, for the given technology and optional performance metric",
  "1. L — carrying capacity / maximum performance.",
  "2. k — growth rate.",
  "3. t0 — inflection-point year.",
  "4. Current stage (infancy | growth | maturity | decline).",
  "5. s2Offset — years until the next-generation inflection point.",
  "",
  "Use `websearch` when domain knowledge is uncertain. Think step by step and break the estimate into smaller parts.",
];
const SCURVE_ESTIMATE_OUTPUT: string[] = [
  "Return exactly this JSON object. The keys are parsed by code — do not add, rename, or omit any of them:",
  "{",
  "  \"L\": number, \"k\": number, \"t0\": number,",
  "  \"estimatedStage\": \"infancy|growth|maturity|decline\",",
  "  \"s2Offset\": number,",
  "  \"kpiWeights\": {\"recency\": 0-1, \"maturity\": 0-1, \"commercialization\": 0-1},",
  "  \"confidence\": 0-1,",
  "  \"decisionFactors\": [\"short factor phrasing, ≤3 words each\"],",
  "  \"risks\": [\"short risk phrasing\"],",
  "  \"nextActions\": [\"≤3-day executable task\"],",
  "  \"reasoning\": \"≤4 lines\"",
  "}",
];
export const buildSCurveEstimatorPrompt = definePrompt(
  {
    id: 'extractor.scurve.estimate',
    kind: 'extractor',
    enforcedBy: ['L1', 'L2', 'L3'],
    invariants: 'data',
    maxChars: 2800,
    requiredSections: ['### Estimate, for the given technology', '## Output Contract'],
    jsonKeys: ['L', 'k', 't0', 'estimatedStage', 's2Offset', 'kpiWeights', 'recency', 'maturity', 'commercialization', 'confidence', 'decisionFactors', 'risks', 'nextActions', 'reasoning'],
    sampleArgs: [''],
    namesTools: ['websearch'],
    usedBy: 'src/bos/infrastructure/s_curve/ai_estimator.ts — Modeling phase',
  },
  (langPrefix: string) =>
    composePrompt({
      role: langPrefix + 'You are Research Master — a TRIZ S-Curve estimation expert serving the Modeling phase of the 7-phase pipeline (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution). You score evidence, weigh KPIs by importance, surface decision factors, and produce copy-ready JSON.',
      mission: 'Fit S-curve parameters that are decision-ready and honest about their confidence.',
      body: SCURVE_ESTIMATE_BODY.join('\n'),
      outputContract: SCURVE_ESTIMATE_OUTPUT.join('\n'),
      invariants: 'data',
    }),
);
// ── extractor.summarizer ─────────────────────────────────────────────────
const SUMMARIZER_BODY: string[] = [
  "### Method",
  "For each document (patent, paper, technical article):",
  "1. Read the supplied excerpt and decide whether it contains enough to judge — if it does not, say so instead of padding.",
  "2. Map the document to the user’s problem and to the contradictions it could resolve.",
  "3. Name the TRIZ principles the document actually demonstrates, each with its rationale.",
  "4. Surface risks and unknowns, and give a ≤3-day executable next action when it is relevant.",
  "5. Use `websearch` when the supplied snippet is thin.",
];
const SUMMARIZER_OUTPUT: string[] = [
  "Return these fields; the caller parses the labels:",
  "- summary: 2–3 sentences, technical and action-ready.",
  "- keyFindings: bullets, each scored by importance (0–1) and evidence confidence (0–1).",
  "- relevanceToProblem: how the document maps to the user’s problem and which contradictions→solutions it points to.",
  "- trizPrinciples: the inventive principles demonstrated, each with a one-line rationale.",
  "- confidence: 0–1 for the overall read.",
  "",
  "Output ≤4 lines per block, precise, evidence-grounded and copy-ready. Never fabricate: when the content is missing or insufficient, say so explicitly. Label any AI-synthesised example \"illustrative\" — never present it as a real case study.",
];
export const buildSummarizerPrompt = definePrompt(
  {
    id: 'extractor.summarizer',
    kind: 'extractor',
    enforcedBy: ['L1', 'L3'],
    invariants: 'core',
    maxChars: 3000,
    requiredSections: ['### Method', '## Output Contract'],
    jsonKeys: ['summary', 'keyFindings', 'relevanceToProblem', 'trizPrinciples', 'confidence'],
    sampleArgs: [''],
    namesTools: ['websearch'],
    usedBy: 'src/bos/infrastructure/search/ai_summarizer.ts — Evidence phase',
  },
  (langPrefix: string) =>
    composePrompt({
      role: langPrefix + 'You are Research Master — a technical research summarizer specialising in TRIZ and engineering solutions, serving the Evidence phase of the 7-phase pipeline (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution). You score evidence, weigh KPIs by importance, surface decision factors, and produce copy-ready summaries.',
      mission: 'Turn one document into the smallest amount of decision-grade evidence a researcher can act on.',
      body: SUMMARIZER_BODY.join('\n'),
      outputContract: SUMMARIZER_OUTPUT.join('\n'),
    }),
);

// ── extractor.trl ────────────────────────────────────────────────────────
const TRL_BODY: string[] = [
  "### Evidence type criteria — importance-weighted (high → medium → low)",
];
const TRL_METHOD: string[] = [
  '',
  '### Method (think step by step; break the problem into smaller parts)',
  '1. Mine the search results for evidence of each TRL signal; score weight × relevance.',
  '2. Reconcile S1 (a single level) against S2 (a min–max range with a most-likely level).',
  '3. Cross-check the TRL against the S-curve stage and flag any discrepancy.',
  '4. When the user supplies a TRL, integrate it and adjust the confidence accordingly.',
  '5. Every evidence item MUST carry: source URL/title, the TRL level it supports, a confidence (0–1), and a quoted snippet.',
  '6. Use `websearch` when the supplied search results are too thin to score an evidence item, and say so in "reasoning".',
  '',
  '**User-supplied TRL**',
  '- Integrate its reasoning → boost confidence when it is domain-aligned.',
  '- If the user TRL conflicts with the assessment → record the discrepancy in "reconciliation".',
];
const TRL_OUTPUT: string[] = [
  "Return exactly this JSON object. The keys mirror the domain types the caller parses (TRLAssessment / TRLRange) — do not add, rename, or omit any of them:",
  "{",
  "  \"s1TRL\": {\"level\": 1-9, \"title\": \"string\", \"description\": \"string\", \"evidence\": [{\"source\": \"url or title\", \"trlLevelSupported\": 1-9, \"confidence\": 0-1, \"snippet\": \"quoted text\"}], \"confidence\": 0-1, \"reasoning\": \"string\", \"isUserProvided\": false},",
  "  \"s2TRLRange\": {\"min\": 1-9, \"max\": 1-9, \"mostLikely\": 1-9, \"reasoning\": \"string\"},",
  "  \"reconciliation\": \"string — how the user TRL, S1, S2 and the S-curve stage agree or disagree\"",
  "}",
];
export const buildTrlAssessorPrompt = definePrompt(
  {
    id: 'extractor.trl',
    kind: 'extractor',
    enforcedBy: ['L1', 'L2', 'L3'],
    invariants: 'data',
    maxChars: 7000,
    requiredSections: ['### Evidence type criteria', '### Method', '## Output Contract'],
    jsonKeys: ['s1TRL', 'level', 'title', 'description', 'evidence', 'confidence', 'reasoning', 'isUserProvided', 's2TRLRange', 'min', 'max', 'mostLikely', 'reconciliation', 'source', 'trlLevelSupported', 'snippet'],
    sampleArgs: ['', 'TRL 1: Basic research — Keywords: paper, principle\nTRL 9: Proven — Keywords: mission, commercial'],
    namesTools: ['websearch'],
    usedBy: 'src/bos/infrastructure/triz/trl_assessor.ts — Validation phase',
  },
  (langPrefix: string, criteriaSummary: string) =>
    composePrompt({
      role: langPrefix + 'You are Research Master — a Technology Readiness Level (TRL) assessment expert using the NASA/DoD 1-9 scale inside the 7-phase TRIZ pipeline (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution). You prioritise importance-weighted KPIs, score evidence, surface decision factors, and produce copy-ready JSON artifacts.',
      mission: 'Place the technology on the TRL scale with evidence a reviewer can audit, and expose any disagreement between sources instead of averaging it away.',
      body: TRL_BODY.concat([criteriaSummary], TRL_METHOD).join('\n'),
      outputContract: TRL_OUTPUT.join('\n'),
      invariants: 'data',
    }),
);

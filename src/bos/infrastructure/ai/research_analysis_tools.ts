import { Agent, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { streamAgent, StreamingCallbacks } from '../ai/streaming.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt } from '../../domain/shared/i18n.js';

const RESEARCH_TOOLS_SYSTEM_PROMPT = `You are a TRIZ research analysis specialist. You can use available tools (search, file read/write, TRIZ matrix lookup, etc.) to gather information autonomously, then synthesize results into structured JSON.

When called with a "Function:" header, you should:
1. Use tools as needed to search for data, read prior phase outputs, or look up TRIZ parameters
2. Once you have enough context, produce the requested analysis
3. Return ONLY valid JSON matching the requested schema — no markdown, no explanation, no preamble around the JSON

If the prompt contains full context inline (search results, prior phase data), you may answer directly without tool calls. If you need more information, use the tools available to you.

Available analysis functions:
1. analyze_prior_art — Analyze a patent/paper/tech solution for TRIZ relevance
2. compare_approaches — Compare multiple technical approaches and their trade-offs
3. assess_maturity — Assess TRL, S-curve stage, and technology lifecycle
4. identify_bottlenecks — Identify technology bottlenecks and their TRIZ contradictions
5. forecast_trends — Forecast technology trends and disruptive threats
6. generate_solutions — Generate concrete technical solutions from contradictions
7. generate_report — Generate a structured research report from all analysis data
8. unified_research_analysis — Single-pass TRIZ analysis: contradictions + bottlenecks + root causes
9. generate_innovative_solutions — Generate solutions from contradictions + principles + cross-phase context
10. generate_init_doc — Generate research question and methodology plan for a topic
11. generate_integrated_report — Generate final integrated report from all prior phase outputs
12. screen_relevance — Score multiple search results for relevance to research topic
13. extract_contradictions — Extract TRIZ contradictions from search results with parameter mapping
14. identify_bottlenecks — Identify technology bottlenecks given contradictions
15. analyze_root_causes — Analyze root causes using 5-Why methodology`;

export interface ScreenRelevanceInput {
  technologyName: string;
  problemDescription: string;
  results: Array<{
    title: string;
    snippet: string;
    sourceType: string;
    url: string;
    publishedDate?: string;
  }>;
}

export interface ScreenRelevanceResult {
  screened: Array<{
    url: string;
    title: string;
    relevanceScore: number; // 0-1
    inclusionDecision: 'include' | 'borderline' | 'exclude';
    reason: string;
  }>;
}

export interface AnalyzePriorArtInput {
  title: string;
  abstract: string;
  sourceType: string;
  problemDescription: string;
}

export interface CompareApproachesInput {
  approaches: Array<{
    title: string;
    summary: string;
    improvingParameter: string;
    worseningParameter: string;
    trizPrinciples: Array<{ index: number; name: string }>;
    technologyApproach: string;
  }>;
  problemDescription: string;
}

export interface AssessMaturityInput {
  technologyName: string;
  searchResults: Array<{
    title: string;
    abstract: string;
    publishedDate: string;
  }>;
  problemDescription: string;
}

export interface IdentifyBottlenecksInput {
  technologyName: string;
  searchResults: Array<{ title: string; abstract: string }>;
  problemDescription: string;
  currentTRL: number;
  currentSCurveStage: string;
}

export interface ForecastTrendsInput {
  technologyName: string;
  searchResults: Array<{ title: string; abstract: string; publishedDate: string }>;
  bottlenecks: Array<{ name: string; severity: string }>;
  currentSCurveStage: string;
  problemDescription: string;
}

export class ResearchAnalysisTools {
  private agent: Agent | null = null;
  private brain: BrainOS | null = null;
  private locale: LocaleConfig;

  constructor(brain: BrainOS, locale?: LocaleConfig) {
    this.brain = brain;
    this.locale = locale || DEFAULT_LOCALE;
  }

  async initialize(): Promise<void> {
    if (this.agent) return; // already initialized

    if (!this.brain) {
      this.brain = new BrainOS();
      await this.brain.start();
    }

    const langPrefix = this.locale.language === 'zh'
      ? '【中文模式】你必须用中文进行所有思考、推理和输出。\n\n'
      : '';

    // Reuse existing factory if available — composeRoot() or worker.ts
    // already initialized it with tools/hooks/MCP. If not, fall back.
    let factory: ReturnType<typeof getAgentFactory>;
    try {
      factory = getAgentFactory();
    } catch {
      initAgentFactory(this.brain);
      factory = getAgentFactory();
    }

    // No extra tools/config — factory.create() merges defaults (tools,
    // hooks, MCP, skills, plugins) automatically.  The agent now inherits
    // everything registered via initAgentFactory().
    const builder = factory.create({
      name: 'triz-research-analysis-tools',
      systemPrompt: `${langPrefix}${RESEARCH_TOOLS_SYSTEM_PROMPT}`,
      temperature: 0.2,
    });

    this.agent = await builder.start();
  }

  private async streamWithCallbacks(
    prompt: string,
    streamingCallbacks?: StreamingCallbacks,
  ): Promise<string> {
    return streamAgent(this.agent!, prompt, {
      ...(streamingCallbacks || {}),
      onError: (err) => {
        console.error(`[ResearchAnalysisTools] AI error: ${err.message}`);
        if (streamingCallbacks?.onError) streamingCallbacks.onError(err);
      },
    });
  }

  async analyzePriorArt(input: AnalyzePriorArtInput): Promise<any> {
    const prompt = `Function: analyze_prior_art

Analyze this ${input.sourceType} for TRIZ relevance.

Problem: ${input.problemDescription}

Title: ${input.title}
Abstract: ${input.abstract || '(No abstract available — analyze based on title only and note the limitation)'}

Return ONLY JSON:
{
  "relevant": true/false,
  "relevanceScore": 0-1,
  "improvingParameter": "TRIZ parameter being improved (from the 39 parameters)",
  "worseningParameter": "TRIZ parameter being worsened",
  "trizPrinciples": [{"index": number, "name": "principle name", "application": "how this principle is applied"}],
  "summary": "2-3 sentence summary of the technical solution",
  "keyFindings": ["finding 1", "finding 2"],
  "technologyApproach": "the technical approach used",
  "limitations": "limitations of this approach"
}

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseJson(response);
  }

  async compareApproaches(input: CompareApproachesInput): Promise<any> {
    const approachesText = input.approaches.map((a, i) =>
      `${i + 1}. ${a.title}
         Approach: ${a.technologyApproach}
         Improves: ${a.improvingParameter} | Worsens: ${a.worseningParameter}
         TRIZ Principles: ${a.trizPrinciples.map(p => `#${p.index} ${p.name}`).join(', ')}
         Summary: ${a.summary}`
    ).join('\n\n');

    const prompt = `Function: compare_approaches

Compare these approaches for solving: ${input.problemDescription}

${approachesText}

Return ONLY JSON:
{
  "comparisonMatrix": [
    {
      "approach": "approach name",
      "strengths": ["strength 1", "strength 2"],
      "weaknesses": ["weakness 1"],
      "maturity": "early|growth|mature",
      "tradeOff": "core trade-off description",
      "bestFor": "scenario this approach is best suited for"
    }
  ],
  "recommendedApproach": "top recommendation with reasoning",
  "complementaryApproaches": ["approaches that could be combined"]
}

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseJson(response);
  }

  async assessMaturity(input: AssessMaturityInput, streamingCallbacks?: StreamingCallbacks): Promise<any> {
    const resultsText = input.searchResults.map(r =>
      `Title: ${r.title}\nAbstract: ${r.abstract}\nDate: ${r.publishedDate}`
    ).join('\n\n');

    const prompt = `Function: assess_maturity

Assess technology maturity for: ${input.technologyName}
Context: ${input.problemDescription}

Search results:
${resultsText || 'No search results available. Provide your best assessment based on domain knowledge, noting the uncertainty.'}

Return ONLY JSON:
{
  "trl": {"level": 1-9, "title": "TRL title", "confidence": 0-1, "reasoning": "why this TRL level"},
  "sCurveStage": "infancy|growth|maturity|decline",
  "maturityIndicators": [{"signal": "e.g., commercial product exists", "evidence": "specific evidence from search results"}],
  "technologyLifecycle": {
    "inventionYear": number or null,
    "growthStartYear": number or null,
    "maturityStartYear": number or null
  },
  "keyMilestones": [{"year": number, "event": "specific milestone with evidence"}]
}

${getLanguagePrompt(this.locale.language)}`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      return this.parseJson(response);
    } catch {
      return { trl: { level: 5, title: 'Unknown', confidence: 0.3, reasoning: 'Assessment failed' }, sCurveStage: 'unknown', maturityIndicators: [], keyMilestones: [] };
    }
  }

  async identifyBottlenecks(input: IdentifyBottlenecksInput): Promise<any> {
    const resultsText = input.searchResults.map(r =>
      `Title: ${r.title}\nAbstract: ${r.abstract}`
    ).join('\n\n');

    const prompt = `Function: identify_bottlenecks

Identify technology bottlenecks for: ${input.technologyName}
Context: ${input.problemDescription}
Current TRL: ${input.currentTRL}
Current S-Curve: ${input.currentSCurveStage}

Search results:
${resultsText || 'No search results available.'}

Return ONLY JSON:
{
  "bottlenecks": [
    {
      "name": "bottleneck name",
      "severity": "critical|major|moderate",
      "description": "detailed description",
      "impactOn": "performance|cost|safety|manufacturing",
      "currentSolutions": ["existing approach 1"],
      "unresolvedAspects": ["what is still unsolved"],
      "trizContradiction": {"improving": "parameter", "worsening": "parameter"}
    }
  ],
  "prioritization": "rationale for bottleneck priority ordering"
}

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseJson(response);
  }

  async forecastTrends(input: ForecastTrendsInput): Promise<any> {
    const resultsText = input.searchResults.map(r =>
      `[${r.publishedDate}] ${r.title}: ${r.abstract}`
    ).join('\n\n');

    const bottlenecksText = input.bottlenecks.map(b => `${b.name} (${b.severity})`).join(', ');

    const prompt = `Function: forecast_trends

Forecast technology trends for: ${input.technologyName}
Context: ${input.problemDescription}
Current S-Curve: ${input.currentSCurveStage}
Known bottlenecks: ${bottlenecksText}

Search results:
${resultsText || 'No search results available.'}

Return ONLY JSON:
{
  "trends": [
    {
      "trend": "trend description",
      "direction": "rising|declining|stable|emerging",
      "confidence": 0-1,
      "timeHorizon": "short (1-2yr)|medium (3-5yr)|long (5yr+)",
      "drivingFactors": ["factor 1"],
      "evidence": ["specific evidence from search results"]
    }
  ],
  "convergencePoint": "where technologies are converging",
  "disruptiveThreats": ["potential disruption 1"],
  "recommendations": ["actionable recommendation 1"]
}

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseJson(response);
  }

  private parseJson(response: string): any {
    // Strategy 1: extract from ```json``` code blocks
    try {
      const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) return JSON.parse(codeBlockMatch[1]!.trim());
    } catch {}

    // Strategy 2: find {..} via regex
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]!);
    } catch {}

    // Strategy 3: find outermost {..} via indexOf
    try {
      const braceStart = response.indexOf('{');
      const braceEnd = response.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        return JSON.parse(response.slice(braceStart, braceEnd + 1));
      }
    } catch {}

    // Strategy 4: auto-close truncated JSON
    try {
      const braceStart = response.indexOf('{');
      if (braceStart >= 0) {
        const candidate = response.slice(braceStart);
        let inString = false;
        let escapeNext = false;
        const stack: string[] = [];
        let lastComma = -1;
        let lastStructureColon = -1; // track : before a truncated value
        let stackSnapshotAtComma: string[] = [];
        let stackSnapshotAtColon: string[] = [];

        for (let i = 0; i < candidate.length; i++) {
          const ch = candidate[i]!;
          if (escapeNext) { escapeNext = false; continue; }
          if (ch === '\\') { escapeNext = true; continue; }
          if (ch === '"' && !escapeNext) { inString = !inString; continue; }
          if (inString) continue;
          if (ch === ',') {
            lastComma = i;
            stackSnapshotAtComma = [...stack];
          }
          if (ch === ':') {
            lastStructureColon = i;
            stackSnapshotAtColon = [...stack];
          }
          if (ch === '{') stack.push('}');
          else if (ch === '[') stack.push(']');
          else if (ch === '}' || ch === ']') {
            if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
          }
        }

        if (inString) {
          if (lastComma >= 0) {
            return JSON.parse(candidate.slice(0, lastComma) + stackSnapshotAtComma.reverse().join(''));
          }
          if (lastStructureColon >= 0) {
            return JSON.parse(candidate.slice(0, lastStructureColon) + stackSnapshotAtColon.reverse().join(''));
          }
        }

        const repaired = candidate + stack.reverse().join('');
        return JSON.parse(repaired);
      }
    } catch {}

    return { error: 'Failed to parse analysis response', raw: response.slice(0, 200) };
  }

  async generateSolutions(input: {
    contradictions: any[];
    bottlenecks: any[];
    problemDescription: string;
    technologyName: string;
  }): Promise<any> {
    const contradictionsText = input.contradictions.map((c, i) =>
      `${i + 1}. ${c.summary || 'No summary'}
         Improving: ${c.improvingParameter || '?'} | Worsening: ${c.worseningParameter || '?'}
         Principles: ${c.trizPrinciples?.map((p: any) => `#${p.index} ${p.name}`).join(', ') || 'N/A'}
         Approach: ${c.technologyApproach || 'N/A'}`
    ).join('\n\n');

    const bottlenecksText = input.bottlenecks?.map((b: any) =>
      `${b.name} (${b.severity}): ${b.description}`
    ).join('\n') || 'None identified';

    const prompt = `Function: generate_solutions

Generate concrete technical solutions for: ${input.technologyName}
Problem: ${input.problemDescription}

TRIZ Contradictions identified:
${contradictionsText || 'No contradictions identified.'}

Technology Bottlenecks:
${bottlenecksText}

Return ONLY JSON:
{
  "solutions": [
    {
      "id": "S1",
      "title": "solution name",
      "description": "detailed technical description of the solution",
      "addressedBottleneck": "which bottleneck this solves",
      "addressedContradiction": "which contradiction this resolves",
      "trizPrinciples": ["principle 1", "principle 2"],
      "feasibility": "high|medium|low",
      "impact": "high|medium|low",
      "timeToImplement": "short|medium|long",
      "keyRisks": ["risk 1", "risk 2"],
      "requiredResources": ["resource 1"]
    }
  ],
  "evaluationMatrix": {
    "criteria": ["criteria 1"],
    "ratings": [{"solution": "S1", "score": 0-5, "notes": "rationale"}]
  },
  "recommendedPath": "recommended implementation roadmap"
}

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseJson(response);
  }

  async generateReport(input: {
    technologyName: string;
    problemDescription: string;
    surveySummary: string;
    trlAssessment: any;
    contradictions: any[];
    bottlenecks: any;
    comparison: any;
    trends: any;
    solutions: any;
  }): Promise<any> {
    const contradictionsCount = input.contradictions?.length || 0;
    const bottlenecksCount = input.bottlenecks?.bottlenecks?.length || 0;
    const solutionsCount = input.solutions?.solutions?.length || 0;
    const trendsCount = input.trends?.trends?.length || 0;

    const prompt = `Function: generate_report

Generate a comprehensive research report for: ${input.technologyName}
Problem: ${input.problemDescription}

Phase outputs summary:
- Survey: ${input.surveySummary}
- TRL: ${JSON.stringify(input.trlAssessment || {})}
- Contradictions found: ${contradictionsCount}
- Bottlenecks found: ${bottlenecksCount}
- Solutions proposed: ${solutionsCount}
- Trends identified: ${trendsCount}

Approach comparison: ${JSON.stringify(input.comparison || {})}
Trends: ${JSON.stringify(input.trends || {})}
Solutions: ${JSON.stringify(input.solutions || {})}

Return ONLY JSON:
{
  "title": "report title",
  "executiveSummary": "3-5 paragraph executive summary covering problem, methodology, key findings, and recommendations",
  "sections": [
    {
      "title": "section title",
      "content": "detailed section content with analysis and evidence",
      "keyFindings": ["finding 1", "finding 2"],
      "evidence": ["evidence 1"]
    }
  ],
  "recommendations": [
    {"priority": "high|medium|low", "action": "recommended action", "rationale": "why this matters"}
  ],
  "conclusion": "concluding remarks",
  "nextSteps": ["step 1", "step 2"]
}

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseJson(response);
  }

  async extractKeywords(problem: string, amendments?: string, streamingCallbacks?: StreamingCallbacks): Promise<{ en: string; zh: string }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return this.fallbackExtractKeywords(problem);

    const amendCtx = amendments ? `\n\nAdditional context from researcher:\n${amendments}` : '';

    const prompt = `Extract search keywords for scientific paper and patent databases from this research topic.

Topic: ${problem}${amendCtx}

Return ONLY JSON:
{
  "en": "3-5 English keywords separated by commas, using standard scientific terminology, mix broad and specific terms",
  "zh": "3-5 Chinese keywords separated by commas, using standard technical terminology"
}

No markdown, no explanation.`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = JSON.parse(response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      const en = parsed.en || '';
      const zh = parsed.zh || '';
      if (!en && !zh) return this.fallbackExtractKeywords(problem);
      return { en, zh };
    } catch {
      return this.fallbackExtractKeywords(problem);
    }
  }

  async suggestBetterKeywords(problem: string, currentKeywords: string, searchResultsSummary: string, streamingCallbacks?: StreamingCallbacks): Promise<string> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return currentKeywords;

    const prompt = `The following keywords returned poor search results. Suggest better bilingual keywords.

Research topic: ${problem}
Previous keywords: ${currentKeywords}
Search results: ${searchResultsSummary}

Return ONLY JSON:
{
  "en": "3-5 improved English keywords",
  "zh": "3-5 improved Chinese keywords"
}

No explanation.`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = JSON.parse(response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      return [parsed.en, parsed.zh].filter(Boolean).join(', ') || currentKeywords;
    } catch {
      return currentKeywords;
    }
  }

  private fallbackExtractKeywords(problem: string): { en: string; zh: string } {
    const words = problem.split(/[\s,，、]+/).filter(w => w.length > 1).slice(0, 5);
    const joined = words.join(', ');
    return { en: joined, zh: joined };
  }

  async generateInitDoc(problem: string, amendments?: string, streamingCallbacks?: StreamingCallbacks): Promise<{
    researchQuestion: string;
    methodologyPlan: string;
  }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return this.fallbackInitDoc(problem);

    const amendCtx = amendments ? `\n\nResearcher's additional context:\n${amendments}` : '';

    const prompt = `Function: generate_init_doc

Generate the research plan for the following topic.

Topic: ${problem}${amendCtx}

Return ONLY JSON with these fields:
{
  "researchQuestion": "Full research question document in markdown with sections: # Research Question (the question itself), ## Context (background, why this matters), ## Scope (boundaries, what's in/out), ## Success Criteria (measurable outcomes)",
  "methodologyPlan": "Methodology plan in markdown with sections: # Methodology Plan, ## Phases (numbered approach), ## Methods (specific research methods), ## Tools & Data Sources"
}

The research question document should be thorough and well-structured. Write in the same language as the problem description.`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = JSON.parse(response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      return {
        researchQuestion: parsed.researchQuestion || this.fallbackInitDoc(problem).researchQuestion,
        methodologyPlan: parsed.methodologyPlan || this.fallbackInitDoc(problem).methodologyPlan,
      };
    } catch {
      return this.fallbackInitDoc(problem);
    }
  }

  private fallbackInitDoc(problem: string): { researchQuestion: string; methodologyPlan: string } {
    return {
      researchQuestion: [
        `# Research Question\n\n${problem}\n`,
        `\n## Context\n\n(Define the background — why this topic matters, what's the current state of the field)`,
        `\n## Scope\n\n(Define boundaries — what aspects are included, what is excluded)`,
        `\n## Success Criteria\n\n(How to evaluate success — measurable outcomes and deliverables)\n`,
      ].join(''),
      methodologyPlan: [
        '# Methodology Plan\n\n## Phases\n',
        '1. Survey — literature and patent search\n',
        '2. TRL Assessment — technology maturity evaluation\n',
        '3. Analyze — TRIZ contradiction, bottleneck analysis\n',
        '4. Synthesize — solution generation, comparison, roadmap\n',
        '5. Deliver — report generation\n',
      ].join(''),
    };
  }

  async classifyTrpIntent(input: string, hasProject: boolean, projectState: any, streamingCallbacks?: StreamingCallbacks): Promise<{
    intent: 'init' | 'amend' | 'resume' | 'status';
    targetPhase?: string;
    amendment?: string;
    confirmation?: string;
  }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return this.fallbackClassify(input, hasProject, projectState);

    const phaseSummary = hasProject && projectState
      ? projectState.phases.map((p: any) => `${p.id} (${p.status}, ${p.completion}%)`).join(', ')
      : 'none';

    const prompt = `Classify this user input for a TRIZ research project command.

User input: "${input}"

Project state: ${hasProject ? `Project exists: ${projectState?.problem}\nPhases: ${phaseSummary}` : 'No project exists (never initialized)'}

Rules:
- If no project exists → intent: "init"
- If input looks like adding information, supplementing, or refining → intent: "amend". Determine the target phase from context. If unclear, default to the first unfinished phase.
- If input looks like checking progress, viewing status, asking "what's next" → intent: "status"
- If input is empty or just "go", "continue", "next" → intent: "resume"

Return ONLY JSON:
{
  "intent": "init|amend|resume|status",
  "targetPhase": "01_Survey|02_TRL|03_Analyze|04_Synthesize|05_Deliver|null",
  "amendment": "summarized amendment text to save (for amend only)",
  "confirmation": "brief Chinese confirmation message showing what will be done (for amend/init)"
}`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = JSON.parse(response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      return {
        intent: parsed.intent || 'status',
        targetPhase: parsed.targetPhase || null,
        amendment: parsed.amendment || input,
        confirmation: parsed.confirmation || '',
      };
    } catch {
      return this.fallbackClassify(input, hasProject, projectState);
    }
  }

  private fallbackClassify(input: string, hasProject: boolean, _projectState: any): {
    intent: 'init' | 'amend' | 'resume' | 'status';
    targetPhase?: string;
    amendment?: string;
    confirmation?: string;
  } {
    if (!hasProject) return { intent: 'init', amendment: input, confirmation: `创建新研究项目：${input}` };
    if (!input || input === 'continue' || input === 'next' || input === 'go') {
      return { intent: 'resume', confirmation: '继续执行下一阶段' };
    }
    if (input.includes('进度') || input.includes('状态') || input.includes('status')) {
      return { intent: 'status', confirmation: '查看项目进度' };
    }
    return { intent: 'amend', amendment: input, confirmation: `补充内容并重新执行相关阶段` };
  }

  async analyzeWithContext(input: {
    problemDescription: string;
    technologyName: string;
    searchResults: Array<{ title: string; abstract: string; sourceType: string; publishedDate?: string }>;
    trlLevel?: number;
    sCurveStage?: string;
    amendments?: string;
  }, streamingCallbacks?: StreamingCallbacks): Promise<{
    contradictions: any[];
    bottlenecks: any[];
    rootCauses: any[];
    analysisSummary: string;
  }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return { contradictions: [], bottlenecks: [], rootCauses: [], analysisSummary: '' };

    const searchText = input.searchResults.slice(0, 20).map(r =>
      `- [${r.sourceType}] ${r.title}${r.abstract ? `: ${r.abstract.slice(0, 300)}` : ''}`
    ).join('\n');

    const amendCtx = input.amendments ? `\n\nAdditional context:\n${input.amendments}` : '';

    const prompt = `Function: unified_research_analysis

Perform a comprehensive TRIZ analysis of the following technology based on search results and context.

Problem: ${input.problemDescription}
Technology: ${input.technologyName}
TRL Level: ${input.trlLevel || 'unknown'}
S-Curve Stage: ${input.sCurveStage || 'unknown'}${amendCtx}

Search Results:
${searchText || 'No search results available'}

Return ONLY JSON:
{
  "contradictions": [
    {
      "relevant": true,
      "relevanceScore": 0.9,
      "improvingParameter": "TRIZ parameter 1-39 being improved",
      "worseningParameter": "TRIZ parameter 1-39 being worsened",
      "contradictionId": "contradiction type",
      "principles": [{"index": 1, "name": "segmentation"}],
      "summary": "summary of the contradiction",
      "technologyApproach": "current approach description",
      "limitations": "key limitations"
    }
  ],
  "bottlenecks": [
    {
      "name": "bottleneck name",
      "severity": "critical|major|moderate",
      "description": "detailed description",
      "impactArea": "Performance|Cost|Safety|Manufacturability|Sustainability",
      "currentSolutions": "existing approaches",
      "unresolvedAspect": "what's still unsolved",
      "linkedContradictions": ["reference to contradiction summaries"]
    }
  ],
  "rootCauses": [
    {
      "cause": "root cause description",
      "chainOfEffects": ["A → B → C"],
      "affectedBottlenecks": ["bottleneck name"],
      "triztools": ["Function Analysis", "Causal Chain Analysis", "Substance-Field"]
    }
  ],
  "analysisSummary": "3-5 paragraph structured summary of key findings across contradictions, bottlenecks, and root causes"
}

${getLanguagePrompt(this.locale.language)}`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = JSON.parse(response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      return {
        contradictions: parsed.contradictions || [],
        bottlenecks: parsed.bottlenecks || [],
        rootCauses: parsed.rootCauses || [],
        analysisSummary: parsed.analysisSummary || '',
      };
    } catch {
      return { contradictions: [], bottlenecks: [], rootCauses: [], analysisSummary: '' };
    }
  }

  async extractContradictions(input: {
    problemDescription: string;
    technologyName: string;
    searchResults: Array<{ title: string; abstract: string; sourceType: string; publishedDate?: string }>;
    trlLevel?: number;
    sCurveStage?: string;
  }, streamingCallbacks?: StreamingCallbacks): Promise<{
    contradictions: any[];
  }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return { contradictions: [] };

    const searchText = input.searchResults.slice(0, 25).map(r =>
      `- [${r.sourceType}] "${r.title}"${r.abstract ? ` — ${r.abstract.slice(0, 400)}` : ''}${r.publishedDate ? ` (${r.publishedDate})` : ''}`
    ).join('\n');

    const prompt = `Function: extract_contradictions

Extract technical contradictions from the following search results. Focus on identifying WHERE an improvement of one engineering parameter causes worsening of another.

Problem: ${input.problemDescription}
Technology: ${input.technologyName}
TRL: ${input.trlLevel || 'unknown'}  |  S-Curve: ${input.sCurveStage || 'unknown'}

Search Results:
${searchText || 'None available'}

For each search result, identify the primary technical contradiction — what is being improved and what gets worse as a result. Map both parameters to the TRIZ 39 engineering parameters by name AND index number.

Available TRIZ parameters: 1-Weight of moving object, 2-Weight of stationary, 3-Length of moving, 4-Length of stationary, 5-Area of moving, 6-Area of stationary, 7-Volume of moving, 8-Volume of stationary, 9-Speed, 10-Force, 11-Stress/pressure, 12-Shape, 13-Stability, 14-Strength, 15-Durability of moving, 16-Durability of stationary, 17-Temperature, 18-Brightness, 19-Energy spent by moving, 20-Energy spent by stationary, 21-Power, 22-Loss of energy, 23-Loss of substance, 24-Loss of information, 25-Loss of time, 26-Amount of substance, 27-Reliability, 28-Measurement accuracy, 29-Manufacturing precision, 30-External harm, 31-Object-generated harmful factors, 32-Ease of manufacturing, 33-Ease of operation, 34-Ease of repair, 35-Adaptability, 36-Device complexity, 37-Difficulty of detection, 38-Degree of automation, 39-Productivity

Return ONLY JSON:
{
  "contradictions": [
    {
      "relevant": true,
      "relevanceScore": 0.85,
      "improvingParameter": "name of parameter being improved",
      "improvingParameterIndex": 9,
      "worseningParameter": "name of parameter being worsened",
      "worseningParameterIndex": 22,
      "contradictionId": "brief type label",
      "principles": [{"index": 35, "name": "Parameter changes", "application": "brief how-to"}],
      "summary": "2-3 sentence summary",
      "sourceTitle": "title of source search result",
      "technologyApproach": "current technical approach",
      "limitations": "key limitations"
    }
  ]
}

${getLanguagePrompt(this.locale.language)}`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = JSON.parse(response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      return { contradictions: parsed.contradictions || [] };
    } catch {
      return { contradictions: [] };
    }
  }

  async identifyBottlenecksWithContext(input: {
    problemDescription: string;
    technologyName: string;
    contradictions: any[];
    trlLevel?: number;
    sCurveStage?: string;
  }, streamingCallbacks?: StreamingCallbacks): Promise<{
    bottlenecks: any[];
    rootCauses: any[];
  }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return { bottlenecks: [], rootCauses: [] };

    const contradictionsText = input.contradictions.slice(0, 15).map((c, i) =>
      `${i + 1}. ${c.summary || ''}\n   Improves: ${c.improvingParameter} (${c.improvingParameterIndex}) | Worsens: ${c.worseningParameter} (${c.worseningParameterIndex})`
    ).join('\n\n');

    const prompt = `Function: identify_bottlenecks

Given the following contradictions, identify the key technology bottlenecks — systemic barriers preventing progress.

Problem: ${input.problemDescription}
Technology: ${input.technologyName}
TRL: ${input.trlLevel || 'unknown'}  |  S-Curve: ${input.sCurveStage || 'unknown'}

Contradictions:
${contradictionsText || 'None identified'}

For each bottleneck, identify its severity, impact area, current solution attempts, and what remains unresolved. Link bottlenecks back to the contradictions that cause them.

For root causes, apply the 5-Why methodology: for each bottleneck, trace the causal chain back to fundamental physical or design limitations.

Return ONLY JSON:
{
  "bottlenecks": [
    {
      "name": "bottleneck name",
      "severity": "critical|major|moderate",
      "description": "detailed description",
      "impactArea": "Performance|Cost|Safety|Manufacturability|Sustainability",
      "currentSolutions": "existing approaches and their limitations",
      "unresolvedAspect": "what remains unsolved and why",
      "linkedContradictions": ["contradiction summary references"]
    }
  ],
  "rootCauses": [
    {
      "cause": "root cause description",
      "chainOfEffects": ["A → B → C → D → E (5-Why trace)"],
      "affectedBottlenecks": ["bottleneck name references"],
      "triztools": ["Function Analysis", "Causal Chain Analysis", "Substance-Field", "5-Why"]
    }
  ]
}

${getLanguagePrompt(this.locale.language)}`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = JSON.parse(response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      return {
        bottlenecks: parsed.bottlenecks || [],
        rootCauses: parsed.rootCauses || [],
      };
    } catch {
      return { bottlenecks: [], rootCauses: [] };
    }
  }

  async analyzeRootCauses(input: {
    problemDescription: string;
    technologyName: string;
    bottlenecks: any[];
    contradictions: any[];
    trlLevel?: number;
    sCurveStage?: string;
  }, streamingCallbacks?: StreamingCallbacks): Promise<{
    rootCauses: any[];
    analysisSummary: string;
  }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return { rootCauses: [], analysisSummary: '' };

    const bottlenecksText = input.bottlenecks.slice(0, 10).map((b, i) =>
      `${i + 1}. ${b.name} (${b.severity}): ${b.description?.slice(0, 200) || ''}`
    ).join('\n');

    const contradictionsCount = input.contradictions.length;

    const prompt = `Function: analyze_root_causes

Perform deep root cause analysis on the following technology bottlenecks using the 5-Why methodology.

Problem: ${input.problemDescription}
Technology: ${input.technologyName}
TRL: ${input.trlLevel || 'unknown'}  |  S-Curve: ${input.sCurveStage || 'unknown'}
Contradictions found: ${contradictionsCount}

Bottlenecks:
${bottlenecksText || 'None identified'}

For each bottleneck, apply the 5-Why technique — ask "why" five times to trace from the symptom to the fundamental physical or design root cause.

Also produce a 3-5 paragraph structured analysis summary that synthesizes the key findings across contradictions, bottlenecks, and root causes.

Return ONLY JSON:
{
  "rootCauses": [
    {
      "cause": "fundamental root cause",
      "chainOfEffects": ["Symptom → Why1 → Why2 → Why3 → Why4 → Why5 (root cause)"],
      "affectedBottlenecks": ["bottleneck names"],
      "triztools": ["Function Analysis", "Causal Chain", "5-Why", "Substance-Field"]
    }
  ],
  "analysisSummary": "3-5 paragraph structured summary synthesizing contradictions, bottlenecks, and root causes with TRIZ connections"
}

${getLanguagePrompt(this.locale.language)}`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = JSON.parse(response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      return {
        rootCauses: parsed.rootCauses || [],
        analysisSummary: parsed.analysisSummary || '',
      };
    } catch {
      return { rootCauses: [], analysisSummary: '' };
    }
  }

  async generateSolutionsWithPrinciples(input: {
    contradictions: Array<{ improvingParameter: any; worseningParameter: any; summary: string; principles?: any[] }>;
    bottlenecks: Array<{ name: string; severity: string; description: string }>;
    rootCauses: Array<{ cause: string; chainOfEffects: string[] }>;
    suFieldData?: Array<{ bottleneck: string; suFieldType: string; diagnosis: string; standardSolutions: string[]; recommendedAction: string }>;
    trlLevel?: number;
    sCurveStage?: string;
    problemDescription: string;
    technologyName: string;
    amendments?: string;
    recommendedPrinciples: Array<{ index: number; name: string; description: string; examples: string[] }>;
  }, streamingCallbacks?: StreamingCallbacks): Promise<{
    solutions: any[];
    comparison: any;
    trends: any;
    roadmap: any;
    _rawResponse: string;
  }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) return { solutions: [], comparison: {}, trends: {}, roadmap: {}, _rawResponse: '' };

    const contradictionsText = input.contradictions.map((c, i) =>
      `${i + 1}. ${c.summary || ''}\n   Improves: ${c.improvingParameter} | Worsens: ${c.worseningParameter}`
    ).join('\n\n');

    const bottlenecksText = input.bottlenecks.map(b =>
      `${b.name} (${b.severity}): ${b.description}`
    ).join('\n');

    const rootCausesText = input.rootCauses.map((r, i) =>
      `${i + 1}. ${r.cause} → ${r.chainOfEffects.join(' → ')}`
    ).join('\n');

    const suFieldText = (input.suFieldData || []).map(s =>
      `• Bottleneck: ${s.bottleneck} [Type: ${s.suFieldType}]\n  Diagnosis: ${s.diagnosis?.slice(0, 300)}\n  Standard Solutions: ${(s.standardSolutions || []).join('; ')}\n  Action: ${s.recommendedAction || ''}`
    ).join('\n\n') || 'None';

    const principlesText = input.recommendedPrinciples.map(p =>
      `#${p.index} ${p.name}: ${p.description}\n  Examples: ${(p.examples || []).slice(0, 3).join('; ')}`
    ).join('\n\n');

    const amendCtx = input.amendments ? `\n\nAdditional context:\n${input.amendments}` : '';

    const prompt = `Function: generate_innovative_solutions

Based on the following TRIZ analysis, generate concrete technical solutions for: ${input.technologyName}

Problem: ${input.problemDescription}
TRL Level: ${input.trlLevel || 'N/A'} | S-Curve Stage: ${input.sCurveStage || 'N/A'}${amendCtx}

=== TRIZ Contradictions ===
${contradictionsText || 'None identified'}

=== Technology Bottlenecks ===
${bottlenecksText || 'None identified'}

=== Root Causes ===
${rootCausesText || 'None identified'}

=== Su-Field Analysis (Critical Bottlenecks) ===
${suFieldText}

=== Recommended TRIZ Principles (from Contradiction Matrix) ===
${principlesText || 'None provided'}

Using the above principles and analysis, generate:

1. SOLUTIONS: For each contradiction and bottleneck, apply the recommended principles to generate concrete solutions.
2. COMPARISON: Compare approaches using a multi-dimensional matrix.
3. TRENDS: Forecast technology evolution trends.
4. ROADMAP: A phased implementation roadmap.

Return ONLY JSON:
{
  "solutions": [
    {
      "id": "S1",
      "title": "solution title",
      "derivedFrom": "which contradiction/bottleneck this addresses",
      "appliedPrinciples": ["principle #35: Parameter Change"],
      "description": "detailed solution description",
      "feasibility": "high|medium|low",
      "impact": "high|medium|low",
      "timeframe": "short|medium|long",
      "advantages": ["advantage 1"],
      "challenges": ["challenge 1"],
      "idealityScore": 0.85
    }
  ],
  "comparison": {
    "dimensions": ["Technical Feasibility", "Commercial Viability", "Performance Impact", "Cost Efficiency", "Risk Level", "Sustainability"],
    "approaches": [
      {
        "name": "approach name",
        "scores": {"Technical Feasibility": 4, "Commercial Viability": 3, "Performance Impact": 5, "Cost Efficiency": 4, "Risk Level": 2, "Sustainability": 4},
        "strengths": ["strength 1"],
        "weaknesses": ["weakness 1"],
        "overallRating": 4.2,
        "recommendation": "primary|alternative|supporting"
      }
    ],
    "synergies": [{"approaches": ["A", "B"], "synergyDescription": "how they complement"}]
  },
  "trends": {
    "trends": [
      {
        "trend": "trend description",
        "direction": "rising|stable|declining|emerging",
        "confidence": 85,
        "horizon": "1-2yr|3-5yr|5yr+",
        "drivers": ["driver 1"],
        "implications": ["implication 1"]
      }
    ],
    "disruptiveThreats": [{"threat": "description", "probability": "high|medium|low", "impact": "description"}],
    "convergencePoints": ["convergence description"]
  },
  "roadmap": {
    "phases": [
      {
        "phase": "Phase 1 (0-1 year)",
        "focus": "focus description",
        "actions": ["action 1"],
        "expectedOutcomes": ["outcome 1"]
      }
    ],
    "criticalPath": ["critical milestone 1"],
    "riskMitigation": [{"risk": "description", "mitigation": "strategy"}]
  }
}

${getLanguagePrompt(this.locale.language)}`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = this.parseJson(response);
      const result = {
        solutions: parsed.solutions || [],
        comparison: parsed.comparison || {},
        trends: parsed.trends || {},
        roadmap: parsed.roadmap || {},
        _rawResponse: response,
      };
      if (parsed.error) {
        return result;
      }
      return result;
    } catch {
      return { solutions: [], comparison: {}, trends: {}, roadmap: {}, _rawResponse: '' };
    }
  }

  async generateIntegratedReport(input: {
    technologyName: string;
    problemDescription: string;
    initDoc?: { researchQuestion: string; methodologyPlan: string };
    surveySummary: string;
    trlAssessment: any;
    sCurveData?: any;
    contradictions: any[];
    bottlenecks: any[];
    rootCauses: any[];
    solutions: any[];
    comparison: any;
    trends: any;
    roadmap: any;
    amendments?: string;
  }, streamingCallbacks?: StreamingCallbacks): Promise<{
    title: string;
    executiveSummary: string;
    sections: Array<{ title: string; content: string; keyFindings?: string[] }>;
    recommendations: Array<{ priority: string; action: string; rationale: string }>;
    conclusion: string;
    nextSteps: string[];
  }> {
    if (!this.agent) await this.initialize();
    if (!this.agent) {
      return {
        title: `${input.technologyName} — Research Report`,
        executiveSummary: 'AI agent not available.',
        sections: [],
        recommendations: [],
        conclusion: '',
        nextSteps: [],
      };
    }

    const amendCtx = input.amendments ? `\n\nAdditional context:\n${input.amendments}` : '';

    const contradictionsText = (input.contradictions || []).map((c: any, i: number) =>
      `${i + 1}. ${c.summary || c.contradictionId || ''}
   Improves: ${c.improvingParameter || 'N/A'} (Index: ${c.improvingParameterIndex || '?'})
   Worsens: ${c.worseningParameter || 'N/A'} (Index: ${c.worseningParameterIndex || '?'})
   Relevance: ${c.relevanceScore ?? 'N/A'}
   ${c.matrixValidated ? `Matrix validated: ${(c.recommendedPrinciples || []).join(', ')}` : ''}
   ${c.limitations ? `Limitations: ${String(c.limitations).slice(0, 300)}` : ''}`
    ).join('\n\n') || 'None identified';

    const bottlenecksText = (input.bottlenecks || []).map((b: any) =>
      `• ${b.name} [${b.severity || 'unknown'} severity, Impact: ${b.impactArea || 'N/A'}]
   ${String(b.description || '').slice(0, 400)}
   ${b.currentSolutions ? `Current solutions: ${String(b.currentSolutions).slice(0, 300)}` : ''}
   ${b.unresolvedAspect ? `Unresolved: ${String(b.unresolvedAspect).slice(0, 300)}` : ''}`
    ).join('\n\n') || 'None identified';

    const rootCausesText = (input.rootCauses || []).map((r: any, i: number) =>
      `${i + 1}. Root Cause: ${String(r.cause || '').slice(0, 500)}
   Chain: ${(r.chainOfEffects || []).join(' → ').slice(0, 500)}
   Affects: ${(r.affectedBottlenecks || []).join(', ')}`
    ).join('\n\n') || 'None identified';

    const solutionsText = (input.solutions || []).map((s: any, i: number) =>
      `${i + 1}. ${s.title || s.id || 'Solution'} [Feasibility: ${s.feasibility || 'N/A'}, Impact: ${s.impact || 'N/A'}, Timeframe: ${s.timeframe || 'N/A'}, Ideality: ${s.idealityScore ?? 'N/A'}]
   ${String(s.description || '').slice(0, 400)}
   ${s.derivedFrom ? `Derived from: ${s.derivedFrom}` : ''}
   ${s.appliedPrinciples ? `Principles: ${(s.appliedPrinciples || []).join(', ')}` : ''}
   ${s.advantages?.length ? `Advantages: ${s.advantages.join('; ').slice(0, 300)}` : ''}
   ${s.challenges?.length ? `Challenges: ${s.challenges.join('; ').slice(0, 300)}` : ''}`
    ).join('\n\n') || 'None identified';

    const prompt = `Function: generate_integrated_report

Generate a comprehensive integrated research report for: ${input.technologyName}

Problem: ${input.problemDescription}
Init Doc: ${input.initDoc ? JSON.stringify(input.initDoc).slice(0, 1000) : 'N/A'}
Survey: ${input.surveySummary}

=== TRL Assessment ===
${JSON.stringify(input.trlAssessment || {}).slice(0, 1500)}

=== S-Curve Analysis ===
${JSON.stringify(input.sCurveData || {}).slice(0, 1500)}

=== TRIZ Contradictions ===
${contradictionsText}

=== Technology Bottlenecks ===
${bottlenecksText}

=== Root Cause Analysis ===
${rootCausesText}

=== Innovation Solutions ===
${solutionsText}

=== Technology Comparison ===
${JSON.stringify(input.comparison || {}).slice(0, 2000)}

=== Technology Trends ===
${JSON.stringify(input.trends || {}).slice(0, 2000)}

=== Implementation Roadmap ===
${JSON.stringify(input.roadmap || {}).slice(0, 2000)}${amendCtx}

Generate a structured, professional research report with these sections: Introduction, Literature Review, Technology Maturity Assessment, Contradiction & Bottleneck Analysis, Innovation Solutions, Technology Trends & Roadmap, Recommendations, Conclusion.

Return ONLY JSON:
{
  "title": "report title",
  "executiveSummary": "comprehensive 3-5 paragraph executive summary with key findings",
  "sections": [
    {"title": "Introduction", "content": "full section content with data from init doc", "keyFindings": ["finding 1"]},
    {"title": "Literature Review", "content": "review of search results", "keyFindings": ["finding 1"]},
    {"title": "TRL & Technology Maturity", "content": "analysis of maturity", "keyFindings": ["finding 1"]},
    {"title": "Contradiction & Bottleneck Analysis", "content": "analysis of contradictions and bottlenecks with root causes", "keyFindings": ["finding 1"]},
    {"title": "Innovation Solutions", "content": "detailed solution descriptions with TRIZ principle derivation", "keyFindings": ["finding 1"]},
    {"title": "Technology Trends & Roadmap", "content": "trends and implementation roadmap", "keyFindings": ["finding 1"]}
  ],
  "recommendations": [
    {"priority": "high|medium|low", "action": "specific action", "rationale": "why"}
  ],
  "conclusion": "concluding summary",
  "nextSteps": ["step 1", "step 2"]
}

${getLanguagePrompt(this.locale.language)}`;

    try {
      const response = await this.streamWithCallbacks(prompt, streamingCallbacks);
      const parsed = this.parseJson(response);
      return {
        title: parsed.title || `${input.technologyName} — Research Report`,
        executiveSummary: parsed.executiveSummary || '',
        sections: parsed.sections || [],
        recommendations: parsed.recommendations || [],
        conclusion: parsed.conclusion || '',
        nextSteps: parsed.nextSteps || [],
      };
    } catch {
      return {
        title: `${input.technologyName} — Research Report`,
        executiveSummary: 'Report generation failed.',
        sections: [],
        recommendations: [],
        conclusion: '',
        nextSteps: [],
      };
    }
  }

  async screenRelevance(input: ScreenRelevanceInput): Promise<ScreenRelevanceResult> {
    if (!this.agent) await this.initialize();
    if (!this.agent) {
      return {
        screened: input.results.map(r => ({
          url: r.url,
          title: r.title,
          relevanceScore: 0.5,
          inclusionDecision: 'borderline' as const,
          reason: 'AI agent not available — manual review needed',
        })),
      };
    }

    const resultTexts = input.results.map((r, i) =>
      `${i + 1}. "${r.title}" [${r.sourceType}] — ${r.snippet?.slice(0, 300) || 'No abstract'}`
    ).join('\n');

    const prompt = `Function: screen_relevance

Screen the following ${input.results.length} search results for relevance to research topic: "${input.problemDescription}" (technology: ${input.technologyName})

Results to screen:
${resultTexts}

For each result, assign:
- relevanceScore: 0.0-1.0 (how directly relevant to the topic)
- inclusionDecision: "include" (score >= 0.7), "borderline" (0.4-0.7), "exclude" (< 0.4)
- reason: 1-sentence explanation of why

Scoring criteria:
- 0.8-1.0: Directly about the technology, provides substantial technical detail
- 0.5-0.8: Related domain, partially applicable techniques
- 0.3-0.5: Adjacent technology with tangential relevance
- 0.0-0.3: Unrelated or noise

Return ONLY JSON:
{
  "screened": [
    {"url": "...", "title": "...", "relevanceScore": 0.85, "inclusionDecision": "include", "reason": "..."},
    ...
  ]
}

${getLanguagePrompt(this.locale.language)}`;

    try {
      const response = await this.streamWithCallbacks(prompt);
      const parsed = this.parseJson(response);
      return {
        screened: (parsed.screened || []).map((s: any) => ({
          url: s.url || '',
          title: s.title || '',
          relevanceScore: typeof s.relevanceScore === 'number' ? s.relevanceScore : 0.5,
          inclusionDecision: s.inclusionDecision || 'borderline',
          reason: s.reason || '',
        })),
      };
    } catch {
      return {
        screened: input.results.map(r => ({
          url: r.url,
          title: r.title,
          relevanceScore: 0.5,
          inclusionDecision: 'borderline' as const,
          reason: 'Screening failed — manual review needed',
        })),
      };
    }
  }

  async close(): Promise<void> {
    if (this.agent) {
      await this.agent.close();
      this.agent = null;
    }
  }
}
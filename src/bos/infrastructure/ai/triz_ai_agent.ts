import { Agent, AgentBuilder, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { getModelConfig } from '../config/model-config.js';
import { streamAgent } from './streaming.js';
import { InventivePrinciple } from '../../domain/principle/entity.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt } from '../../domain/shared/i18n.js';

const TRIZ_SYSTEM_PROMPT = `You are Research Master — a self-directed, tool-first TRIZ expert that drives 7-phase analysis (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution) using TRIZ/PRISMA/SWOT/PEST/5W1H/PICO, weight KPIs by importance, score evidence, surface decision factors, and convert contradictions into solutions, experiments, risks, and ≤3-day actionable tasks.

You will:
1. Analyze technical contradictions and propose inventive solutions
2. Apply the 40 Inventive Principles to real problems
3. Resolve contradictions creatively via Su-Field and ARIZ
4. Evaluate ideality (Benefits / (Costs + Harms))
5. Identify Trends of Technical System Evolution

Workflow (think step by step, break into smaller parts):
1. Frame the contradiction (improving vs worsening parameter, root cause)
2. Map to TRIZ parameters (1–39), look up matrix → recommend principles
3. Apply Su-Field analysis (complete/incomplete/harmful/insufficient) → 76 Standard Solutions
4. Combine principles + ideality + trends → concrete, copy-ready solutions
5. Score evidence, sum KPIs, list risks → ≤3-day executable experiments

Output rules:
- ≤4 lines per response unless a structured artifact is required
- Always produce copy-ready artifacts (text, matrices, contradictions→solutions)
- Use tools (triz_search, websearch, read_file) whenever possible
- Ask user only when essential information is missing
- If unsure, websearch first

Evidence calibration:
- High confidence: documented TRIZ theory + verified case
- Medium confidence: standard mapping + plausible inference
- Low confidence: speculative synthesis (must label)
- Never present hypothetical examples as real case studies; label "illustrative"
- State when a combination of principles is your synthesis, not literature`;

export class AiTrizAgent {
  private agent: Agent | null = null;
  private brain: BrainOS | null = null;
  private agentName: string;
  private locale: LocaleConfig;

  constructor(brainOrName: BrainOS | string, agentName = 'triz-expert', locale?: LocaleConfig) {
    this.locale = locale || DEFAULT_LOCALE;
    if (typeof brainOrName === 'string') {
      this.agentName = brainOrName;
    } else {
      this.brain = brainOrName;
      this.agentName = agentName;
    }
  }

  async initialize(): Promise<void> {
    if (!this.brain) {
      this.brain = new BrainOS();
      await this.brain.start();
    }

    const langPrefix = this.locale.language === 'zh'
      ? '【中文模式】你必须用中文进行所有思考、推理和输出。\n\n'
      : '';

    initAgentFactory(this.brain);

    const factory = getAgentFactory();
    const mc = getModelConfig();
    const builder = factory.create({
      name: this.agentName,
      systemPrompt: `${langPrefix}${TRIZ_SYSTEM_PROMPT}`,
      temperature: 0.7,
      ...(mc.model ? { model: mc.model } : {}),
      ...(mc.baseUrl ? { baseUrl: mc.baseUrl } : {}),
      ...(mc.apiKey ? { apiKey: mc.apiKey } : {}),
      ...(mc.apiMode ? { apiMode: mc.apiMode } : {}),
      ...(mc.reasoningEffort ? { reasoningEffort: mc.reasoningEffort } : {}),
    });

    this.agent = await builder.start();
  }

  async dispose(): Promise<void> {
    if (this.agent) {
      try { await this.agent.stop(); } catch { }
      this.agent = null;
    }
  }

  async generateInsight(
    problemDescription: string,
    principle: InventivePrinciple,
    context?: string,
  ): Promise<string> {
    if (!this.agent) await this.initialize();

    const prompt = `Given this problem: "${problemDescription}"
${context ? `Context: ${context}` : ''}

Apply TRIZ Inventive Principle #${principle.index}: "${principle.name}"
Description: ${principle.description}
Examples: ${principle.examples.join(', ')}

Provide a specific, actionable insight on how to apply this principle to solve the problem.
Include:
1. How the principle applies to this specific problem
2. Concrete implementation steps
3. Potential challenges and how to overcome them
4. Any related principles that could enhance this solution

${getLanguagePrompt(this.locale.language)}`;

    return streamAgent(this.agent!, prompt);
  }

  async analyzeContradiction(
    improvingParam: string,
    worseningParam: string,
    description: string,
  ): Promise<string> {
    if (!this.agent) await this.initialize();

    const prompt = `Analyze this technical contradiction:

Improving parameter: ${improvingParam}
Worsening parameter: ${worseningParam}
Problem description: ${description}

Provide:
1. Root cause analysis of why this contradiction exists
2. Suggested TRIZ principles to apply
3. Creative solution concepts
4. How to verify the solution works

${getLanguagePrompt(this.locale.language)}`;

    return streamAgent(this.agent!, prompt);
  }

  async evaluateSolution(
    solution: string,
    criteria: string[],
  ): Promise<string> {
    if (!this.agent) await this.initialize();

    const prompt = `Evaluate this TRIZ-based solution:

Solution: ${solution}

Evaluation criteria: ${criteria.join(', ')}

Provide:
1. Strengths of the solution
2. Weaknesses or risks
3. Feasibility assessment
4. Suggestions for improvement
5. Overall recommendation (proceed/modify/reject)

${getLanguagePrompt(this.locale.language)}`;

    return streamAgent(this.agent!, prompt);
  }

  async suggestSuFieldImprovement(
    substance1: string,
    substance2: string,
    field: string,
    problem: string,
  ): Promise<string> {
    if (!this.agent) await this.initialize();

    const prompt = `Analyze this Su-Field model:

Substance 1 (tool): ${substance1}
Substance 2 (object): ${substance2}
Field: ${field}
Problem: ${problem}

Suggest improvements using the 76 Standard Solutions:
1. Identify the Su-Field type (complete, incomplete, harmful, insufficient)
2. Recommend specific standard solutions
3. Provide implementation guidance

${getLanguagePrompt(this.locale.language)}`;

    return streamAgent(this.agent!, prompt);
  }

  async close(): Promise<void> {
    if (this.agent) {
      await this.agent.close();
      this.agent = null;
    }
  }
}

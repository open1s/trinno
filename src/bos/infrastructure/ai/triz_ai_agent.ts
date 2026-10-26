import { Agent, AgentBuilder, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { getModelConfig } from '../config/model-config.js';
import { streamAgent } from './streaming.js';
import { buildInsightScaffold, sanitizeProse } from './insight.js';
import { InventivePrinciple } from '../../domain/principle/entity.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt } from '../../domain/shared/i18n.js';
import { TRIZ_SYSTEM_PROMPT } from '../../prompts/index.js';

const MAX_ARIZ_NARRATIVE_CHARS = 4000;

/**
 * Keep a model answer usable: drop a wrapping code fence and cap the length.
 * An empty answer stays empty, so the caller can report "no narrative" rather
 * than handing back a blank section as if it were an analysis.
 */
function sanitizeNarrative(text: string): string {
  const unfenced = (text || '')
    .trim()
    .replace(/^```[a-zA-Z0-9]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
  return unfenced.slice(0, MAX_ARIZ_NARRATIVE_CHARS);
}

export class AiTrizAgent {
  private agent: Agent | null = null;
  /** In-flight lazy start, so two callers cannot start two agents. */
  private initializing: Promise<void> | null = null;
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
    if (this.agent) return;
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
      // These calls are single-shot answers, not agentic runs: with the full
      // tool belt attached the model can spend the whole deadline calling
      // triz_search/websearch and come back with no prose at all.
      skipDefaultTools: true,
      maxTokens: 2048,
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

  /**
   * The started agent, starting it if needed - once.
   * Two tool calls in one turn can ask at the same moment; without this the
   * second start would replace the agent the first is already streaming on.
   */
  private async ensureAgent(): Promise<Agent> {
    if (!this.agent) {
      if (!this.initializing) {
        this.initializing = this.initialize().finally(() => {
          this.initializing = null;
        });
      }
      await this.initializing;
    }
    return this.agent!;
  }

  async generateInsight(
    problemDescription: string,
    principle: InventivePrinciple,
    context?: string,
  ): Promise<string> {
    await this.ensureAgent();

    const prompt = `Apply TRIZ Inventive Principle #${principle.index} "${principle.name}" to this problem.
Problem: ${problemDescription}
${context ? `Context: ${context}` : ''}Principle description: ${principle.description}
Examples: ${principle.examples.join(', ')}

Answer in prose only - no tools, no JSON - in at most 180 words, as four short labelled lines:
1. Fit: how the principle maps onto this problem
2. Steps: 2-3 concrete implementation steps
3. Risks: the main failure mode and how to avoid it
4. Companions: one or two principles that strengthen it

${getLanguagePrompt(this.locale.language)}`;

    const first = sanitizeProse(await streamAgent(this.agent!, prompt));
    if (first) return first;

    // One retry with the smallest prompt that can still answer: a reply of
    // nothing (or of the two characters "") usually means the model over-planned
    // the first request rather than that the model is unavailable.
    const retry = `TRIZ principle #${principle.index} (${principle.name}): ${principle.description}
Problem: ${problemDescription}
Give one concrete application in at most 120 words. Plain prose, no tools.
${getLanguagePrompt(this.locale.language)}`;
    const second = sanitizeProse(await streamAgent(this.agent!, retry));
    if (second) return second;

    return buildInsightScaffold(
      principle,
      problemDescription,
      context,
      this.locale.language === 'zh' ? 'zh' : 'en',
    );
  }

  async analyzeContradiction(
    improvingParam: string,
    worseningParam: string,
    description: string,
  ): Promise<string> {
    await this.ensureAgent();

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

  /**
   * ARIZ-85C narrative pass: turns the deterministic ARIZ stages into a short,
   * decisive sequence (mini-problem -> first measurable experiment).
   */
  async analyzeAriz(
    problem: string,
    options: {
      system?: string;
      improvingName?: string;
      worseningName?: string;
      principleHints?: string[];
      /** Su-Field class the engine detected, so the narrative stays consistent. */
      suFieldClass?: string;
      /** Deterministic findings to compress; the model must not contradict them. */
      stageFindings?: string[];
      signal?: AbortSignal;
    } = {},
  ): Promise<string> {
    await this.ensureAgent();

    const lines: string[] = [
      'Apply the ARIZ-85C algorithm to this problem and compress it into a short, decisive narrative.',
      '',
      `Problem: ${problem}`,
    ];
    if (options.system) lines.push(`System: ${options.system}`);
    if (options.improvingName || options.worseningName) {
      lines.push(`Technical contradiction: improving "${options.improvingName ?? '?'}" vs worsening "${options.worseningName ?? '?'}"`);
    }
    if (options.principleHints && options.principleHints.length > 0) {
      lines.push(`Candidate principles from the matrix: ${options.principleHints.join(', ')}`);
    }
    if (options.suFieldClass) {
      lines.push(`Su-Field class: ${options.suFieldClass}`);
    }
    if (options.stageFindings && options.stageFindings.length > 0) {
      lines.push(
        '',
        'Deterministic findings you must keep consistent with (compress them, never contradict or invent beyond them):',
        ...options.stageFindings.slice(0, 24).map(finding => `- ${finding}`),
      );
    }

    lines.push(
      '',
      'Return at most 12 lines total, in this exact order:',
      '1. Mini-problem (one sentence)',
      '2. Technical contradiction (one sentence)',
      '3. Ideal Final Result (one sentence)',
      '4. Physical contradiction (one sentence)',
      '5. Chosen separation principle (time | space | condition | whole-parts) and why',
      '6. The single first experiment to run, with its measurable acceptance test',
      '',
      getLanguagePrompt(this.locale.language),
    );

    const streamOptions = options.signal ? { signal: options.signal } : {};
    const raw = await streamAgent(this.agent!, lines.join('\n'), {}, streamOptions);
    return sanitizeNarrative(raw);
  }

  async evaluateSolution(
    solution: string,
    criteria: string[],
  ): Promise<string> {
    await this.ensureAgent();

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
    await this.ensureAgent();

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

import { Agent, AgentBuilder, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { getModelConfig } from '../config/model-config.js';
import { streamAgent } from './streaming.js';
import { InventivePrinciple } from '../../domain/principle/entity.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt } from '../../domain/shared/i18n.js';
import { TRIZ_SYSTEM_PROMPT } from '../../prompts/index.js';

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

  /**
   * ARIZ-85C narrative pass: turns the deterministic ARIZ stages into a short,
   * decisive sequence (mini-problem -> first measurable experiment).
   */
  async analyzeAriz(
    problem: string,
    options: { system?: string; improvingName?: string; worseningName?: string; principleHints?: string[] } = {},
  ): Promise<string> {
    if (!this.agent) await this.initialize();

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

    return streamAgent(this.agent!, lines.join('\n'));
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

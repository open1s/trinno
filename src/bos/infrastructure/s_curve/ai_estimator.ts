import { Agent, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { getModelConfig } from '../config/model-config.js';
import { streamAgent } from '../ai/streaming.js';
import { createModuleLogger } from '../logging/logger.js';
import { CurvePoint, CurveParameters } from '../../domain/s_curve/value_objects.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt } from '../../domain/shared/i18n.js';
import { buildSCurveEstimatorPrompt } from '../../prompts/index.js';

const log = createModuleLogger('ai-scurve-estimator');

export interface AiEstimateResult {
  estimatedParameters: CurveParameters;
  estimatedStage: 'infancy' | 'growth' | 'maturity' | 'decline';
  s2Offset: number;
  reasoning: string;
}

export class AiSCurveEstimator {
  private agent: Agent | null = null;
  private brain: BrainOS | null = null;
  private locale: LocaleConfig;

  constructor(brain?: BrainOS, locale?: LocaleConfig) {
    this.brain = brain || null;
    this.locale = locale || DEFAULT_LOCALE;
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
      name: 'triz-scurve-estimator',
      systemPrompt: buildSCurveEstimatorPrompt(langPrefix),
      temperature: 0.3,
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

  async estimate(
    technologyName: string,
    performanceMetric: string,
    dataPoints?: CurvePoint[],
  ): Promise<AiEstimateResult> {
    if (!this.agent) await this.initialize();

    const dataStr = dataPoints && dataPoints.length > 0
      ? `\nKnown data points: ${JSON.stringify(dataPoints)}`
      : '';

    const prompt = `Estimate S-curve parameters for:

Technology: ${technologyName}
Performance Metric: ${performanceMetric}${dataStr}

Return JSON with: L, k, t0, estimatedStage, s2Offset, reasoning

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseResponse(response, technologyName);
  }

  private parseResponse(response: string, technologyName: string): AiEstimateResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          estimatedParameters: {
            L: parsed.L || 100,
            k: parsed.k || 0.3,
            t0: parsed.t0 || new Date().getFullYear() + 5,
          },
          estimatedStage: parsed.estimatedStage || 'growth',
          s2Offset: parsed.s2Offset || 10,
          reasoning: parsed.reasoning || `AI estimation for ${technologyName}`,
        };
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'S-curve estimate: model output was not valid JSON, using default');
      return this.getDefaultEstimate(technologyName);
    }

    log.warn('S-curve estimate: model returned no JSON object, using default');
    return this.getDefaultEstimate(technologyName);
  }

  private getDefaultEstimate(technologyName: string): AiEstimateResult {
    return {
      estimatedParameters: { L: 100, k: 0.3, t0: new Date().getFullYear() + 5 },
      estimatedStage: 'growth',
      s2Offset: 10,
      reasoning: `Default estimate for ${technologyName}. Provide data points for accurate analysis.`,
    };
  }

  async close(): Promise<void> {
    if (this.agent) {
      await this.agent.close();
      this.agent = null;
    }
  }
}

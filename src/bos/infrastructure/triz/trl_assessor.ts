import { Agent, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { streamAgent } from '../ai/streaming.js';
import {
  TRLAssessment,
  TRLEvidence,
  TRLLevel,
  TRLRange,
  TRL_TITLES,
  TRL_DESCRIPTIONS,
} from '../../domain/s_curve/value_objects.js';
import { SCurveStage } from '../../domain/s_curve/value_objects.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt } from '../../domain/shared/i18n.js';
import trlCriteria from '../../domain/triz/trl_criteria.json';

export interface TRLAssessmentInput {
  technologyName: string;
  performanceMetric: string;
  searchResults: Array<{
    title: string;
    snippet: string;
    url: string;
    publishedDate?: string;
  }>;
  userProvidedTRL?: TRLLevel | undefined;
  userReasoning?: string | undefined;
  s1Stage?: SCurveStage | undefined;
  s2Stage?: SCurveStage | undefined;
}

export interface TRLAssessmentResult {
  s1TRL: TRLAssessment;
  s2TRLRange: TRLRange;
  reconciliation: string;
}

export class TRLAssessor {
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

    const criteriaSummary = Object.values(trlCriteria)
      .map((c: any) => `TRL ${c.level}: ${c.title} - Keywords: ${c.keywords.slice(0, 4).join(', ')}`)
      .join('\n');

    initAgentFactory(this.brain);

    const factory = getAgentFactory();
    const builder = factory.create({
      name: 'triz-trl-assessor',
      systemPrompt: `${langPrefix}You are Research Master — a Technology Readiness Level (TRL) assessment expert using the NASA/DoD 1-9 scale within a 7-phase TRIZ pipeline (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution). You prioritize importance-weighted KPIs, score evidence, surface decision factors, and produce copy-ready JSON artifacts.

TRL Scale (with evidence signal types — score each item by these):
${criteriaSummary}

Think step by step, break into smaller parts:
1. Mine search results for evidence-per-TRL-signal (see below); score weight × relevance
2. Reconcile S1 (single level) vs S2 (min-max with most-likely)
3. Cross-check TRL vs S-Curve stage, flag discrepancies
4. When user TRL is provided, integrate + adjust confidence

EVIDENCE TYPE CRITERIA — importance-weighted (high→medium→low):
- TRL 1-2 (Basic research): academic papers, first principles, no application context
- TRL 3 (Proof of concept): analytical/experimental POC, lab validation, simulation
- TRL 4 (Lab validation): component/subsystem in lab, breadboard
- TRL 5 (Relevant environment): component/subsystem in simulated environment
- TRL 6 (Prototype demo): prototype in relevant environment, near-operational
- TRL 7 (Operational demo): system prototype in operational environment
- TRL 8 (Qualified): completed + qualified via test/demo, first-of-a-kind
- TRL 9 (Proven): successful mission ops, commercially available, wide adoption

Each evidence item MUST specify: source URL/title, TRL level supported, confidence (0–1), weight (importance × recency), and a quoted snippet.

User-supplied TRL:
- Integrate reasoning → boost confidence if domain-aligned
- If user TRL conflicts with AI assessment → record discrepancy in "reconciliation" field

Return ONLY valid JSON. No markdown, no explanation outside JSON. ≤4 lines per artifact cell.`,
      temperature: 0.2,
    });

    this.agent = await builder.start();
  }

  async assess(input: TRLAssessmentInput): Promise<TRLAssessmentResult> {
    if (!this.agent) await this.initialize();

    const snippets = input.searchResults
      .map(r => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.url}\nDate: ${r.publishedDate || 'unknown'}`)
      .join('\n\n');

    const userInput = input.userProvidedTRL
      ? `\nUser provided TRL: ${input.userProvidedTRL}\nUser reasoning: ${input.userReasoning || 'Not provided'}`
      : '';

    const stageContext = input.s1Stage && input.s2Stage
      ? `\nS-Curve stages: S1=${input.s1Stage}, S2=${input.s2Stage}`
      : '';

    const prompt = `Assess TRL for:

Technology: ${input.technologyName}
Performance Metric: ${input.performanceMetric}${stageContext}${userInput}

Search results:
${snippets || 'No search results available. Use domain knowledge to assess.'}

Return JSON with:
{
  "s1TRL": {
    "level": 1-9,
    "evidence": [{"source": "url/title", "trlLevelSupported": 1-9, "confidence": 0-1, "snippet": "..."}],
    "confidence": 0-1,
    "reasoning": "..."
  },
  "s2TRLRange": {
    "min": 1-9,
    "max": 1-9,
    "mostLikely": 1-9,
    "reasoning": "..."
  },
  "reconciliation": "Explain any discrepancies between TRL and S-Curve stages, or confirm alignment."
}

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseResponse(response, input);
  }

  private parseResponse(response: string, input: TRLAssessmentInput): TRLAssessmentResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const s1Level = this.clampTRL(parsed.s1TRL?.level || 3);
        const s2Min = this.clampTRL(parsed.s2TRLRange?.min || 1);
        const s2Max = this.clampTRL(parsed.s2TRLRange?.max || 3);
        const s2MostLikely = this.clampTRL(parsed.s2TRLRange?.mostLikely || 2);

        return {
          s1TRL: {
            level: s1Level,
            title: TRL_TITLES[s1Level],
            description: TRL_DESCRIPTIONS[s1Level],
            evidence: (parsed.s1TRL?.evidence || []).map((e: any) => ({
              source: e.source || 'AI assessment',
              trlLevelSupported: this.clampTRL(e.trlLevelSupported || s1Level),
              confidence: Math.max(0, Math.min(1, e.confidence || 0.5)),
              snippet: e.snippet || '',
            })),
            confidence: Math.max(0, Math.min(1, parsed.s1TRL?.confidence || 0.5)),
            reasoning: parsed.s1TRL?.reasoning || 'AI assessment based on available evidence',
            isUserProvided: !!input.userProvidedTRL,
          },
          s2TRLRange: {
            min: s2Min,
            max: s2Max,
            mostLikely: s2MostLikely,
            reasoning: parsed.s2TRLRange?.reasoning || 'AI estimate for next-gen technology',
          },
          reconciliation: parsed.reconciliation || 'TRL and S-Curve stages are aligned',
        };
      }
    } catch {
    }

    return this.getDefaultAssessment(input);
  }

  private getDefaultAssessment(input: TRLAssessmentInput): TRLAssessmentResult {
    const defaultLevel: TRLLevel = input.userProvidedTRL || 3;

    return {
      s1TRL: {
        level: defaultLevel,
        title: TRL_TITLES[defaultLevel],
        description: TRL_DESCRIPTIONS[defaultLevel],
        evidence: [],
        confidence: input.userProvidedTRL ? 0.9 : 0.3,
        reasoning: input.userProvidedTRL
          ? `User-provided TRL ${defaultLevel}. ${input.userReasoning || ''}`
          : 'Default assessment. Provide search results for accurate TRL evaluation.',
        isUserProvided: !!input.userProvidedTRL,
      },
      s2TRLRange: {
        min: 1,
        max: 3,
        mostLikely: 2,
        reasoning: 'Default S2 range. Next-gen technology typically in early TRL stages.',
      },
      reconciliation: 'Insufficient data for reconciliation. Provide search results for detailed analysis.',
    };
  }

  private clampTRL(value: number): TRLLevel {
    const clamped = Math.max(1, Math.min(9, Math.round(value)));
    return clamped as TRLLevel;
  }

  async close(): Promise<void> {
    if (this.agent) {
      await this.agent.close();
      this.agent = null;
    }
  }
}

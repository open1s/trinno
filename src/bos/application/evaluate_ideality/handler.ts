import { EvaluateIdealityCommand, EvaluateIdealityResult, IdealityScore } from './command.js';
import { LocaleConfig, DEFAULT_LOCALE, t } from '../../domain/shared/i18n.js';

function sanitizeWeight(value: number, fallback: number): number {
  if (typeof value !== 'number' || !isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

function perItemSum(items: string[], perItemDefault: number, overrides: number[] | undefined): { sum: number; effective: number[] } {
  const effective: number[] = [];
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    const raw = overrides && i < overrides.length ? overrides[i] : perItemDefault;
    const w = sanitizeWeight(raw ?? perItemDefault, perItemDefault);
    effective.push(w);
    sum += w;
  }
  return { sum, effective };
}

function computeConfidence(benefits: string[], costs: string[], harms: string[], bw: number, cw: number, hw: number): number {
  const totalItems = benefits.length + costs.length + harms.length;
  if (totalItems === 0) return 0;
  const itemFactor = Math.min(1, totalItems / 4);
  const weightDefined = (bw > 0 ? 1 : 0) + (cw > 0 ? 1 : 0) + (hw > 0 ? 1 : 0);
  const weightFactor = weightDefined / 3;
  return Math.round((0.7 * itemFactor + 0.3 * weightFactor) * 100) / 100;
}

function pickDominant(benefitScore: number, costScore: number, harmScore: number): IdealityScore['dominant'] {
  if (benefitScore === 0 && costScore === 0 && harmScore === 0) return 'none';
  const max = Math.max(benefitScore, costScore, harmScore);
  const second = [benefitScore, costScore, harmScore]
    .filter(v => v !== max)
    .reduce((a, b) => Math.max(a, b), 0);
  if (max === 0) return 'balanced';
  if (max - second < max * 0.1) return 'balanced';
  if (max === benefitScore) return 'benefits';
  if (max === costScore) return 'costs';
  return 'harms';
}

export class EvaluateIdealityHandler {
  private locale: LocaleConfig;

  constructor(locale?: LocaleConfig) {
    this.locale = locale || DEFAULT_LOCALE;
  }

  async execute(command: EvaluateIdealityCommand): Promise<EvaluateIdealityResult> {
    const lang = this.locale.language;
    const bw = sanitizeWeight(command.benefitWeight ?? 10, 10);
    const cw = sanitizeWeight(command.costWeight ?? 5, 5);
    const hw = sanitizeWeight(command.harmWeight ?? 8, 8);

    const { sum: benefitScore } = perItemSum(command.benefits, bw, command.benefitWeights);
    const { sum: costScore } = perItemSum(command.costs, cw, command.costWeights);
    const { sum: harmScore } = perItemSum(command.harms, hw, command.harmWeights);

    const denominator = costScore + harmScore;
    let ratio: number;
    if (benefitScore === 0 && denominator === 0) {
      ratio = 0;
    } else if (denominator === 0) {
      ratio = 1;
    } else {
      ratio = benefitScore / denominator;
    }
    const score = Math.max(0, Math.min(100, Math.round(ratio * 100)));

    let level: IdealityScore['level'];
    if (score >= 80) level = 'ideal';
    else if (score >= 50) level = 'high';
    else if (score >= 25) level = 'medium';
    else level = 'low';

    const dominant = pickDominant(benefitScore, costScore, harmScore);

    const recommendations: string[] = [];
    if (dominant === 'costs' || dominant === 'harms') {
      recommendations.push(t('reducingCosts', lang));
    }
    if (dominant === 'harms') {
      recommendations.push(t('eliminatingHarms', lang));
    }
    if (command.benefits.length < 3) {
      recommendations.push(t('increasingBenefits', lang));
    }
    if (level === 'low' || level === 'medium') {
      recommendations.push(t('considerPrinciples', lang));
    }
    if (command.harms.length === 0 && command.costs.length === 0 && command.benefits.length > 0) {
      recommendations.push(t('perfectIdeality', lang));
    }

    return {
      problemId: command.problemId,
      ideality: {
        score,
        level,
        breakdown: {
          benefits: benefitScore,
          costs: costScore,
          harms: harmScore,
        },
        recommendations,
        confidence: computeConfidence(command.benefits, command.costs, command.harms, bw, cw, hw),
        dominant,
      },
    };
  }
}

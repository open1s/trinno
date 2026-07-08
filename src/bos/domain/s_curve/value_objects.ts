export type SCurveStage = 'infancy' | 'growth' | 'maturity' | 'decline' | 'exit';

export const SCURVE_STAGE_ORDER: ReadonlyArray<SCurveStage> = ['infancy', 'growth', 'maturity', 'decline', 'exit'];

export const STAGE_LABELS: Readonly<Record<SCurveStage, string>> = {
  infancy: 'Infancy',
  growth: 'Growth',
  maturity: 'Maturity',
  decline: 'Decline',
  exit: 'Exit',
};

export const STAGE_COLORS: Readonly<Record<SCurveStage, string>> = {
  infancy: '#e8f5e9',
  growth: '#fff3e0',
  maturity: '#fce4ec',
  decline: '#f3e5f5',
  exit: '#efebe9',
};

export const STAGE_BORDER_COLORS: Readonly<Record<SCurveStage, string>> = {
  infancy: '#4caf50',
  growth: '#ff9800',
  maturity: '#e91e63',
  decline: '#9c27b0',
  exit: '#795548',
};

export const STAGE_DESCRIPTIONS: Readonly<Record<SCurveStage, string>> = {
  infancy: 'Early R&D phase. Slow progress, high investment, many dead ends. Focus on fundamental research.',
  growth: 'Rapid improvement phase. Breakthroughs accelerate. Heavy investment pays off. Market adoption increases.',
  maturity: 'Diminishing returns. Most easy problems solved. Incremental improvements only. Focus on cost reduction.',
  decline: 'Technology being replaced. New S-curve emerging. Divest and transition to next-generation technology.',
  exit: 'Technology obsolete. Market has moved on. No further investment. Assets divested, knowledge archived.',
};

export const STAGE_STRATEGIES: Readonly<Record<SCurveStage, string>> = {
  infancy: 'Invest in fundamental research. Protect IP. Explore multiple approaches. Accept high failure rate.',
  growth: 'Accelerate development. Scale production. Build market position. Patent aggressively.',
  maturity: 'Optimize for cost and reliability. Extract maximum value. Begin investing in next-generation technology.',
  decline: 'Phase out investment. Migrate customers to S2 technology. Harvest remaining profits. Divest assets.',
  exit: 'Cease all investment. Archive knowledge. Migrate remaining users. Salvage any residual value.',
};

export function getStageDescription(stage: SCurveStage): string {
  return STAGE_DESCRIPTIONS[stage];
}

export function getStageStrategy(stage: SCurveStage): string {
  return STAGE_STRATEGIES[stage];
}

export type HypeCyclePhase =
  | 'innovation_trigger'
  | 'peak_of_inflated_expectations'
  | 'trough_of_disillusionment'
  | 'slope_of_enlightenment'
  | 'plateau_of_productivity';

export const HYPE_CYCLE_PHASE_ORDER: ReadonlyArray<HypeCyclePhase> = [
  'innovation_trigger',
  'peak_of_inflated_expectations',
  'trough_of_disillusionment',
  'slope_of_enlightenment',
  'plateau_of_productivity',
];

export const HYPE_CYCLE_LABELS: Readonly<Record<HypeCyclePhase, string>> = {
  innovation_trigger: 'Innovation Trigger',
  peak_of_inflated_expectations: 'Peak of Inflated Expectations',
  trough_of_disillusionment: 'Trough of Disillusionment',
  slope_of_enlightenment: 'Slope of Enlightenment',
  plateau_of_productivity: 'Plateau of Productivity',
};

export const HYPE_CYCLE_COLORS: Readonly<Record<HypeCyclePhase, string>> = {
  innovation_trigger: '#2196F3',
  peak_of_inflated_expectations: '#FF9800',
  trough_of_disillusionment: '#F44336',
  slope_of_enlightenment: '#4CAF50',
  plateau_of_productivity: '#3F51B5',
};

export const HYPE_CYCLE_DESCRIPTIONS: Readonly<Record<HypeCyclePhase, string>> = {
  innovation_trigger: 'Breakthrough or proof of concept generates significant press and interest. Early prototypes are demonstrated.',
  peak_of_inflated_expectations: 'Unrealistic expectations dominate. Early success stories proliferate alongside failures. Hype peaks.',
  trough_of_disillusionment: 'Technology fails to meet inflated expectations. Interest wanes. Investment slows. Real-world viability is questioned.',
  slope_of_enlightenment: 'Practical applications emerge. Technology providers deliver second-generation products. Understanding matures.',
  plateau_of_productivity: 'Mainstream adoption begins. Technology becomes stable and widely understood. Market criteria for viability are clear.',
};

export interface HypeCycleMapping {
  sCurveStage: SCurveStage;
  hypeCyclePhase: HypeCyclePhase;
  description: string;
}

export const SCURVE_TO_HYPE_CYCLE: ReadonlyArray<HypeCycleMapping> = [
  { sCurveStage: 'infancy', hypeCyclePhase: 'innovation_trigger', description: 'Early research triggers press coverage and initial excitement.' },
  { sCurveStage: 'infancy', hypeCyclePhase: 'peak_of_inflated_expectations', description: 'During infancy, inflated expectations often peak before real capability matches.' },
  { sCurveStage: 'growth', hypeCyclePhase: 'trough_of_disillusionment', description: 'Growth begins as disillusionment fades and real applications emerge.' },
  { sCurveStage: 'growth', hypeCyclePhase: 'slope_of_enlightenment', description: 'Rapid improvement during growth aligns with practical understanding.' },
  { sCurveStage: 'maturity', hypeCyclePhase: 'plateau_of_productivity', description: 'Maturity corresponds to the productivity plateau — stable adoption.' },
  { sCurveStage: 'decline', hypeCyclePhase: 'plateau_of_productivity', description: 'During decline, technology still operates but on the outer edge of the plateau.' },
];

export interface CurvePoint {
  x: number;
  y: number;
}

export interface Milestone {
  year: number;
  label: string;
  description: string;
  type: 'invention' | 'breakthrough' | 'commercialization' | 'standardization' | 'peak' | 'decline';
  rawFact?: string;
}

export const MILESTONE_COLORS: Readonly<Record<Milestone['type'], string>> = {
  invention: '#9C27B0',
  breakthrough: '#FF9800',
  commercialization: '#4CAF50',
  standardization: '#2196F3',
  peak: '#E91E63',
  decline: '#757575',
};

export const MILESTONE_ICONS: Readonly<Record<Milestone['type'], string>> = {
  invention: '★',
  breakthrough: '▲',
  commercialization: '◆',
  standardization: '●',
  peak: '▼',
  decline: '○',
};

export interface CurveParameters {
  L: number;
  k: number;
  t0: number;
}

export interface StageBoundary {
  stage: SCurveStage;
  startX: number;
  endX: number;
  performanceRange: [number, number];
}

export interface SCurveAnalysis {
  technologyName: string;
  performanceMetric: string;
  s1: {
    parameters: CurveParameters;
    stage: SCurveStage;
    dataPoints: CurvePoint[];
    estimated: boolean;
  };
  s2: {
    parameters: CurveParameters;
    stage: SCurveStage;
    dataPoints: CurvePoint[];
    estimated: boolean;
  };
  stageBoundaries: StageBoundary[];
  crossoverPoint: number;
  yearsToS1Peak: number;
  recommendations: string[];
}

export type TRLLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const TRL_LEVELS: ReadonlyArray<TRLLevel> = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const TRL_TITLES: Readonly<Record<TRLLevel, string>> = {
  1: 'Basic Principles Observed',
  2: 'Technology Concept Formulated',
  3: 'Experimental Proof of Concept',
  4: 'Component Validation in Laboratory',
  5: 'Component Validation in Relevant Environment',
  6: 'System/Subsystem Model in Relevant Environment',
  7: 'System Prototype in Operational Environment',
  8: 'Actual System Completed and Qualified',
  9: 'Actual System Proven in Operational Environment',
};

export const TRL_DESCRIPTIONS: Readonly<Record<TRLLevel, string>> = {
  1: 'Basic principles observed and reported. Scientific research begins to be translated into applied research.',
  2: 'Technology concept and/or application formulated. Invention begins, but no proof available.',
  3: 'Active R&D initiated. Analytical and experimental proof of concept obtained.',
  4: 'Component and/or breadboard validation in laboratory environment.',
  5: 'Component validation in relevant environment. Significantly increases fidelity.',
  6: 'System/subsystem model or prototype demonstration in relevant environment.',
  7: 'System prototype demonstration in operational environment.',
  8: 'Actual system completed and qualified through test and demonstration.',
  9: 'Actual system proven through successful mission operations in routine use.',
};

export interface TRLEvidence {
  source: string;
  trlLevelSupported: TRLLevel;
  confidence: number;
  snippet: string;
}

export interface TRLAssessment {
  level: TRLLevel;
  title: string;
  description: string;
  evidence: TRLEvidence[];
  confidence: number;
  reasoning: string;
  isUserProvided: boolean;
}

export interface TRLRange {
  min: TRLLevel;
  max: TRLLevel;
  mostLikely: TRLLevel;
  reasoning: string;
}

export function getTRLTitle(level: TRLLevel): string {
  return TRL_TITLES[level];
}

export function getTRLDescription(level: TRLLevel): string {
  return TRL_DESCRIPTIONS[level];
}

export function formatTRL(assessment: TRLAssessment): string {
  return `TRL ${assessment.level}/9 - ${assessment.title}`;
}

export function formatTRLRange(range: TRLRange): string {
  return `TRL ${range.min}-${range.max}/9 (most likely: ${range.mostLikely})`;
}

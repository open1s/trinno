export interface EvaluateIdealityCommand {
  problemId: string;
  benefits: string[];
  costs: string[];
  harms: string[];
  benefitWeight?: number;
  costWeight?: number;
  harmWeight?: number;
  benefitWeights?: number[];
  costWeights?: number[];
  harmWeights?: number[];
}

export interface IdealityScore {
  score: number;
  level: 'low' | 'medium' | 'high' | 'ideal';
  breakdown: {
    benefits: number;
    costs: number;
    harms: number;
  };
  recommendations: string[];
  confidence: number;
  dominant: 'benefits' | 'costs' | 'harms' | 'balanced' | 'none';
}

export interface EvaluateIdealityResult {
  problemId: string;
  ideality: IdealityScore;
}

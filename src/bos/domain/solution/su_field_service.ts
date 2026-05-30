import { SuFieldComponents } from '../problem/value_objects.js';
import { StandardSolution, getStandardSolutionsFor, CLASS_LABELS } from './standard_solutions_76.js';

export type SuFieldType = 'complete' | 'incomplete' | 'harmful' | 'insufficient' | 'excessive';

export interface SuFieldAnalysisResult {
  type: SuFieldType;
  diagnosis: string;
  standardSolutions: string[];
  recommendedAction: string;
  solutions: StandardSolution[];
}

export class SuFieldAnalysisService {
  analyze(components: SuFieldComponents): SuFieldAnalysisResult {
    const hasS1 = components.substance1.trim().length > 0;
    const hasS2 = components.substance2.trim().length > 0;
    const hasField = components.field.trim().length > 0;

    if (!hasS1 || !hasS2 || !hasField) {
      const missing: string[] = [];
      if (!hasS1) missing.push('substance 1 (tool)');
      if (!hasS2) missing.push('substance 2 (object)');
      if (!hasField) missing.push('field');
      return this.format(
        'incomplete',
        `Su-Field model is incomplete. Missing: ${missing.join(', ')}.`,
        getStandardSolutionsFor('incomplete'),
        'Identify and add the missing component to complete the Su-Field triangle.',
      );
    }

    return this.format(
      'complete',
      `Complete Su-Field: ${components.substance1} acts on ${components.substance2} via ${components.field}.`,
      getStandardSolutionsFor('complete'),
      'Evaluate if the interaction is harmful, insufficient, or excessive; apply 1.2.x to destroy, 2.x to develop.',
    );
  }

  analyzeHarmful(s1: string, s2: string, field: string): SuFieldAnalysisResult {
    return this.format(
      'harmful',
      `Harmful Su-Field: ${s1} produces harmful effects on ${s2} via ${field}.`,
      getStandardSolutionsFor('harmful'),
      'Apply Class 1.2 (destroy Su-Field) before Class 2 (develop) — eliminate harm first, then enhance useful action.',
    );
  }

  analyzeInsufficient(s1: string, s2: string, field: string): SuFieldAnalysisResult {
    return this.format(
      'insufficient',
      `Insufficient Su-Field: ${s1} does not adequately affect ${s2} via ${field}.`,
      getStandardSolutionsFor('insufficient'),
      'Apply Class 2.1 (transition to complex) or 2.2 (enhance field / substance) to strengthen the interaction.',
    );
  }

  analyzeExcessive(s1: string, s2: string, field: string): SuFieldAnalysisResult {
    return this.format(
      'excessive',
      `Excessive Su-Field: ${s1} overacts on ${s2} via ${field}.`,
      getStandardSolutionsFor('excessive'),
      'Apply Class 2.2.4 (modulate field) or Class 5.1.2 (trimming) to reduce intensity while keeping the useful action.',
    );
  }

  private format(
    type: SuFieldType,
    diagnosis: string,
    solutions: StandardSolution[],
    recommendedAction: string,
  ): SuFieldAnalysisResult {
    return {
      type,
      diagnosis,
      solutions,
      standardSolutions: solutions.map(s => `${s.number} — ${s.title}: ${s.description}`),
      recommendedAction,
    };
  }
}

export { CLASS_LABELS };


import { ContradictionMatrix } from '../contradiction/matrix.js';
import { PrincipleEngine } from '../principle/services.js';
import { getParameterByIndex } from '../principle/parameters.js';
import { SuFieldAnalysisService, type SuFieldType } from '../solution/su_field_service.js';
import {
  ARIZ_STAGE_BLUEPRINT,
  SEPARATION_PRINCIPLES,
  type ArizSeparation,
  type ArizStage,
} from './stages.js';

export interface ArizInput {
  problem: string;
  system?: string;
  tool?: string;
  product?: string;
  field?: string;
  /** Force the Su-Field class instead of letting the service auto-detect it. */
  suFieldType?: SuFieldType;
  improvingParameter?: number;
  worseningParameter?: number;
}

export interface ArizPrincipleRef {
  index: number;
  name: string;
  description: string;
  /** Why this principle was chosen (matrix cell vs keyword fallback). */
  rationale: string;
}

export interface ArizSuFieldSummary {
  type: SuFieldType;
  diagnosis: string;
  standardSolutions: string[];
  recommendedAction: string;
}

export interface ArizResult {
  input: ArizInput;
  stages: ArizStage[];
  principles: ArizPrincipleRef[];
  separation: ReadonlyArray<ArizSeparation>;
  suField?: ArizSuFieldSummary;
  /** Explicit assumptions and missing-input warnings. */
  notes: string[];
}

/**
 * Deterministic ARIZ-85C engine: walks the 8 stages, resolves principles from
 * the contradiction matrix (or a keyword fallback) and models the Su-Field when
 * the components are supplied. No AI, no I/O — safe to unit test.
 */
export class ArizEngine {
  private readonly matrix = ContradictionMatrix.getInstance();

  constructor(
    private readonly principles: PrincipleEngine,
    private readonly suField: SuFieldAnalysisService,
  ) {}

  build(input: ArizInput): ArizResult {
    const problem = (input.problem || '').trim();
    const notes: string[] = [];
    const stages: ArizStage[] = ARIZ_STAGE_BLUEPRINT.map(s => ({ ...s, findings: [] }));
    const find = (id: ArizStage['id'], ...lines: string[]): void => {
      const stage = stages.find(s => s.id === id);
      if (stage) stage.findings.push(...lines.filter(l => !!l));
    };

    if (!problem) notes.push('No problem statement supplied — every stage is seeded from default guidance only.');

    // --- 2. Technical contradiction: matrix lookup or keyword fallback ---------
    const iParam = input.improvingParameter;
    const wParam = input.worseningParameter;
    const iName = typeof iParam === 'number' ? (getParameterByIndex(iParam)?.name ?? `#${iParam}`) : '';
    const wName = typeof wParam === 'number' ? (getParameterByIndex(wParam)?.name ?? `#${wParam}`) : '';
    const principleRefs: ArizPrincipleRef[] = [];

    if (typeof iParam === 'number' && typeof wParam === 'number') {
      for (const n of this.matrix.lookup(iParam, wParam)) {
        const p = this.principles.getPrinciple(n);
        if (p) {
          principleRefs.push({
            index: p.index,
            name: p.name,
            description: p.description,
            rationale: `Contradiction matrix cell (${iParam} vs ${wParam})`,
          });
        }
      }
    } else {
      for (const p of this.principles.searchPrinciples(problem, { limit: 5 })) {
        principleRefs.push({
          index: p.index,
          name: p.name,
          description: p.description,
          rationale: 'Keyword match on the problem statement (no parameter pair supplied)',
        });
      }
      notes.push('No improving/worsening parameter pair supplied — principles come from keyword search, not a matrix cell.');
    }

    const hasPair = typeof iParam === 'number' && typeof wParam === 'number';

    // --- 1. Mini-problem ------------------------------------------------------
    find('mini_problem',
      problem ? `Problem (verbatim): ${problem}` : '',
      input.system ? `Technical system: ${input.system}` : 'Technical system not specified — infer it from the problem.',
      input.tool || input.product
        ? `Conflict pair: tool = ${input.tool ?? 'unspecified'}, product = ${input.product ?? 'unspecified'}.`
        : 'Conflict pair (tool/product) not supplied — identify the two interacting elements.',
      'Mini-problem: deliver the required function without the negative effect, with no extra cost or complexity.',
    );

    // --- 2. Technical contradiction ------------------------------------------
    find('technical_contradiction',
      hasPair
        ? `Improving parameter #${iParam} (${iName}) worsens #${wParam} (${wName}).`
        : 'Parameter pair not supplied — map the conflict onto two of the 39 engineering parameters.',
      principleRefs.length > 0
        ? `Candidate principles: ${principleRefs.map(p => `#${p.index} ${p.name}`).join(', ')}.`
        : 'No candidate principles found — widen the problem keywords or supply a parameter pair.',
    );

    // --- 3. Ideal Final Result ------------------------------------------------
    const subject = input.product || 'the object itself';
    find('ifr',
      `IFR: the required function is performed by ${subject} without ${input.tool ? `the extra tool "${input.tool}"` : 'extra tooling'} and without cost or harm.`,
      'IFR+: strengthen it — the system also becomes simpler and uses only resources already present.',
      'Before adding anything, look for an in-system resource: waste energy, empty space, idle time, information.',
    );

    // --- 4. Physical contradiction -------------------------------------------
    find('physical_contradiction',
      hasPair
        ? `The same element must maximise ${iName} while minimising ${wName} — it must carry the useful property and its opposite at once.`
        : 'Formulate the physical contradiction: name the single element that must be both A and not-A.',
      'Specify the zone, the time window and the condition under which each state is required.',
    );

    // --- 5. Separation principles --------------------------------------------
    for (const sp of SEPARATION_PRINCIPLES) {
      find('separation', `${sp.title}: ${sp.question} ${sp.example}`);
    }

    // --- 6. Su-Field + 76 standard solutions ---------------------------------
    let suField: ArizSuFieldSummary | undefined;
    if (input.tool && input.product && input.field) {
      const t = input.tool;
      const prod = input.product;
      const fld = input.field;
      const result =
        input.suFieldType === 'harmful' ? this.suField.analyzeHarmful(t, prod, fld)
        : input.suFieldType === 'insufficient' ? this.suField.analyzeInsufficient(t, prod, fld)
        : input.suFieldType === 'excessive' ? this.suField.analyzeExcessive(t, prod, fld)
        : this.suField.analyze({ substance1: t, substance2: prod, field: fld });
      suField = {
        type: result.type,
        diagnosis: result.diagnosis,
        standardSolutions: result.standardSolutions,
        recommendedAction: result.recommendedAction,
      };
      find('su_field',
        result.diagnosis,
        `Su-Field class: ${result.type}.`,
        `Recommended: ${result.recommendedAction}`,
      );
    } else {
      notes.push('Su-Field model skipped: supply tool, product and field to model the interaction.');
      find('su_field', 'Su-Field model incomplete — supply tool (S1), product (S2) and the field.');
    }

    // --- 7. Ideality ----------------------------------------------------------
    find('ideality',
      'Score Ideality = Benefits / (Costs + Harms) for each candidate solution.',
      'Prefer the candidate that removes a component over one that adds a component.',
    );

    // --- 8. Plan --------------------------------------------------------------
    const top = principleRefs.slice(0, 3).map(p => `#${p.index} ${p.name}`).join(', ');
    find('plan',
      top ? `Apply first: ${top}.` : 'Select at least one principle from the technical-contradiction step.',
      suField && suField.standardSolutions.length > 0
        ? `Standard solutions to try: ${suField.standardSolutions.slice(0, 3).join('; ')}.`
        : 'Model the Su-Field to unlock the 76 Standard Solutions.',
      'Define one measurable acceptance test (metric, threshold, method) before implementing.',
      'If the contradiction persists after one iteration, return to step 4 and re-intensify the conflict.',
    );

    return {
      input,
      stages,
      principles: principleRefs,
      separation: SEPARATION_PRINCIPLES,
      ...(suField ? { suField } : {}),
      notes,
    };
  }
}

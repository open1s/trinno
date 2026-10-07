/**
 * ARIZ-85C stage blueprint and separation principles.
 *
 * Pure metadata: no I/O, no AI. The engine (engine.ts) fills each stage with
 * deterministic findings; the application handler may enrich them with AI.
 */

export type ArizStageId =
  | 'mini_problem'
  | 'technical_contradiction'
  | 'ifr'
  | 'physical_contradiction'
  | 'separation'
  | 'su_field'
  | 'ideality'
  | 'plan';

export interface ArizStage {
  id: ArizStageId;
  title: string;
  goal: string;
  /** Questions ARIZ asks at this step (guidance for the analyst/agent). */
  questions: string[];
  /** Deterministic findings computed from the current inputs. */
  findings: string[];
}

/** Ordered ARIZ-85C walkthrough used to seed every analysis. */
export const ARIZ_STAGE_BLUEPRINT: ReadonlyArray<
  Pick<ArizStage, 'id' | 'title' | 'goal' | 'questions'>
> = [
  {
    id: 'mini_problem',
    title: '1. Problem analysis — mini-problem & conflict pair',
    goal: 'Restate the problem as a mini-problem: the required function must be achieved without the negative effect, at no extra cost.',
    questions: [
      'What is the technical system and its main useful function?',
      'Which two elements form the conflict pair (tool and product)?',
      'State the mini-problem: how can the function be delivered without the harm?',
    ],
  },
  {
    id: 'technical_contradiction',
    title: '2. Technical contradiction (TC)',
    goal: 'Map the conflict to TRIZ parameters and pull candidate principles from the contradiction matrix.',
    questions: [
      'Which parameter improves, and which one worsens?',
      'Is the conflict better stated as a physical contradiction (one element, opposite states)?',
    ],
  },
  {
    id: 'ifr',
    title: '3. Ideal Final Result (IFR)',
    goal: 'Describe the ideal outcome: the function is performed by the object itself, with no extra tooling, cost, or harm.',
    questions: [
      'What is the ideal result if there were no constraints at all?',
      'How can the object deliver the function itself?',
      'What resource already present in the system can be used?',
    ],
  },
  {
    id: 'physical_contradiction',
    title: '4. Physical contradiction (PC)',
    goal: 'Formulate the conflict as one element needing two opposite properties at the same time.',
    questions: [
      'Which single element must be both A and not-A?',
      'In which zone, at which time, and under which condition?',
    ],
  },
  {
    id: 'separation',
    title: '5. Separation principles',
    goal: 'Resolve the physical contradiction by separating the opposite requirements.',
    questions: [
      'Can the property differ in time (high then low)?',
      'Can it differ in space (only where needed)?',
      'Can it depend on a condition (threshold, field, state)?',
      'Can one part have property A while the whole has the opposite?',
    ],
  },
  {
    id: 'su_field',
    title: '6. Su-Field model & standard solutions',
    goal: 'Model the interaction as substance-field and pick 76 Standard Solutions for its class.',
    questions: [
      'What are S1 (tool), S2 (object) and the field?',
      'Is the Su-Field complete, incomplete, harmful, insufficient or excessive?',
    ],
  },
  {
    id: 'ideality',
    title: '7. Ideality check',
    goal: 'Score Ideality = Benefits / (Costs + Harms) for the candidate solution.',
    questions: [
      'What benefits, costs and harms does the candidate move?',
      'Does the solution increase the denominator more than the numerator?',
    ],
  },
  {
    id: 'plan',
    title: '8. Solution plan & verification',
    goal: 'Turn the surviving concept into a concrete, measurable next action.',
    questions: [
      'Which principle / standard solution will be implemented first?',
      'What measurable acceptance test proves it works?',
      'If the contradiction persists, which step should be strengthened?',
    ],
  },
];

export type SeparationKind = 'time' | 'space' | 'condition' | 'whole_parts';

export interface ArizSeparation {
  kind: SeparationKind;
  title: string;
  /** Question that reveals whether this separation applies. */
  question: string;
  /** Classic illustrative example (explicitly illustrative, not a case study). */
  example: string;
}

/** The four classical separation principles for resolving a physical contradiction. */
export const SEPARATION_PRINCIPLES: ReadonlyArray<ArizSeparation> = [
  {
    kind: 'time',
    title: 'Separation in time',
    question: 'Can the property be strong during one phase and weak during another?',
    example: 'Illustrative: an aircraft landing gear is long in the air and short on the ground.',
  },
  {
    kind: 'space',
    title: 'Separation in space',
    question: 'Can the property exist only in the zone where it is needed?',
    example: 'Illustrative: a blade is sharp only along the cutting edge, not along the whole tool.',
  },
  {
    kind: 'condition',
    title: 'Separation by condition',
    question: 'Can a threshold, field, or state switch the property on and off?',
    example: 'Illustrative: a valve stays closed until temperature crosses a set point.',
  },
  {
    kind: 'whole_parts',
    title: 'Separation between parts and whole',
    question: 'Can one part carry property A while the whole behaves with the opposite?',
    example: 'Illustrative: a chain is flexible link-by-link yet rigid under tension.',
  },
];

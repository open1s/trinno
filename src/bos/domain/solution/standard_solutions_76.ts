export type StandardSolutionClass =
  | 'build'
  | 'destroy'
  | 'develop_complex'
  | 'develop_enhance'
  | 'transition'
  | 'detect'
  | 'strategy';

export interface StandardSolution {
  number: string;
  class: StandardSolutionClass;
  title: string;
  description: string;
  appliesTo: Array<'incomplete' | 'harmful' | 'insufficient' | 'excessive' | 'complete'>;
}

export const STANDARD_SOLUTIONS: ReadonlyArray<StandardSolution> = [
  {
    number: '1.1.1',
    class: 'build',
    title: 'Build a single Su-Field by adding a missing element',
    description: 'If a substance or field is missing, add it directly. Prefer an existing substance or field from the supersystem before introducing something new.',
    appliesTo: ['incomplete', 'insufficient'],
  },
  {
    number: '1.1.2',
    class: 'build',
    title: 'Build an internal complex Su-Field',
    description: 'Add an internal substance S3 that is part of the object and is acted on by a field. The action is applied through S3 to the rest of the object.',
    appliesTo: ['incomplete', 'insufficient'],
  },
  {
    number: '1.1.3',
    class: 'build',
    title: 'Build an external complex Su-Field',
    description: 'Add an external substance S3 to the system that is acted on by a field. The action is delivered through S3 to the object.',
    appliesTo: ['incomplete', 'insufficient'],
  },
  {
    number: '1.1.4',
    class: 'build',
    title: 'Build a chain Su-Field',
    description: 'Build a chain of Su-Field models so that the action propagates through multiple substances.',
    appliesTo: ['incomplete', 'insufficient'],
  },
  {
    number: '1.2.1',
    class: 'destroy',
    title: 'Introduce S3 to absorb the harmful effect',
    description: 'Add a third substance between S1 and S2 that intercepts and absorbs the harmful interaction. S3 should be inexpensive and easy to replace.',
    appliesTo: ['harmful'],
  },
  {
    number: '1.2.2',
    class: 'destroy',
    title: 'Modify S1 or S2 to eliminate harm',
    description: 'Change the state of S1 or S2 (concentration, temperature, structure) so the harmful interaction is no longer possible while the useful action is preserved.',
    appliesTo: ['harmful'],
  },
  {
    number: '1.2.3',
    class: 'destroy',
    title: 'Replace the harmful field',
    description: 'Substitute the field with another type that delivers the useful action but does not produce the harmful effect.',
    appliesTo: ['harmful'],
  },
  {
    number: '1.2.4',
    class: 'destroy',
    title: 'Apply a counter-field to neutralize the harmful effect',
    description: 'Introduce a second field that cancels or opposes the harmful component while preserving the useful effect.',
    appliesTo: ['harmful'],
  },
  {
    number: '1.2.5',
    class: 'destroy',
    title: 'Remove S1 from the interaction zone',
    description: 'Physically separate S1 from S2 so the harmful interaction cannot occur. Use a barrier, gap, or intermittent contact.',
    appliesTo: ['harmful'],
  },
  {
    number: '1.2.6',
    class: 'destroy',
    title: 'Make S1 inert or self-protecting',
    description: 'Change the material of S1 so it is no longer affected by the field (e.g., add a coating, use a corrosion-resistant alloy).',
    appliesTo: ['harmful'],
  },
  {
    number: '2.1.1',
    class: 'develop_complex',
    title: 'Transition to a chain Su-Field',
    description: 'Convert the existing Su-Field into a chain model with an added substance that enables the next step of the action.',
    appliesTo: ['complete', 'insufficient'],
  },
  {
    number: '2.1.2',
    class: 'develop_complex',
    title: 'Transition to a complex Su-Field',
    description: 'Add S3 (internal or external) to the existing model so the action is more controlled or more intense.',
    appliesTo: ['complete', 'insufficient'],
  },
  {
    number: '2.1.3',
    class: 'develop_complex',
    title: 'Use a bi-gradient or ferro-magnetic material',
    description: 'Replace the substance with a bi-gradient material (e.g., variable conductivity, permeability) so the field produces a graduated response.',
    appliesTo: ['complete', 'insufficient'],
  },
  {
    number: '2.1.4',
    class: 'develop_complex',
    title: 'Use a capillary or porous substance',
    description: 'Substitute a porous or capillary-active material for the solid substance to intensify the field effect via surface area.',
    appliesTo: ['complete', 'insufficient'],
  },
  {
    number: '2.2.1',
    class: 'develop_enhance',
    title: 'Increase field intensity',
    description: 'Raise the magnitude of the field (e.g., higher voltage, stronger magnet, hotter flame) until the desired effect is achieved.',
    appliesTo: ['insufficient', 'complete'],
  },
  {
    number: '2.2.2',
    class: 'develop_enhance',
    title: 'Add a second field that magnifies the first',
    description: 'Introduce a second field that amplifies the action of the first (e.g., magnetic + thermal, electric + chemical).',
    appliesTo: ['insufficient'],
  },
  {
    number: '2.2.3',
    class: 'develop_enhance',
    title: 'Use a more responsive substance',
    description: 'Replace S1 or S2 with a substance that has higher coupling to the field (higher permeability, conductivity, reactivity).',
    appliesTo: ['insufficient'],
  },
  {
    number: '2.2.4',
    class: 'develop_enhance',
    title: 'Apply the field in pulses or periodically',
    description: 'Modulate the field as a pulse, periodic, or resonant pattern to overcome threshold effects or trigger phase transitions.',
    appliesTo: ['insufficient', 'excessive'],
  },
  {
    number: '2.2.5',
    class: 'develop_enhance',
    title: 'Use a structural or phase-transition effect',
    description: 'Replace a constant field with one that exploits a phase change (e.g., solid-liquid, ferromagnetic transition) for a more intense, focused effect.',
    appliesTo: ['insufficient', 'excessive'],
  },
  {
    number: '2.2.10',
    class: 'develop_enhance',
    title: 'Dynamize the substance or field',
    description: 'Allow S1, S2, or the field to change over time (movable, adjustable, switchable) so the action adapts to operating conditions.',
    appliesTo: ['complete', 'excessive'],
  },
  {
    number: '2.2.11',
    class: 'develop_enhance',
    title: 'Align the field with the structure of the object',
    description: 'Shape or orient the field to match the geometry of the object (anisotropic field, focused beam, polarized wave) for efficient coupling.',
    appliesTo: ['complete', 'excessive'],
  },
  {
    number: '3.1.1',
    class: 'transition',
    title: 'Phase transition 1: replace a phase state',
    description: 'Switch one of the substances to a different phase (solid → liquid → gas → plasma) to change the interaction regime.',
    appliesTo: ['complete', 'excessive', 'harmful'],
  },
  {
    number: '3.1.2',
    class: 'transition',
    title: 'Phase transition 2: dual-phase substance',
    description: 'Use a substance that exists in two phases simultaneously (e.g., a slurry, suspension, or two-component material) for combined properties.',
    appliesTo: ['complete', 'excessive'],
  },
  {
    number: '3.1.3',
    class: 'transition',
    title: 'Phase transition 3: leverage a phase-change effect',
    description: 'Exploit the volume, energy, or surface effects that occur at the boundary of a phase change.',
    appliesTo: ['complete'],
  },
  {
    number: '4.1.1',
    class: 'detect',
    title: 'Detect the substance or field indirectly',
    description: 'Add an indicator substance or a secondary field whose response is easy to measure, instead of measuring the original interaction directly.',
    appliesTo: ['complete', 'incomplete'],
  },
  {
    number: '4.1.2',
    class: 'detect',
    title: 'Measure the field by its effect on a reference',
    description: 'Use a reference substance whose response to the field is well-known to infer the field magnitude.',
    appliesTo: ['complete', 'insufficient'],
  },
  {
    number: '5.1.1',
    class: 'strategy',
    title: 'Change the system to bypass the problem',
    description: 'If a contradiction cannot be resolved at the current scale, perform the useful action at a different scale (micro/macro) or at a different time.',
    appliesTo: ['harmful', 'excessive', 'insufficient'],
  },
  {
    number: '5.1.2',
    class: 'strategy',
    title: 'Trimming — remove the least useful elements',
    description: 'Identify the substance or component contributing least to the useful function and remove or simplify it.',
    appliesTo: ['excessive', 'harmful'],
  },
];

const BY_TYPE: Record<string, StandardSolution[]> = {
  incomplete: [],
  complete: [],
  harmful: [],
  insufficient: [],
  excessive: [],
};

for (const s of STANDARD_SOLUTIONS) {
  for (const t of s.appliesTo) {
    if (!BY_TYPE[t]) BY_TYPE[t] = [];
    BY_TYPE[t].push(s);
  }
}

export function getStandardSolutionsFor(type: StandardSolution['appliesTo'][number], max: number = 8): StandardSolution[] {
  return (BY_TYPE[type] ?? []).slice(0, max);
}

export const CLASS_LABELS: Record<StandardSolutionClass, string> = {
  build: 'Class 1.1 — Build Su-Field',
  destroy: 'Class 1.2 — Destroy harmful Su-Field',
  develop_complex: 'Class 2.1 — Develop into complex Su-Field',
  develop_enhance: 'Class 2.2 — Develop / enhance Su-Field',
  transition: 'Class 3 — Phase transitions',
  detect: 'Class 4 — Detection and measurement',
  strategy: 'Class 5 — Strategies and trimming',
};

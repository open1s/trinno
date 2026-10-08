import { composePrompt, withInvariants } from './contract.js';
import { definePrompt } from './registry.js';

/**
 * Slash-command prompts: the AutoResearch scope/eval planner and the
 * context-capacity probe (a deliberate self-test, not a user task).
 */

// ── planner.autoresearch.scope-eval ──────────────────────────────────────
const AUTO_PLANNER_BODY: string[] = [
  "## Files to generate",
  "1. scope.md — research scope, constraints, success criteria, allowed mutation surface, termination conditions.",
  "2. eval.md — evaluation metrics, validation protocol, baseline, accept/reject criteria.",
  "",
  "Use the hypothesis to infer the domain, metrics and constraints. Be specific and actionable: fill every template field with a concrete value derived from the hypothesis. Never leave a placeholder.",
];
const AUTO_PLANNER_OUTPUT: string[] = [
  "Return the two documents in exactly this format, with no text before or after:",
  "===SCOPE===",
  "[markdown content for scope.md]",
  "===EVAL===",
  "[markdown content for eval.md]",
];
export const buildAutoScopeEvalPrompt = definePrompt(
  {
    id: 'planner.autoresearch.scope-eval',
    kind: 'planner',
    enforcedBy: ['L0', 'L1', 'L2', 'L3'],
    invariants: 'core',
    maxChars: 2000,
    requiredSections: ['## Files to generate', '## Output Contract', '===SCOPE==='],
    usedBy: 'src/bos/slash-commands/auto.ts generateScopeAndEval (L0/L2: the caller splits on ===SCOPE=== / ===EVAL===)',
  },
  () =>
    composePrompt({
      role: 'You are a research planning expert. Given a research hypothesis, you generate two files.',
      mission: 'Turn a one-line hypothesis into an executable, falsifiable experiment protocol.',
      body: AUTO_PLANNER_BODY.join('\n'),
      outputContract: AUTO_PLANNER_OUTPUT.join('\n'),
    }),
);

// ── probe.context.historian ──────────────────────────────────────────────
/**
 * Deliberately unrelated to the workspace: the probe measures whether the
 * model still engages at a given context size. Uses the minimal probe
 * invariant set — the full agent contract would falsify the measurement.
 */
export const HISTORIAN_PROBE_PROMPT: string = definePrompt(
  {
    id: 'probe.context.historian',
    kind: 'task',
    enforcedBy: ['L1', 'L3'],
    invariants: 'probe',
    maxChars: 700,
    requiredSections: ['You are a helpful historian'],
    usedBy: 'src/bos/slash-commands/ping.ts probeContextLimit — context-capacity self-test',
  },
  () => withInvariants('You are a helpful historian.', 'probe'),
)();

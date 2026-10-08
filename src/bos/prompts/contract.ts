/**
 * Prompt contract — the single place that defines how prompts are assembled and
 * how strictly each rule is enforced.
 *
 * Adherence tiers (a single mechanism is not enough — use the lowest tier that
 * can actually enforce the rule):
 *
 *   L0 contract    machine-enforced: tool parameter schemas, parser shapes,
 *                  code guards. A prompt must never be the only defence for a
 *                  rule that code can enforce.
 *   L1 invariant   a short, non-negotiable block injected into every prompt of
 *                  a kind. Cheap to read, impossible to forget.
 *   L2 guard       runtime validation of model output: parse, repair at most
 *                  once, then fail loudly instead of trusting the text.
 *   L3 drift test  src/test/suite/prompt-contract.test.ts. Fails when a prompt
 *                  loses a required section, an invariant, a declared JSON key,
 *                  or grows past its budget.
 *
 * Every prompt in this module is assembled through `composePrompt` and
 * registered with `definePrompt` so the drift test can see it.
 */

/** Bump when any prompt body changes; lets a session pinpoint its prompt set. */
export const PROMPT_VERSION = '2026-10-08.1';

export type PromptKind = 'system' | 'task' | 'extractor' | 'writer' | 'planner';

/**
 * L1 invariants for conversational / tool-driving prompts. Kept deliberately
 * short: this block rides on every single model call.
 */
export const CORE_INVARIANTS = [
  'EVIDENCE — every factual claim traces to a tool result, a file path, or a URL. If it cannot be checked, write "unverifiable"; never guess.',
  'NO FABRICATION — never invent citations, DOIs, measurements, parameters, file contents, or tool output.',
  'TOOL TRUTH — call only tools that exist, and never describe a tool result that did not happen.',
  'FAILURE — after two failed attempts at the same action, stop, report the exact error, and ask for corrected input.',
].join('\n');

/**
 * L1 invariants for extractors: the model output is parsed by code (L2), so the
 * contract is about shape and traceability rather than prose behaviour.
 */
export const DATA_INVARIANTS = [
  'NO FABRICATION — never invent a value. If a field cannot be filled from the provided input, use null and explain why in "notes".',
  'EVIDENCE — every non-null value must be traceable to the provided input.',
  'EXACT SHAPE — emit exactly the declared JSON object: no extra keys, no markdown fence, no prose before or after it.',
].join('\n');

export const PROBE_INVARIANTS = [
  'This call is a self-test probe of context capacity, not a user task: answer the question directly and do not call tools.',
].join('\n');

export const INVARIANT_SETS = { core: CORE_INVARIANTS, data: DATA_INVARIANTS, probe: PROBE_INVARIANTS } as const;
export type InvariantSetName = keyof typeof INVARIANT_SETS;

/** Marker the drift test greps for; must be present in every registered prompt. */
export const INVARIANT_MARKER = 'NON-NEGOTIABLE INVARIANTS';

/** Append the L1 block (idempotent). */
export function withInvariants(body: string, set: InvariantSetName = 'core'): string {
  const text = body.trimEnd();
  if (text.includes(INVARIANT_MARKER)) return text;
  return `${text}\n\n### ${INVARIANT_MARKER}\n${INVARIANT_SETS[set]}\n`;
}

export interface PromptBlocks {
  /** Opening sentence: identity, one or two lines. */
  role?: string;
  /** What the prompt must achieve, not how. */
  mission?: string;
  /** Ordered method / rules of engagement (free-form markdown). */
  body?: string;
  /** The shape of the answer the caller will consume. */
  outputContract?: string;
  invariants?: InvariantSetName;
}

/**
 * Assemble a prompt with a stable skeleton:
 *   role → ## Mission → body → ## Output Contract → ### NON-NEGOTIABLE INVARIANTS
 * Keeping the order fixed is what makes the drift test meaningful.
 */
export function composePrompt(blocks: PromptBlocks): string {
  const parts: string[] = [];
  if (blocks.role) parts.push(blocks.role.trim());
  if (blocks.mission) parts.push(`## Mission\n${blocks.mission.trim()}`);
  if (blocks.body) parts.push(blocks.body.trim());
  if (blocks.outputContract) parts.push(`## Output Contract\n${blocks.outputContract.trim()}`);
  return withInvariants(parts.join('\n\n'), blocks.invariants ?? 'core');
}

/** Rough token estimate used by the budget check (≈4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

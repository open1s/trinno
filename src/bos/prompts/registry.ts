import type { InvariantSetName, PromptKind } from './contract.js';

/** Highest tier at which this prompt is actually enforced. */
export type AdherenceTier = 'L0' | 'L1' | 'L2' | 'L3';

export interface PromptMeta {
  /** Stable dotted id, e.g. `chat.persona.fallback`. */
  id: string;
  kind: PromptKind;
  /**
   * Every tier that actually enforces this prompt. L0 = tool schema /
   * parser shape, L1 = injected invariant block, L2 = runtime validation of
   * the model output, L3 = drift test. Recording all of them is the point:
   * a prompt-only rule (L1) is a weaker promise than a parsed one (L2).
   */
  enforcedBy: AdherenceTier[];
  invariants: InvariantSetName;
  /** Hard ceiling for the rendered text; the drift test fails above it. */
  maxChars: number;
  /** Headings that must survive edits (anti-drift anchors). */
  requiredSections: string[];
  /** For extractors: JSON keys the caller parses; the prompt must name them. */
  jsonKeys?: string[];
  /**
   * Tools the prompt names. The drift test checks every one against the real
   * defineTool() definitions, so a renamed or deleted tool fails the build.
   */
  namesTools?: string[];
  /** Representative args so the drift test can render a parameterised prompt. */
  sampleArgs?: any[];
  /** Where this prompt is sent from — for humans debugging a regression. */
  usedBy: string;
}

interface Entry {
  meta: PromptMeta;
  build: (...args: any[]) => string;
}

const entries = new Map<string, Entry>();

/**
 * Register a prompt builder. Throws on a duplicate id so an accidental
 * fork of the same prompt is caught at import time, not in production.
 */
export function definePrompt<A extends unknown[]>(
  meta: PromptMeta,
  build: (...args: A) => string,
): (...args: A) => string {
  if (entries.has(meta.id)) {
    throw new Error(`duplicate prompt id: ${meta.id}`);
  }
  entries.set(meta.id, { meta, build: build as unknown as (...args: any[]) => string });
  return build;
}

export function listPrompts(): Entry[] {
  return [...entries.values()].sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

export function getPromptMeta(id: string): PromptMeta | undefined {
  return entries.get(id)?.meta;
}

export function promptIds(): string[] {
  return listPrompts().map(e => e.meta.id);
}

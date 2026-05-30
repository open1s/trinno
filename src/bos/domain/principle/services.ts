import { INVENTIVE_PRINCIPLES, InventivePrinciple, getPrincipleByIndex } from '../principle/entity.js';

export interface PrincipleCombination {
  principles: InventivePrinciple[];
  combinedDescription: string;
  synergy: string;
}

export interface ScoredPrinciple {
  principle: InventivePrinciple;
  relevance: number;
  matchedTokens: string[];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9一-鿿]+/g).filter(t => t.length > 0);
}

function fuzzyTokenMatch(needle: string, haystack: string): boolean {
  if (haystack.includes(needle)) return true;
  if (needle.length < 4) return false;
  const threshold = Math.max(1, Math.floor(needle.length / 4));
  return haystack.split(/[^a-z0-9一-鿿]+/g).some(word => {
    if (word.length < 3) return false;
    return levenshtein(needle, word) <= threshold;
  });
}

function scorePrinciple(p: InventivePrinciple, tokens: string[]): { score: number; matched: string[] } {
  if (tokens.length === 0) return { score: 0, matched: [] };
  const name = p.name.toLowerCase();
  const nameZh = p.nameZh;
  const desc = p.description.toLowerCase();
  const descZh = p.descriptionZh;
  const examples = p.examples.map(e => e.toLowerCase());

  let total = 0;
  const matched: string[] = [];

  for (const t of tokens) {
    let tokenScore = 0;

    if (name === t) tokenScore = Math.max(tokenScore, 12);
    if (name.startsWith(t)) tokenScore = Math.max(tokenScore, 8);
    if (name.includes(t)) tokenScore = Math.max(tokenScore, 6);

    if (nameZh.includes(t)) tokenScore = Math.max(tokenScore, 6);

    if (desc.includes(t)) tokenScore = Math.max(tokenScore, 3);
    if (descZh.includes(t)) tokenScore = Math.max(tokenScore, 3);

    for (const ex of examples) {
      if (ex.includes(t)) {
        tokenScore = Math.max(tokenScore, 2);
        break;
      }
    }

    if (tokenScore === 0) {
      if (fuzzyTokenMatch(t, name)) tokenScore = Math.max(tokenScore, 4);
      else if (fuzzyTokenMatch(t, desc)) tokenScore = Math.max(tokenScore, 2);
      else if (fuzzyTokenMatch(t, examples.join(' '))) tokenScore = Math.max(tokenScore, 1);
    }

    if (tokenScore > 0) {
      total += tokenScore;
      matched.push(t);
    }
  }

  const coverage = matched.length / tokens.length;
  return { score: total * (0.5 + 0.5 * coverage), matched };
}

export class PrincipleEngine {
  getPrinciple(index: number): InventivePrinciple | undefined {
    return getPrincipleByIndex(index);
  }

  getAllPrinciples(): ReadonlyArray<InventivePrinciple> {
    return INVENTIVE_PRINCIPLES;
  }

  searchPrinciples(query: string, opts: { limit?: number; minScore?: number } = {}): InventivePrinciple[] {
    return this.searchPrinciplesScored(query, opts).map(s => s.principle);
  }

  searchPrinciplesScored(query: string, opts: { limit?: number; minScore?: number } = {}): ScoredPrinciple[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const minScore = opts.minScore ?? 0;
    const limit = opts.limit ?? 40;

    const scored: ScoredPrinciple[] = [];
    for (const p of INVENTIVE_PRINCIPLES) {
      const { score, matched } = scorePrinciple(p, tokens);
      if (score > minScore) {
        scored.push({ principle: p, relevance: Math.round(score * 10) / 10, matchedTokens: matched });
      }
    }

    scored.sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      if (b.matchedTokens.length !== a.matchedTokens.length) {
        return b.matchedTokens.length - a.matchedTokens.length;
      }
      return a.principle.index - b.principle.index;
    });

    return scored.slice(0, limit);
  }

  combinePrinciples(indices: number[]): PrincipleCombination {
    const principles = indices
      .map(i => getPrincipleByIndex(i))
      .filter((p): p is InventivePrinciple => p !== undefined);

    if (principles.length === 0) {
      throw new Error('No valid principles found for combination');
    }

    const names = principles.map(p => p.name).join(' + ');
    return {
      principles,
      combinedDescription: `Combined approach using: ${names}`,
      synergy: `Applying ${principles.length} principles together may yield emergent solutions not possible with individual principles alone.`,
    };
  }

  getPrincipleExamples(index: number): string[] {
    const principle = getPrincipleByIndex(index);
    return principle ? principle.examples : [];
  }
}

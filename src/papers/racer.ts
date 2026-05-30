import type { PaperSource, ParsedIdentifier, SourceCandidate } from './types';

export interface RaceOptions {
  identifier: ParsedIdentifier;
  sources: PaperSource[];
  signal?: AbortSignal;
  onSourceStart?: (source: string) => void;
  onSourceFail?: (source: string, error: string) => void;
}

export interface RaceResult {
  winner: SourceCandidate;
  failures: { source: string; error: string }[];
}

export async function raceSources(opts: RaceOptions): Promise<RaceResult | null> {
  const { identifier, sources, signal, onSourceStart, onSourceFail } = opts;

  const failures: { source: string; error: string }[] = [];
  const candidates = sources
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((source) => {
      const run = async (): Promise<SourceCandidate | null> => {
        if (signal?.aborted) return null;
        onSourceStart?.(source.name);
        try {
          return await source.resolve(identifier, signal);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ source: source.name, error: msg });
          onSourceFail?.(source.name, msg);
          return null;
        }
      };
      return { source, run };
    });

  if (candidates.length === 0) return null;

  return new Promise<RaceResult | null>((resolve) => {
    let settled = false;
    const remaining = new Set(candidates.map((_, i) => i));
    let onAbort: (() => void) | null = null;

    const finish = (winner: SourceCandidate | null) => {
      if (settled) return;
      settled = true;
      if (onAbort && signal) {
        signal.removeEventListener('abort', onAbort);
        onAbort = null;
      }
      if (!winner) {
        resolve(null);
        return;
      }
      resolve({ winner, failures });
    };

    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i]!;
      entry.run().then((result) => {
        if (!remaining.has(i)) return;
        remaining.delete(i);
        if (result) {
          finish(result);
        } else if (remaining.size === 0) {
          finish(null);
        }
      });
    }

    if (signal) {
      onAbort = () => finish(null);
      if (signal.aborted) {
        finish(null);
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

import type { PaperSource, ParsedIdentifier, SourceCandidate } from './types';

export interface RaceOptions {
  identifier: ParsedIdentifier;
  sources: PaperSource[];
  signal?: AbortSignal;
  onSourceStart?: (source: string) => void;
  onSourceFail?: (source: string, error: string) => void;
}

export interface RaceResult {
  candidates: SourceCandidate[];
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

  const RACE_WINDOW_MS = 200;

return new Promise<RaceResult | null>((resolve) => {
    let settled = false;
    const resolved: SourceCandidate[] = [];
    let windowTimer: NodeJS.Timeout | null = null;
    let candidateCount = 0;
    let pendingCandidates = candidates.length;

    const onAbortHandler = () => {
      if (settled) return;
      settled = true;
      if (windowTimer) clearTimeout(windowTimer);
signal?.removeEventListener('abort', onAbortHandler);
      resolve(null);
    };

    const checkFinish = () => {
      if (settled) return;
      if (candidateCount >= pendingCandidates) {
        if (resolved.length > 0) {
          settled = true;
          if (windowTimer) clearTimeout(windowTimer);
          signal?.removeEventListener('abort', onAbortHandler);
          resolve({ candidates: resolved, failures });
        } else {
          settled = true;
          if (windowTimer) clearTimeout(windowTimer);
          signal?.removeEventListener('abort', onAbortHandler);
          resolve(null);
        }
      }
    };

    const finishNow = () => {
      if (settled) return;
      settled = true;
      if (windowTimer) clearTimeout(windowTimer);
      signal?.removeEventListener('abort', onAbortHandler);
      if (resolved.length > 0) {
        resolve({ candidates: resolved, failures });
      } else {
        resolve(null);
      }
    };

    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i]!;
      entry.run().then((result) => {
        candidateCount++;
        if (result) {
          resolved.push(result);
          if (resolved.length === 1) {
            windowTimer = setTimeout(finishNow, RACE_WINDOW_MS);
          }
        }
        checkFinish();
      });
    }

    if (signal) {
      if (signal.aborted) {
        finishNow();
        return;
      }
      signal.addEventListener('abort', onAbortHandler, { once: true });
    }
  });
}

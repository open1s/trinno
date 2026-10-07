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

  // Internal controller: aborted as soon as the race settles so losing sources
  // stop downloading instead of running to completion in the background.
  const raceCtrl = new AbortController();
  const abortRace = (): void => { try { raceCtrl.abort(); } catch { /* ignore */ } };
  const onExternalAbort = (): void => abortRace();
  const cleanupSignal = (): void => { signal?.removeEventListener('abort', onExternalAbort); };

  if (signal) {
    if (signal.aborted) return null;
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const effSignal = raceCtrl.signal;

  const candidates = sources
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((source) => {
      const run = async (): Promise<SourceCandidate | null> => {
        if (effSignal.aborted) return null;
        onSourceStart?.(source.name);
        try {
          return await source.resolve(identifier, effSignal);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          // Sources killed by our own settle/abort are not real failures, and
          // must not mutate race state or emit progress after it settled.
          if (!effSignal.aborted) {
            failures.push({ source: source.name, error: msg });
            onSourceFail?.(source.name, msg);
          }
          return null;
        }
      };
      return { source, run };
    });

  if (candidates.length === 0) {
    cleanupSignal();
    return null;
  }

  const RACE_WINDOW_MS = 200;

  return new Promise<RaceResult | null>((resolve) => {
    let settled = false;
    const resolved: SourceCandidate[] = [];
    let windowTimer: NodeJS.Timeout | null = null;
    let candidateCount = 0;
    let pendingCandidates = candidates.length;

    const settle = (result: RaceResult | null): void => {
      if (settled) return;
      settled = true;
      if (windowTimer) clearTimeout(windowTimer);
      cleanupSignal();
      signal?.removeEventListener('abort', onAbortHandler);
      abortRace();
      resolve(result);
    };

    const onAbortHandler = (): void => {
      settle(null);
    };

    const checkFinish = (): void => {
      if (settled) return;
      if (candidateCount >= pendingCandidates) {
        settle(resolved.length > 0 ? { candidates: resolved, failures } : null);
      }
    };

    const finishNow = (): void => {
      settle(resolved.length > 0 ? { candidates: resolved, failures } : null);
    };

    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i]!;
      entry.run().then((result) => {
        if (settled) return;
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

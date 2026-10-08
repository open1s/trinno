/**
 * Cancel targeting for superseded generations.
 *
 * A cancel that names a generation which is no longer the current one is stale:
 * the turn it meant to stop has already been superseded (e.g. the user forced a
 * queued message past it). Aborting on such a cancel would kill the newer
 * request before it reaches the model — the round then ends with 0 tokens and
 * the panel is left showing a generation that never finishes.
 *
 * A cancel without a target is never stale: legacy callers mean "stop whatever
 * is running".
 */
export function isStaleCancel(
  targetMessageId: string | null | undefined,
  currentMessageId: string | null,
): boolean {
  return Boolean(targetMessageId && currentMessageId && targetMessageId !== currentMessageId);
}

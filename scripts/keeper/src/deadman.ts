/**
 * Triggered-but-stuck dead-man counter (L0-19).
 *
 * An order whose execute simulation SUCCEEDS is "triggered" — it should be
 * gone (executed/cancelled) within a cycle or two. One that stays pending
 * across TRIGGERED_STUCK_ALERT_CYCLES consecutive cycles means executions
 * are not landing (RPC dead, fee starvation, sequence pinning) — exactly
 * the silent failure mode a single-keeper deployment cannot see.
 *
 * Pure and offline-testable (npm run smoke); the caller owns the Map.
 */

/**
 * Advance the stuck counters with this cycle's triggered order ids.
 * - ids in `triggered` get their count incremented;
 * - ids NOT in `triggered` are pruned (executed, cancelled, or no longer
 *   triggering — either way, not stuck);
 * - returns the ids whose count reached `threshold` EXACTLY this call
 *   (fire-once semantics; the alert layer's dedupe handles any repeats).
 */
export function trackTriggeredStuck(
  counts: Map<string, number>,
  triggered: ReadonlySet<string>,
  threshold: number,
): string[] {
  for (const id of counts.keys()) {
    if (!triggered.has(id)) counts.delete(id);
  }
  const newlyStuck: string[] = [];
  for (const id of triggered) {
    const next = (counts.get(id) ?? 0) + 1;
    counts.set(id, next);
    if (next === threshold) newlyStuck.push(id);
  }
  return newlyStuck;
}

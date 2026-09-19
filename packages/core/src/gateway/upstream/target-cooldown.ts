// A provider that answered 429 or 402 will answer the same way for the next
// request, so the chain has to remember it. The credential pool has a cooldown
// of its own, but it is keyed by credential and ranks keys inside one provider;
// it is inert for a provider configured with a bare api_key and it never drops
// a chain entry. This store is keyed by the chain selector instead, which is
// the exact thing that failed, so a model with its own separate quota is never
// skipped on a sibling model's behalf.

type TargetCooldown = {
  /** Consecutive failures since this target last answered. */
  failures: number;
  until: number;
};

const cooldowns = new Map<string, TargetCooldown>();

const maxTargetCooldownMs = 30 * 60_000;

/** Doubling stops here; beyond it the cap decides. */
const maxBackoffShift = 6;

/**
 * How long to sideline a target, given how many times in a row it has failed.
 *
 * A flat duration makes a chain forget. A target that fails every time was
 * sidelined for the same interval on its fiftieth failure as on its first, so
 * it returned to the chain every interval, all day, and every request behind
 * it paid an attempt. Measured 2026-09-19: OVH answered nothing in 591
 * requests over fourteen days while holding more chain entries than any other
 * provider, and most requests were walking three dead entries before one
 * answered.
 *
 * Doubling per consecutive failure makes the chain demote a dead target by
 * itself, and `clearTargetCooldown` on a success drops the streak, so a
 * recovered target returns immediately rather than waiting out a long
 * cooldown. Nobody edits the chain to work around a provider being down.
 */
export function targetCooldownDurationMs(baseMs: number, failures: number): number {
  const shift = Math.min(Math.max(failures, 1) - 1, maxBackoffShift);
  return Math.min(baseMs * 2 ** shift, maxTargetCooldownMs);
}

export function markTargetCoolingDown(target: string | undefined, durationMs: number): void {
  if (!target || !Number.isFinite(durationMs) || durationMs <= 0) return;
  const previous = cooldowns.get(target);
  const failures = (previous?.failures ?? 0) + 1;
  const until = Date.now() + targetCooldownDurationMs(durationMs, failures);
  // Never shorten a cooldown another response already earned, but always keep
  // the failure count, or the streak resets on a shorter later reading.
  if (previous && previous.until >= until) {
    cooldowns.set(target, { failures, until: previous.until });
    return;
  }
  cooldowns.set(target, { failures, until });
}

export function targetCooldownRemainingMs(target: string | undefined): number {
  if (!target) return 0;
  const entry = cooldowns.get(target);
  if (entry === undefined) return 0;
  const now = Date.now();
  if (entry.until <= now) {
    // The window lapses but the streak does not: a target that has failed ten
    // times running is still a bad bet, and only answering proves otherwise.
    cooldowns.set(target, { failures: entry.failures, until: 0 });
    return 0;
  }
  return entry.until - now;
}

export function clearTargetCooldown(target: string | undefined): void {
  if (target) cooldowns.delete(target);
}

export function resetTargetCooldownsForTest(): void {
  cooldowns.clear();
}

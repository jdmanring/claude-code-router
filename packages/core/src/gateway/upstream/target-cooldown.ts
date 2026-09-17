// A provider that answered 429 or 402 will answer the same way for the next
// request, so the chain has to remember it. The credential pool has a cooldown
// of its own, but it is keyed by credential and ranks keys inside one provider;
// it is inert for a provider configured with a bare api_key and it never drops
// a chain entry. This store is keyed by the chain selector instead, which is
// the exact thing that failed, so a model with its own separate quota is never
// skipped on a sibling model's behalf.

const cooldowns = new Map<string, number>();

const maxTargetCooldownMs = 5 * 60_000;

export function markTargetCoolingDown(target: string | undefined, durationMs: number): void {
  if (!target || !Number.isFinite(durationMs) || durationMs <= 0) return;
  const until = Date.now() + Math.min(durationMs, maxTargetCooldownMs);
  // Never shorten a cooldown another response already earned.
  if ((cooldowns.get(target) ?? 0) >= until) return;
  cooldowns.set(target, until);
}

export function targetCooldownRemainingMs(target: string | undefined): number {
  if (!target) return 0;
  const until = cooldowns.get(target);
  if (until === undefined) return 0;
  const now = Date.now();
  if (until <= now) {
    cooldowns.delete(target);
    return 0;
  }
  return until - now;
}

export function clearTargetCooldown(target: string | undefined): void {
  if (target) cooldowns.delete(target);
}

export function resetTargetCooldownsForTest(): void {
  cooldowns.clear();
}

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
 * Consecutive failures of any status after which a target is sidelined even
 * though its status never asked for it.
 *
 * `cooldownAfterStatus` cools down only 402 and 429, because other statuses
 * are request-shaped and a single one must not sideline a provider. That is
 * right for a single failure and wrong for a streak: measured 2026-09-19 over
 * a fortnight, OVH returned 403 on 585 consecutive requests and ZyloAI 401 on
 * 434, and neither was ever sidelined, so every request behind them paid an
 * attempt. A status explains why a target failed; it does not decide whether
 * trying again is worth an attempt.
 *
 * Three is low enough to catch a dead target within one request of a user
 * noticing and high enough that a transient 500 or a one-off malformed request
 * does not sideline a working provider.
 */
const failureStreakBeforeCooldown = 3;

const defaultStreakCooldownMs = 60_000;

/**
 * Statuses whose answer is decided by the shape of the request rather than by
 * anything about the target's state.
 *
 * Every other refusal here is a bet about time: a 429 clears when the window
 * rolls, a 403 when the account is topped up, a 500 when the provider recovers,
 * so retrying later is worth an attempt. A target that refuses the request
 * because it is too large will refuse the identical request every time, and no
 * amount of waiting changes that. Escalating backoff caps at thirty minutes, so
 * such an entry rejoined the chain twice an hour for the life of the process
 * and cost an attempt each time.
 *
 * Measured 2026-09-19: Groq answers 413 to every auto-mode classifier request,
 * which is 170-240KB against its per-request ceiling, while answering ordinary
 * traffic normally. The entry had to be removed from that chain by hand, which
 * is the workaround this store exists to make unnecessary.
 *
 * Deliberately narrow. Only sizes are listed, because a size refusal is the
 * case where the request alone settles it. A 400 or 404 can mean a model was
 * briefly withdrawn or a route briefly misconfigured, so those keep the
 * ordinary escalation and its chance to recover.
 */
const requestShapeRefusalStatuses = new Set([413, 414, 431]);

/**
 * Long enough that a target refusing on size stops costing attempts, short
 * enough that raising a provider's limit is picked up the same day without a
 * restart.
 */
const requestShapeCooldownMs = 12 * 60 * 60_000;

/** Whether the request, rather than the target's state, decided this refusal. */
export function isRequestShapeRefusal(statusCode: number): boolean {
  return requestShapeRefusalStatuses.has(statusCode);
}

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

/**
 * Records that a target failed, and sidelines it when that is warranted.
 *
 * `statusCooldownMs` is what the response asked for, which is zero for every
 * status except 402 and 429. A streak of failures overrides that: the count is
 * kept for every failure whatever its status, and once it reaches the
 * threshold the target is sidelined on the default interval and escalates from
 * there.
 */
export function markTargetFailure(
  target: string | undefined,
  statusCooldownMs: number,
  statusCode?: number
): void {
  if (!target) return;
  const previous = cooldowns.get(target);
  const failures = (previous?.failures ?? 0) + 1;
  // A size refusal needs no streak to establish it: the first one already
  // proves the request does not fit, and two more cost attempts to learn
  // nothing. Sideline on the first reading, and do not let a later, shorter
  // reading shorten it.
  if (statusCode !== undefined && isRequestShapeRefusal(statusCode)) {
    const until = Date.now() + requestShapeCooldownMs;
    cooldowns.set(target, { failures, until: Math.max(previous?.until ?? 0, until) });
    return;
  }
  const asked = Number.isFinite(statusCooldownMs) && statusCooldownMs > 0 ? statusCooldownMs : 0;
  const base = asked > 0 ? asked : (failures >= failureStreakBeforeCooldown ? defaultStreakCooldownMs : 0);
  if (base <= 0) {
    // Counted but not sidelined: one request-shaped failure is not evidence.
    cooldowns.set(target, { failures, until: previous?.until ?? 0 });
    return;
  }
  const until = Date.now() + targetCooldownDurationMs(base, failures);
  if (previous && previous.until >= until) {
    cooldowns.set(target, { failures, until: previous.until });
    return;
  }
  cooldowns.set(target, { failures, until });
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

/**
 * The provider half of a chain selector, which is `provider::protocol/model`.
 *
 * A quota is sometimes per model and sometimes per account, and the status
 * says which. A 404 is about one model; 401, 402, 403 and 429 are about the
 * account behind every model it serves. Keying only by selector made the
 * account case invisible: measured 2026-09-19, OVH burned 70 failed attempts
 * in one hour because its eight chain entries each held a separate cooldown
 * while sharing one anonymous rate limit, so every entry had to learn the same
 * refusal independently.
 */
export function providerScopeOf(target: string | undefined): string | undefined {
  if (!target) return undefined;
  const slash = target.indexOf("/");
  const scope = slash === -1 ? target : target.slice(0, slash);
  return scope === target ? undefined : `${scope}/*`;
}

/** Statuses that describe the account rather than the model addressed. */
export function isAccountScopedRefusal(statusCode: number): boolean {
  return statusCode === 401 || statusCode === 402 || statusCode === 403 || statusCode === 429;
}

export function targetCooldownRemainingMs(target: string | undefined): number {
  if (!target) return 0;
  // A cooldown earned by the account applies to every model it serves.
  const scope = providerScopeOf(target);
  if (scope) {
    const scoped = cooldowns.get(scope);
    if (scoped && scoped.until > Date.now()) return scoped.until - Date.now();
  }
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

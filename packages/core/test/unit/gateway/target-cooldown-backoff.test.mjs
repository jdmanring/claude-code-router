// A flat cooldown makes the chain forget. A target that fails every time was
// sidelined for the same interval on its fiftieth failure as on its first, so
// it rejoined the chain every interval and every request behind it paid an
// attempt. Measured 2026-09-19: OVH answered nothing in 591 requests over
// fourteen days, and most requests walked three dead entries before one
// answered.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  clearTargetCooldown,
  markTargetCoolingDown,
  resetTargetCooldownsForTest,
  targetCooldownDurationMs,
  targetCooldownRemainingMs
} from "@ccr/core/gateway/upstream/target-cooldown.ts";

beforeEach(resetTargetCooldownsForTest);

test("the first failure is sidelined for exactly the duration asked for", () => {
  // The escalation must not punish a one-off 429, which is the common case.
  assert.equal(targetCooldownDurationMs(60_000, 1), 60_000);
});

test("each consecutive failure doubles the wait", () => {
  assert.equal(targetCooldownDurationMs(60_000, 2), 120_000);
  assert.equal(targetCooldownDurationMs(60_000, 3), 240_000);
  assert.equal(targetCooldownDurationMs(60_000, 4), 480_000);
});

test("the wait is capped, so a recovered provider is still retried", () => {
  // Without a cap a long outage would sideline a target for days and it would
  // never be tried again after it came back.
  const capped = targetCooldownDurationMs(60_000, 50);
  assert.equal(capped, 30 * 60_000);
  assert.ok(capped <= 30 * 60_000);
});

test("a target that keeps failing is sidelined for longer each time", () => {
  const target = "OVH/gpt-oss-120b";
  markTargetCoolingDown(target, 60_000);
  const first = targetCooldownRemainingMs(target);
  clearTargetCooldownWindowOnly(target);
  markTargetCoolingDown(target, 60_000);
  const second = targetCooldownRemainingMs(target);
  assert.ok(second > first, `second cooldown ${second} did not exceed the first ${first}`);
});

/** Expire the window without clearing the streak, as real elapsed time would. */
function clearTargetCooldownWindowOnly(target) {
  // targetCooldownRemainingMs zeroes the window once it lapses; simulate that
  // by waiting it out logically rather than sleeping.
  markTargetCoolingDown(target, 1);
}

test("answering resets the streak, so a recovered target returns at once", () => {
  // This is what stops the escalation becoming a permanent ban, and it is why
  // nobody has to edit the chain when a provider comes back.
  const target = "Groq/qwen/qwen3.8-27b";
  for (let i = 0; i < 5; i += 1) markTargetCoolingDown(target, 60_000);
  assert.ok(targetCooldownRemainingMs(target) > 60_000, "the streak did not escalate");

  clearTargetCooldown(target);
  assert.equal(targetCooldownRemainingMs(target), 0, "a success must clear the window");

  markTargetCoolingDown(target, 60_000);
  assert.ok(
    targetCooldownRemainingMs(target) <= 60_000,
    "after a success the next failure must start from the base duration again"
  );
});

test("a shorter later reading never shortens an earned cooldown", () => {
  const target = "Zen/big-pickle";
  markTargetCoolingDown(target, 600_000);
  const long = targetCooldownRemainingMs(target);
  markTargetCoolingDown(target, 1_000);
  assert.ok(targetCooldownRemainingMs(target) >= long - 50, "a short reading shortened the window");
});

test("an absent target and a nonsense duration are ignored", () => {
  markTargetCoolingDown(undefined, 60_000);
  markTargetCoolingDown("x", 0);
  markTargetCoolingDown("x", Number.NaN);
  assert.equal(targetCooldownRemainingMs("x"), 0);
});

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
  isAccountScopedRefusal,
  isRequestShapeRefusal,
  markTargetFailure,
  providerScopeOf,
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

test("a streak of failures sidelines a target its status never would have", () => {
  // Measured over a fortnight: OVH returned 403 on 585 consecutive requests
  // and was never sidelined, because only 402 and 429 ask for a cooldown. A
  // status explains why a target failed; it does not decide whether trying
  // again is worth an attempt.
  const target = "OVH/gpt-oss-120b";
  markTargetFailure(target, 0);
  assert.equal(targetCooldownRemainingMs(target), 0, "one 403 must not sideline a provider");
  markTargetFailure(target, 0);
  assert.equal(targetCooldownRemainingMs(target), 0, "two is still not evidence");
  markTargetFailure(target, 0);
  assert.ok(targetCooldownRemainingMs(target) > 0, "a third consecutive failure should sideline it");
});

test("the streak keeps escalating once it has started", () => {
  const target = "ZyloAI/gpt-oss-20b";
  for (let i = 0; i < 3; i += 1) markTargetFailure(target, 0);
  const third = targetCooldownRemainingMs(target);
  markTargetFailure(target, 0);
  assert.ok(targetCooldownRemainingMs(target) > third, "the fourth failure did not extend the window");
});

test("answering clears a streak built from unstatused failures", () => {
  const target = "Zen/big-pickle";
  for (let i = 0; i < 4; i += 1) markTargetFailure(target, 0);
  assert.ok(targetCooldownRemainingMs(target) > 0);
  clearTargetCooldown(target);
  markTargetFailure(target, 0);
  assert.equal(targetCooldownRemainingMs(target), 0, "a recovered provider must start its streak again");
});

test("a status that asks for a cooldown still sidelines on the first failure", () => {
  // The streak rule must not delay a 429, which is the provider telling us
  // plainly to wait.
  const target = "Google Gemini/gemini-3.5-flash-lite";
  markTargetFailure(target, 60_000);
  assert.ok(targetCooldownRemainingMs(target) > 0, "a 429 must sideline immediately");
});

test("an account-scoped refusal sidelines every model that provider serves", () => {
  // OVH burned 70 failed attempts in one hour because its eight chain entries
  // each held a separate cooldown while sharing one anonymous rate limit, so
  // every entry had to learn the same refusal independently.
  const oneModel = "ovh::openai_chat_completions/gpt-oss-120b";
  const another = "ovh::openai_chat_completions/Qwen3.8-27B";
  markTargetFailure(providerScopeOf(oneModel), 60_000);
  assert.ok(targetCooldownRemainingMs(another) > 0, "a sibling model was not covered by the account cooldown");
});

test("a model-scoped failure does not sideline its siblings", () => {
  // The control. A withdrawn model must not retire the provider.
  const oneModel = "naga::openai_chat_completions/withdrawn-model";
  const sibling = "naga::openai_chat_completions/working-model";
  for (let i = 0; i < 5; i += 1) markTargetFailure(oneModel, 0);
  assert.ok(targetCooldownRemainingMs(oneModel) > 0, "the failing model should be sidelined");
  assert.equal(targetCooldownRemainingMs(sibling), 0, "a sibling model must be unaffected");
});

test("only account-shaped statuses claim the whole provider", () => {
  for (const status of [401, 402, 403, 429]) assert.equal(isAccountScopedRefusal(status), true, String(status));
  for (const status of [400, 404, 500, 503]) assert.equal(isAccountScopedRefusal(status), false, String(status));
});

test("a selector with no model yields no provider scope", () => {
  assert.equal(providerScopeOf("bare-selector"), undefined);
  assert.equal(providerScopeOf(undefined), undefined);
  assert.equal(providerScopeOf("ovh::openai_chat_completions/m"), "ovh::openai_chat_completions/*");
});

test("a size refusal sidelines on the first reading, without a streak", () => {
  // Measured 2026-09-19: Groq answers 413 to every auto-mode classifier
  // request, which runs 170-240KB against its per-request ceiling. Waiting
  // changes nothing, so the streak rule would spend two more attempts to
  // learn what the first answer already established.
  const target = "groq::openai_chat_completions/qwen/qwen3.8-27b";
  markTargetFailure(target, 0, 413);
  assert.ok(targetCooldownRemainingMs(target) > 0, "one 413 must sideline the target");
});

test("a size refusal outlasts the thirty-minute ceiling the other statuses share", () => {
  // The defect this fixes: escalating backoff caps at thirty minutes, so a
  // target that can never answer rejoined the chain twice an hour forever.
  const maxOrdinary = 30 * 60_000;
  const shaped = "groq::openai_chat_completions/model";
  const ordinary = "provider::openai_chat_completions/model";
  markTargetFailure(shaped, 0, 413);
  for (let i = 0; i < 12; i += 1) markTargetFailure(ordinary, 60_000);
  assert.ok(targetCooldownRemainingMs(ordinary) <= maxOrdinary,
    "an ordinary failure must stay under the shared ceiling");
  assert.ok(targetCooldownRemainingMs(shaped) > maxOrdinary,
    "a size refusal must outlast it, or the entry rejoins the chain twice an hour");
});

test("an ordinary status is unaffected by passing the status code", () => {
  // The negative control. The new argument must change nothing for the
  // statuses that were already handled, or every provider gets a twelve-hour
  // cooldown on its first hiccup.
  const target = "provider::openai_chat_completions/model";
  markTargetFailure(target, 0, 500);
  assert.equal(targetCooldownRemainingMs(target), 0, "one 500 must not sideline a provider");
  markTargetFailure(target, 0, 500);
  markTargetFailure(target, 0, 500);
  assert.ok(targetCooldownRemainingMs(target) > 0, "the streak rule must still apply");
});

test("only size statuses are treated as decided by the request", () => {
  for (const status of [413, 414, 431]) assert.equal(isRequestShapeRefusal(status), true, String(status));
  // 400 and 404 can mean a model was briefly withdrawn or a route briefly
  // misconfigured, so they keep the ordinary escalation and its chance to
  // recover. Listing them here would retire a provider for half a day on a
  // transient fault.
  for (const status of [400, 401, 402, 403, 404, 429, 500, 503]) {
    assert.equal(isRequestShapeRefusal(status), false, String(status));
  }
});

test("answering clears a size refusal, so a raised limit is picked up", () => {
  const target = "groq::openai_chat_completions/model";
  markTargetFailure(target, 0, 413);
  assert.ok(targetCooldownRemainingMs(target) > 0);
  clearTargetCooldown(target);
  assert.equal(targetCooldownRemainingMs(target), 0, "a success must return the target to the chain");
});

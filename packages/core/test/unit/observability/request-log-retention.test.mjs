import assert from "node:assert/strict";
import test from "node:test";
import {
  requestLogRetentionCutoff,
  requestLogRetentionDays
} from "@ccr/core/observability/request-log-store.ts";

test("the default keeps a week, not a day", () => {
  // One day deleted everything older than local midnight on the first write
  // after it, so yesterday could not be examined at all.
  assert.equal(requestLogRetentionDays(undefined), 7);
  assert.equal(requestLogRetentionDays(""), 7);
  assert.equal(requestLogRetentionDays("   "), 7);
});

test("a configured value is honored", () => {
  assert.equal(requestLogRetentionDays("1"), 1);
  assert.equal(requestLogRetentionDays("30"), 30);
  assert.equal(requestLogRetentionDays("2.9"), 2, "a fraction of a day is not a retention boundary");
});

test("a value below one is refused rather than clamped to zero", () => {
  // Zero would read as "keep nothing" and delete rows the caller is still
  // writing. Falling back to the default is the safe direction.
  assert.equal(requestLogRetentionDays("0"), 7);
  assert.equal(requestLogRetentionDays("-5"), 7);
  assert.equal(requestLogRetentionDays("not a number"), 7);
  assert.equal(requestLogRetentionDays("NaN"), 7);
});

test("one day means today, so the cutoff is local midnight", () => {
  // The previous behaviour has to remain expressible, or anyone relying on it
  // loses it silently.
  const now = new Date(2026, 8, 19, 14, 30, 0);
  const cutoff = requestLogRetentionCutoff(now, 1);
  assert.equal(cutoff.getFullYear(), 2026);
  assert.equal(cutoff.getMonth(), 8);
  assert.equal(cutoff.getDate(), 19);
  assert.equal(cutoff.getHours(), 0);
  assert.equal(cutoff.getMinutes(), 0);
});

test("seven days reaches back six midnights, not seven", () => {
  // Counting today is what makes "7" mean a week of history rather than eight.
  const now = new Date(2026, 8, 19, 14, 30, 0);
  const cutoff = requestLogRetentionCutoff(now, 7);
  assert.equal(cutoff.getDate(), 13);
  assert.equal(cutoff.getMonth(), 8);
  assert.equal(cutoff.getHours(), 0);
});

test("the cutoff crosses a month boundary", () => {
  // setDate with a negative result rolls the month; asserted because an
  // arithmetic shortcut on the day number would not.
  const cutoff = requestLogRetentionCutoff(new Date(2026, 8, 3, 9, 0, 0), 7);
  assert.equal(cutoff.getMonth(), 7, "expected August");
  assert.equal(cutoff.getDate(), 28);
});

test("the cutoff never moves forward in time", () => {
  const now = new Date(2026, 8, 19, 14, 30, 0);
  for (const days of [1, 2, 7, 30, 365]) {
    assert.ok(requestLogRetentionCutoff(now, days) <= now, `${days} days produced a future cutoff`);
  }
});

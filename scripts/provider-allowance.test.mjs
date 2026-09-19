// node --test scripts/provider-allowance.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { bindingMeter, formatMeter, meterHealth } from "./provider-allowance.mjs";

test("a meter against a limit is judged on what fraction is left", () => {
  assert.equal(meterHealth({ limit: 100, remaining: 82, used: 18 }), "ok");
  assert.equal(meterHealth({ limit: 100, remaining: 5, used: 95 }), "low");
  assert.equal(meterHealth({ limit: 100, remaining: 0, used: 100 }), "spent");
  assert.equal(meterHealth({ limit: 1000, remaining: 0, used: 1000 }), "spent");
});

test("zero with nothing spent is unreadable, not exhausted", () => {
  // Both present as zero. A connector wired to an endpoint that carries no
  // consumption figure reports nothing spent and nothing left, and calling
  // that exhausted would retire a working provider. An account that really is
  // exhausted has spent something.
  assert.equal(meterHealth({ remaining: 0, used: 0 }), "no reading");
  assert.equal(meterHealth({ remaining: 0, used: 4.2 }), "spent");
  assert.equal(meterHealth({ remaining: -0.18, used: 5.01 }), "spent");
});

test("an absent or non-numeric remaining is unreadable", () => {
  assert.equal(meterHealth({ limit: 100 }), "no reading");
  assert.equal(meterHealth({ remaining: null }), "no reading");
  assert.equal(meterHealth({ remaining: "plenty" }), "no reading");
  assert.equal(meterHealth(undefined), "no reading");
});

test("a positive remaining with no limit is fine rather than unknown", () => {
  // Without a limit there is no fraction to judge, but money in the account is
  // still money in the account.
  assert.equal(meterHealth({ remaining: 19.79 }), "ok");
});

test("an unreadable meter never hides a readable one", () => {
  // Measured on OpenRouter: a credits meter resolving to undefined sits beside
  // a balance meter holding 19.79 of 20. Ranking the unreadable one first
  // reported the account as unknown while it had almost all of its allowance.
  const meters = [
    { label: "Total credits", limit: 20, remaining: undefined },
    { label: "Balance", remaining: 19.79 }
  ];
  assert.equal(bindingMeter(meters).label, "Balance");
  assert.equal(meterHealth(bindingMeter(meters)), "ok");
});

test("the most constraining readable meter decides", () => {
  const meters = [
    { label: "Daily tokens", limit: 200000, remaining: 199235 },
    { label: "Daily requests", limit: 15, remaining: 1 }
  ];
  assert.equal(bindingMeter(meters).label, "Daily requests", "the nearly-spent meter is the one that binds");
});

test("a provider with no meters at all yields nothing rather than throwing", () => {
  assert.equal(bindingMeter([]), undefined);
  assert.equal(bindingMeter(undefined), undefined);
  assert.equal(formatMeter(undefined), "no meter");
});

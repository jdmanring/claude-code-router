// node --test local-plugins/gateway-upstream-usage-headers.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { usageHeaders } from "./gateway-upstream-usage-headers.mjs";

test("picks up the OpenAI rate-limit family Groq and its peers send", () => {
  const found = usageHeaders(new Headers({
    "content-type": "application/json",
    "x-ratelimit-limit-requests": "30",
    "x-ratelimit-remaining-requests": "29",
    "x-ratelimit-remaining-tokens": "17950",
    "x-ratelimit-reset-tokens": "1.2s",
    "x-request-id": "abc"
  }));
  assert.deepEqual(Object.keys(found).sort(), [
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens"
  ]);
  assert.equal(found["x-ratelimit-remaining-tokens"], "17950");
});

test("picks up the other spellings and retry-after", () => {
  const found = usageHeaders(new Headers({
    "ratelimit-remaining": "5",
    "retry-after": "60",
    "x-credits-remaining": "3",
    "x-quota-limit": "100"
  }));
  assert.deepEqual(Object.keys(found).sort(), [
    "ratelimit-remaining", "retry-after", "x-credits-remaining", "x-quota-limit"
  ]);
});

test("ignores headers that carry no usage, including the request id", () => {
  const found = usageHeaders(new Headers({
    "content-type": "application/json",
    "x-request-id": "abc",
    // The set the gateway child substitutes for the provider's own. Recording
    // these as usage would report CCR's billing view as the provider's limit.
    "x-gateway-billing-total-tokens": "42",
    "x-gateway-target-provider": "groq"
  }));
  assert.deepEqual(found, {});
});

test("a missing or malformed header bag yields nothing rather than throwing", () => {
  // The hook runs on every response; throwing here would be worse than blind.
  assert.deepEqual(usageHeaders(undefined), {});
  assert.deepEqual(usageHeaders(null), {});
  assert.deepEqual(usageHeaders({}), {});
  assert.deepEqual(usageHeaders({ forEach: "not a function" }), {});
});

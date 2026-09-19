// node --test scripts/provider-working-model.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { readsAsWorking, refusalReason } from "./provider-working-model.mjs";

test("a 2xx with real output is working", () => {
  assert.equal(readsAsWorking(200, { usage: { completion_tokens: 12 } }), true);
  assert.equal(readsAsWorking(200, { usage: { output_tokens: 12 } }), true);
});

test("a 2xx that billed no output is a decline, not a working model", () => {
  // AIHubMix's shape: a refusal delivered as the message with zero output.
  assert.equal(readsAsWorking(200, {
    choices: [{ message: { content: "accounts that have not been recharged can only try 10 times" } }],
    usage: { completion_tokens: 0 }
  }), false);
});

test("without a usage block, real text still counts", () => {
  // Not every provider returns usage; refusing them all would be wrong.
  assert.equal(readsAsWorking(200, { choices: [{ message: { content: "Hi!" } }] }), true);
  assert.equal(readsAsWorking(200, { content: [{ text: "Hi!" }] }), true);
  assert.equal(readsAsWorking(200, { choices: [{ message: { content: "   " } }] }), false);
  assert.equal(readsAsWorking(200, {}), false);
});

test("a non-2xx is never working, whatever the body says", () => {
  assert.equal(readsAsWorking(402, { usage: { completion_tokens: 12 } }), false);
  assert.equal(readsAsWorking(503, { choices: [{ message: { content: "hi" } }] }), false);
});

test("the refusal names the status and the provider's own words", () => {
  assert.match(refusalReason(402, { error: { message: "Insufficient balance" } }), /^402 Insufficient balance$/);
  assert.match(refusalReason(401, { error: "bad key" }), /^401 bad key$/);
  assert.match(refusalReason(500, undefined, "<html>oops</html>"), /^500 <html>oops<\/html>$/);
  // Newlines in a provider message would break the one-line report.
  assert.ok(!refusalReason(429, { message: "slow\n  down" }).includes("\n"));
});

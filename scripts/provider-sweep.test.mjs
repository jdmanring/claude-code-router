// node --test scripts/provider-sweep.test.mjs
//
// producedNoOutput decides whether a 200 counts as a working provider, so it
// is the one piece of judgement in the sweep and the one worth pinning.

import assert from "node:assert/strict";
import test from "node:test";

import { producedNoOutput } from "./provider-sweep.mjs";

test("a reply that billed no output is a decline inside a 200", () => {
  // AIHubMix, verbatim shape: a refusal as the message with zero output.
  assert.equal(producedNoOutput(JSON.stringify({
    content: [{ text: "accounts that have not been recharged can only try 10 times", type: "text" }],
    usage: { input_tokens: 8, output_tokens: 0 }
  })), true);
});

test("an ordinary answer is not a decline", () => {
  assert.equal(producedNoOutput(JSON.stringify({
    content: [{ text: "hi", type: "text" }],
    usage: { input_tokens: 8, output_tokens: 3 }
  })), false);
});

test("a body without usage says nothing either way and reads as output", () => {
  assert.equal(producedNoOutput(JSON.stringify({ content: [{ text: "hi", type: "text" }] })), false);
  assert.equal(producedNoOutput(JSON.stringify({ usage: {} })), false);
});

test("an unparseable or empty body is not evidence of a decline", () => {
  // A stream, an HTML error page and a truncated read all land here. Reporting
  // them as declines would turn a transport problem into a provider verdict.
  assert.equal(producedNoOutput(""), false);
  assert.equal(producedNoOutput("<!doctype html><html>502</html>"), false);
  assert.equal(producedNoOutput('{"usage":{"output_tokens":'), false);
});

test("a non-numeric output count is not a zero", () => {
  assert.equal(producedNoOutput(JSON.stringify({ usage: { output_tokens: null } })), false);
  assert.equal(producedNoOutput(JSON.stringify({ usage: { output_tokens: "0" } })), false);
});

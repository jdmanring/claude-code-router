// node --test scripts/model-probe.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { scoreAnswer, tasks } from "./model-probe.mjs";

const byName = (name) => tasks.find((task) => task.name === name);

test("importing the probe does not send a request", () => {
  // The module body must not probe: importing it for the checkers alone once
  // swept every provider in a sibling script, and this file imports it.
  assert.equal(typeof scoreAnswer, "function");
});

test("an empty answer fails even on a 200", () => {
  // Measured: Huggingface and Literouter both returned 200 with empty content
  // while a reasoning model spent the token ceiling before answering. Counting
  // those as passes would have selected the model that answered least.
  for (const task of tasks) {
    assert.equal(scoreAnswer(task, 200, ""), "empty");
    assert.equal(scoreAnswer(task, 200, "   \n "), "empty");
  }
});

test("a non-200 reports the status rather than a verdict", () => {
  assert.equal(scoreAnswer(tasks[0], 429, "whatever"), "HTTP 429");
  assert.equal(scoreAnswer(tasks[0], 522, ""), "HTTP 522");
});

test("the code task rejects the answer a weaker model actually gave", () => {
  // "[1] [1, 2]" is what nemotron-3-ultra-550b, nex-n2.5-pro, Ling-3.0-flash-Fin
  // and kimi-k2.7-code-cheap each returned: the first call's list printed as if
  // the default were fresh.
  const task = byName("reads code semantics");
  assert.equal(scoreAnswer(task, 200, "[1] [1, 2]"), "fail");
  assert.equal(scoreAnswer(task, 200, "[[1], [1, 2]]"), "fail");
  assert.equal(scoreAnswer(task, 200, "[1, 2] [1, 2]"), "pass");
  assert.equal(scoreAnswer(task, 200, "```\n[1, 2] [1, 2]\n```"), "pass", "a fenced answer is still the answer");
});

test("the constraint task rejects a fluent sentence", () => {
  // codestral-latest answered "converts code to machine language" to a request
  // for exactly three lowercase words, which is the failure being measured.
  const task = byName("follows an output constraint");
  assert.equal(scoreAnswer(task, 200, "converts code to machine language"), "fail");
  assert.equal(scoreAnswer(task, 200, "turns code into"), "pass");
  assert.equal(scoreAnswer(task, 200, "Turns code into."), "fail", "case and punctuation were part of the instruction");
});

test("the reasoning task rejects the plausible wrong number", () => {
  // The ladder floats, so the count does not change. "3" is what a model gets
  // by subtracting 90cm of tide from three 30cm rungs.
  const task = byName("reasons about a trick premise");
  assert.equal(scoreAnswer(task, 200, "3"), "fail");
  assert.equal(scoreAnswer(task, 200, "8"), "fail");
  assert.equal(scoreAnswer(task, 200, "5"), "pass");
});

test("the length task rejects an answer that ignores the limit", () => {
  const task = byName("respects a length limit");
  assert.equal(scoreAnswer(task, 200, Array.from({ length: 21 }, () => "word").join(" ")), "fail");
  assert.equal(scoreAnswer(task, 200, "It tries the next provider in the chain until one answers."), "pass");
});

test("every task carries a prompt and a check", () => {
  // A task added without one silently scores every model the same.
  assert.ok(tasks.length >= 4);
  for (const task of tasks) {
    assert.equal(typeof task.prompt, "string");
    assert.ok(task.prompt.length > 0, `${task.name} has no prompt`);
    assert.equal(typeof task.check, "function");
  }
});

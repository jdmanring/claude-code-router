import assert from "node:assert/strict";
import test from "node:test";

import {
  bodyPath,
  scoreReplay,
  toOpenAiMessages,
  usableCase,
  verdictOf
} from "./classifier-replay.mjs";

test("a verdict is read from the open tag, because the close tag is a stop sequence", () => {
  // The client sends stop: ["</block>"], so a correct answer is cut before the
  // closing tag ever arrives. Requiring the closed form would score every
  // well-formed answer as malformed, which is the whole measurement inverted.
  assert.equal(verdictOf("<block>yes"), "yes");
  assert.equal(verdictOf("<block>no"), "no");
  assert.equal(verdictOf("<block>yes</block><category>Data Exfiltration</category>"), "yes");
});

test("an answer with no verdict tag is not a vote", () => {
  // Counting a formatting failure as "no" would read a model that ignored the
  // contract as one that decided to allow the action.
  assert.equal(verdictOf("Sure! Let me analyse this command step by step."), null);
  assert.equal(verdictOf(""), null);
  assert.equal(verdictOf(undefined), null);
  assert.equal(verdictOf("safe"), null, "a guard model's own taxonomy is not this contract");
});

test("scoreReplay separates disagreeing from not answering", () => {
  assert.deepEqual(scoreReplay("yes", "<block>yes"), { agrees: true, got: "yes", outcome: "agrees" });
  assert.deepEqual(scoreReplay("yes", "<block>no"), { agrees: false, got: "no", outcome: "disagrees" });
  assert.deepEqual(scoreReplay("yes", "unsafe\nS2"), { agrees: false, outcome: "no verdict" });
});

test("the Gemini body is converted with roles mapped and system hoisted", () => {
  const body = {
    contents: [
      { parts: [{ text: "judge this" }], role: "user" },
      { parts: [{ text: "<block>no" }], role: "model" }
    ],
    systemInstruction: { parts: [{ text: "you are a security monitor" }] }
  };
  assert.deepEqual(toOpenAiMessages(body), [
    { content: "you are a security monitor", role: "system" },
    { content: "judge this", role: "user" },
    { content: "<block>no", role: "assistant" }
  ]);
});

test("a body with no systemInstruction still converts its turns", () => {
  const messages = toOpenAiMessages({ contents: [{ parts: [{ text: "hello" }], role: "user" }] });
  assert.deepEqual(messages, [{ content: "hello", role: "user" }]);
});

test("bodyPath shards on the first two characters and refuses a non-ref", () => {
  assert.equal(bodyPath("/b", "70af0995-2dad-453d"), "/b/70/70af0995-2dad-453d");
  // Guards the directory: a ref is interpolated into a path, so anything that
  // is not ref-shaped must not reach the filesystem.
  assert.equal(bodyPath("/b", "../../etc/passwd"), undefined);
  assert.equal(bodyPath("/b", ""), undefined);
});

const row = (overrides = {}) => ({
  requestBodyRef: "70af0995-2dad-453d",
  responseText: "<block>yes</block><category>X</category>",
  ...overrides
});
const body = JSON.stringify({ contents: [{ parts: [{ text: "judge this" }], role: "user" }] });

test("a case is prepared from the stored file, never from the preview column", () => {
  const prepared = usableCase(row(), "/b", () => body, () => true);
  assert.equal(prepared.usable, true);
  assert.equal(prepared.recorded, "yes");
  assert.deepEqual(prepared.messages, [{ content: "judge this", role: "user" }]);
});

test("a case whose stored body is missing is dropped, not guessed at", () => {
  assert.deepEqual(
    usableCase(row(), "/b", () => body, () => false),
    { reason: "no stored body", usable: false }
  );
});

test("a case with no recorded verdict is dropped", () => {
  // Without a recorded answer there is nothing to compare a candidate against,
  // and scoring it would invent a label.
  const prepared = usableCase(row({ responseText: "{}" }), "/b", () => body, () => true);
  assert.deepEqual(prepared, { reason: "no verdict recorded", usable: false });
});

test("the elided preview shape is rejected rather than replayed", () => {
  // request_body_text is a preview carrying "... N bytes omitted from preview ..."
  // with raw newlines, so it is not JSON. Replaying it would send a truncated
  // transcript and measure the candidate on a request nobody makes.
  const preview = '{"contents":[{"parts":[{"text":"start\n\n... 17364 bytes omitted from preview ...\n\nend"}]}]}';
  const prepared = usableCase(row(), "/b", () => preview, () => true);
  assert.deepEqual(prepared, { reason: "stored body is not JSON", usable: false });
});

test("a body that parses but carries no prompt is dropped", () => {
  const prepared = usableCase(row(), "/b", () => JSON.stringify({ contents: [] }), () => true);
  assert.deepEqual(prepared, { reason: "body carries no prompt", usable: false });
});

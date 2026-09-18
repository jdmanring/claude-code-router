import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayPlugin, stripReasoningContent } from "./gateway-codex-reasoning-content.mjs";

const hook = () => createGatewayPlugin().providerHooks[0];

// The exact shape OpenAI rejected, taken from a stored response body:
// "Invalid 'input[2].content': array too long."
const responsesBody = () => ({
  input: [
    { content: [{ text: "hi", type: "input_text" }], role: "user", type: "message" },
    { content: [{ text: "thinking", type: "reasoning_text" }], encrypted_content: "abc", summary: [], type: "reasoning" },
    { content: [{ text: "more", type: "reasoning_text" }], summary: [{ text: "s", type: "summary_text" }], type: "reasoning" }
  ],
  model: "gpt-5.6-luna"
});

test("every reasoning item is left with a zero-length content array", () => {
  const { body, stripped } = stripReasoningContent(responsesBody());
  assert.equal(stripped, 2);
  const reasoning = body.input.filter((item) => item.type === "reasoning");
  assert.equal(reasoning.length, 2);
  for (const item of reasoning) assert.deepEqual(item.content, []);
});

test("summary and encrypted_content survive, and other items are untouched", () => {
  const { body } = stripReasoningContent(responsesBody());
  assert.equal(body.input[1].encrypted_content, "abc");
  assert.deepEqual(body.input[2].summary, [{ text: "s", type: "summary_text" }]);
  assert.deepEqual(body.input[0], responsesBody().input[0]);
  assert.equal(body.model, "gpt-5.6-luna");
});

test("the input array is not mutated in place", () => {
  const original = responsesBody();
  stripReasoningContent(original);
  assert.equal(original.input[1].content.length, 1, "the caller's body must not change");
});

test("a body with nothing to strip is returned as the same object", () => {
  for (const body of [
    { input: [{ content: [{ text: "hi", type: "input_text" }], role: "user", type: "message" }], model: "m" },
    { input: [{ content: [], summary: [], type: "reasoning" }], model: "m" },
    { messages: [{ content: "hi", role: "user" }], model: "m" },
    {},
    null
  ]) {
    const result = stripReasoningContent(body);
    assert.equal(result.stripped, 0);
    assert.equal(result.body, body, "an untouched body must be the same reference");
  }
});

test("the hook returns an ok result carrying the patched upstream request", () => {
  const upstreamRequest = { body: responsesBody(), headers: {}, method: "POST", url: "https://example/responses" };
  const result = hook().transformRequest({ upstreamRequest });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.value, undefined);
  assert.equal(result.value.url, "https://example/responses");
  assert.equal(result.value.headers, upstreamRequest.headers);
  for (const item of result.value.body.input.filter((i) => i.type === "reasoning")) {
    assert.deepEqual(item.content, []);
  }
});

test("a serialized body is parsed, patched, and handed back serialized", () => {
  const upstreamRequest = { body: JSON.stringify(responsesBody()), headers: {}, url: "https://example/responses" };
  const result = hook().transformRequest({ upstreamRequest });
  assert.equal(typeof result.value.body, "string");
  const parsed = JSON.parse(result.value.body);
  for (const item of parsed.input.filter((i) => i.type === "reasoning")) assert.deepEqual(item.content, []);
});

test("an unparseable body is passed through rather than dropped", () => {
  const upstreamRequest = { body: "not json", headers: {}, url: "https://example/responses" };
  const result = hook().transformRequest({ upstreamRequest });
  assert.equal(result.ok, true);
  assert.equal(result.value, upstreamRequest);
});

test("a chat-completions body reaches the upstream unchanged", () => {
  const upstreamRequest = { body: { messages: [{ content: "hi", role: "user" }], model: "m" }, headers: {}, url: "https://example/chat/completions" };
  const result = hook().transformRequest({ upstreamRequest });
  assert.equal(result.value, upstreamRequest, "a non-Responses body must not be rebuilt");
});

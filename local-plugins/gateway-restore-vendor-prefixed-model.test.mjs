import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayPlugin, restoreModel } from "./gateway-restore-vendor-prefixed-model.mjs";

const hook = () => createGatewayPlugin().providerHooks[0];
const call = (body, models) => hook().transformRequest({
  targetProvider: "Groq",
  targetProviderConfig: { models },
  upstreamRequest: { body, headers: {}, method: "POST", url: "https://example/v1/chat/completions" }
});

// The measured failure: Groq lists "openai/gpt-oss-120b" and the runtime sent
// "gpt-oss-120b", so the provider answered 400 model_not_found.
test("a stripped vendor prefix is restored from the provider's own list", () => {
  assert.equal(restoreModel("gpt-oss-120b", ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]), "openai/gpt-oss-120b");
});

test("a model the provider actually offers is left alone", () => {
  assert.equal(restoreModel("qwen3.8-27b", ["qwen3.8-27b", "openai/qwen3.8-27b"]), undefined,
    "the exact id is offered, so nothing was stripped");
});

test("an ambiguous restore is refused", () => {
  assert.equal(restoreModel("gpt-oss-120b", ["openai/gpt-oss-120b", "azure/gpt-oss-120b"]), undefined,
    "two candidates end with the same id, so guessing would pick the wrong provider path");
});

test("nothing is invented when the provider lists no match", () => {
  assert.equal(restoreModel("something-else", ["openai/gpt-oss-120b"]), undefined);
  assert.equal(restoreModel("gpt-oss-120b", []), undefined);
  assert.equal(restoreModel(undefined, ["openai/gpt-oss-120b"]), undefined);
});

test("the hook rewrites an object body and leaves the rest of it untouched", () => {
  const result = call({ max_tokens: 32, messages: [{ content: "hi", role: "user" }], model: "gpt-oss-120b" },
    ["openai/gpt-oss-120b"]);
  assert.equal(result.ok, true);
  assert.equal(result.value.body.model, "openai/gpt-oss-120b");
  assert.deepEqual(result.value.body.messages, [{ content: "hi", role: "user" }]);
  assert.equal(result.value.body.max_tokens, 32);
  assert.equal(result.value.url, "https://example/v1/chat/completions");
});

test("a serialized body round-trips as a string", () => {
  const result = call(JSON.stringify({ max_tokens: 8, model: "gpt-oss-120b" }), ["openai/gpt-oss-120b"]);
  assert.equal(typeof result.value.body, "string");
  assert.equal(JSON.parse(result.value.body).model, "openai/gpt-oss-120b");
});

test("an untouched request is returned as the same object", () => {
  const upstreamRequest = { body: { model: "qwen/qwen3.8-27b" }, headers: {}, url: "u" };
  const result = hook().transformRequest({ targetProviderConfig: { models: ["qwen/qwen3.8-27b"] }, upstreamRequest });
  assert.equal(result.value, upstreamRequest);
});

test("a provider with no configured models is never touched", () => {
  const result = call({ model: "gpt-oss-120b" }, undefined);
  assert.equal(result.value.body.model, "gpt-oss-120b");
});

test("an unparseable string body is passed through rather than dropped", () => {
  const result = call("not json", ["openai/gpt-oss-120b"]);
  assert.equal(result.ok, true);
  assert.equal(result.value.body, "not json");
});

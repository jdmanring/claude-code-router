import assert from "node:assert/strict";
import test from "node:test";
import { stripReasoningContent, setup } from "./responses-reasoning-content.mjs";

test("a reasoning item's content is cleared, and its summary is left alone", () => {
  const input = [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    {
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "kept" }],
      encrypted_content: "opaque",
      content: [{ type: "reasoning_text", text: "dropped" }]
    }
  ];

  assert.equal(stripReasoningContent(input), 1);
  assert.deepEqual(input[1].content, []);
  assert.deepEqual(input[1].summary, [{ type: "summary_text", text: "kept" }]);
  assert.equal(input[1].encrypted_content, "opaque");
  // A message is not a reasoning item and must keep its content, or the
  // conversation itself is destroyed.
  assert.deepEqual(input[0].content, [{ type: "input_text", text: "hi" }]);
});

test("nothing is reported when no reasoning item carries content", () => {
  const input = [
    { type: "reasoning", id: "rs_1", summary: [], content: [] },
    { type: "function_call", name: "f", arguments: "{}" }
  ];
  assert.equal(stripReasoningContent(input), 0);
});

test("the transform leaves a body without an input array untouched", () => {
  const calls = [];
  const context = {
    logger: { info: () => {} },
    registerGatewayRequestTransform: (registration) => calls.push(registration)
  };
  setup(context);
  const { transform } = calls[0];

  assert.equal(transform({ body: { messages: [{ role: "user", content: "hi" }] } }), undefined);
  assert.equal(transform({ body: undefined }), undefined);
  assert.equal(transform({}), undefined);
});

test("the transform returns the repaired body only when it changed something", () => {
  const calls = [];
  setup({ logger: { info: () => {} }, registerGatewayRequestTransform: (r) => calls.push(r) });
  const { transform } = calls[0];

  const clean = { input: [{ type: "reasoning", content: [] }] };
  assert.equal(transform({ body: clean }), undefined, "an untouched body must not be rewritten");

  const dirty = { input: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "x" }] }] };
  const result = transform({ body: dirty, routedModel: "codex-api/gpt-5.6-luna" });
  assert.ok(result && result.body, "a repaired body must be returned");
  assert.deepEqual(result.body.input[0].content, []);
});

test("the real failing shape from the logs is repaired", () => {
  // 216 items, 36 reasoning items with content, measured 2026-09-18.
  const input = [];
  for (let i = 0; i < 216; i += 1) {
    input.push(i % 6 === 2
      ? { type: "reasoning", id: `rs_${i}`, summary: [], content: [{ type: "reasoning_text", text: "t" }] }
      : { type: "message", role: "assistant", content: [{ type: "output_text", text: "t" }] });
  }
  const stripped = stripReasoningContent(input);
  assert.equal(stripped, 36);
  assert.ok(input.every((item) => item.type !== "reasoning" || item.content.length === 0));
  assert.ok(input.some((item) => item.type === "message" && item.content.length === 1));
});

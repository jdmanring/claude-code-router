// The request log stores the body the gateway sent upstream, never the one the
// client sent, so "did we drop a field?" is unanswerable for any field. This
// records the inbound shape instead of the inbound body: the body store already
// holds 4.3GB and a second copy would answer a question about which keys exist.

import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeFieldPaths,
  droppedFieldPaths,
  encodeFieldPaths,
  jsonFieldPaths
} from "@ccr/core/observability/request-field-shape.ts";

test("array indices collapse, so shape does not grow with conversation length", () => {
  // The point of the collapse: two bodies whose arrays differ in length must
  // still be comparable, which is the normal case across a protocol
  // conversion. Numbered paths would make every long conversation report every
  // later message as dropped.
  const one = jsonFieldPaths(JSON.stringify({ messages: [{ role: "user" }] }));
  const many = jsonFieldPaths(JSON.stringify({
    messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }]
  }));
  assert.deepEqual(one, ["messages", "messages[].role"]);
  assert.deepEqual(many, one, "a longer conversation must produce the same shape");
});

test("a nested marker is recorded by path, and no value is recorded with it", () => {
  const paths = jsonFieldPaths(JSON.stringify({
    model: "claude-sonnet-5",
    system: [{ cache_control: { type: "ephemeral" }, text: "secret prompt text", type: "text" }]
  }));
  assert.ok(paths.includes("system[].cache_control.type"), "the marker's path must be recorded");
  assert.ok(paths.includes("system[].text"), "the text field's presence is recorded");
  // The reason this is safe to store where a body would not be.
  assert.ok(!paths.some((p) => p.includes("secret prompt text")), "no value may be recorded");
  assert.ok(!paths.some((p) => p.includes("claude-sonnet-5")), "no value may be recorded");
});

test("a body that is not a JSON object yields nothing, and that is not a finding", () => {
  // An empty result means "nothing to compare", never "the client sent no
  // fields". droppedFieldPaths is what enforces that distinction.
  assert.deepEqual(jsonFieldPaths("not json at all"), []);
  assert.deepEqual(jsonFieldPaths("[1,2,3]"), [], "a top-level array is not a request body");
  assert.deepEqual(jsonFieldPaths(""), []);
  assert.deepEqual(jsonFieldPaths(undefined), []);
});

test("a Buffer and the equivalent string agree", () => {
  const text = JSON.stringify({ a: { b: 1 } });
  assert.deepEqual(jsonFieldPaths(Buffer.from(text, "utf8")), jsonFieldPaths(text));
});

test("a pathological body cannot grow the column without limit", () => {
  // Depth and count are bounded, because this is written on every request.
  let deep = { leaf: 1 };
  for (let i = 0; i < 40; i += 1) deep = { nest: deep };
  assert.ok(jsonFieldPaths(JSON.stringify(deep)).length <= 250);
  const wide = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]));
  assert.ok(jsonFieldPaths(JSON.stringify(wide)).length <= 250, "a wide body must be capped");
});

test("dropped paths are the ones the client sent that did not survive", () => {
  const inbound = jsonFieldPaths(JSON.stringify({
    model: "m",
    system: [{ cache_control: { type: "ephemeral" }, text: "t", type: "text" }]
  }));
  const upstream = jsonFieldPaths(JSON.stringify({
    model: "m",
    system: [{ text: "t", type: "text" }]
  }));
  assert.deepEqual(droppedFieldPaths(inbound, upstream), [
    "system[].cache_control",
    "system[].cache_control.type"
  ]);
});

test("an unrecorded side is no reading, not a total loss", () => {
  // The guard that stops this manufacturing a finding on every request whose
  // body capture is off: without it, an empty upstream side reports every
  // inbound path as dropped.
  const inbound = jsonFieldPaths(JSON.stringify({ a: 1, b: 2 }));
  assert.deepEqual(droppedFieldPaths(inbound, []), []);
  assert.deepEqual(droppedFieldPaths([], inbound), []);
});

test("nothing is reported when the shapes agree", () => {
  // The control for the two tests above.
  const paths = jsonFieldPaths(JSON.stringify({ a: 1, b: { c: 2 } }));
  assert.deepEqual(droppedFieldPaths(paths, paths), []);
});

test("the encoded form round-trips", () => {
  const paths = jsonFieldPaths(JSON.stringify({ a: 1, b: { c: 2 } }));
  assert.deepEqual(decodeFieldPaths(encodeFieldPaths(paths)), paths);
  assert.deepEqual(decodeFieldPaths(""), []);
  assert.deepEqual(decodeFieldPaths(undefined), []);
});

// node --test scripts/model-catalog-audit.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { catalogueIds, isPublished, catalogueRows, chatCapability } from "./model-catalog-audit.mjs";

test("reads the catalogue shapes these providers actually return", () => {
  assert.deepEqual(catalogueIds({ data: [{ id: "a" }, { id: "b" }] }), ["a", "b"]);
  assert.deepEqual(catalogueIds({ models: [{ name: "a" }] }), ["a"]);
  assert.deepEqual(catalogueIds(["a", "b"]), ["a", "b"]);
});

test("a body with no model list is unknown, never an empty catalogue", () => {
  // The difference decides whether every configured id reads as withdrawn.
  assert.equal(catalogueIds({ error: "unauthorized" }), undefined);
  assert.equal(catalogueIds({ data: [] }), undefined);
  assert.equal(catalogueIds(undefined), undefined);
});

test("a prefix the gateway strips is not a withdrawal", () => {
  const published = new Set(["gemma4-26b:free", "qwen/qwen3.8-27b"]);
  assert.equal(isPublished("google/gemma4-26b:free", published), true);
  assert.equal(isPublished("qwen/qwen3.8-27b", published), true);
  assert.equal(isPublished("qwen3.8-27b", published), true);
});

test("an id the provider no longer lists is reported", () => {
  assert.equal(isPublished("gemini-3.7-flash-free", new Set(["gemini-3.8-flash-free"])), false);
});

test("a catalogue that says nothing about modality reads as unknown", () => {
  // The dangerous direction: a model wrongly called non-chat gets deleted from
  // a working configuration. Most catalogues here publish no modality at all,
  // so silence must be the default.
  assert.equal(chatCapability({ id: "some-model" }), "unknown");
  assert.equal(chatCapability({ id: "x", architecture: {} }), "unknown");
  assert.equal(chatCapability({ id: "x", architecture: { output_modalities: [] } }), "unknown");
  assert.equal(chatCapability(undefined), "unknown");
});

test("output_modalities decides when the catalogue publishes it", () => {
  assert.equal(chatCapability({ architecture: { output_modalities: ["text"] } }), "text");
  assert.equal(chatCapability({ architecture: { output_modalities: ["text", "image"] } }), "text");
  assert.equal(chatCapability({ architecture: { output_modalities: ["image"] } }), "not-text");
  assert.equal(chatCapability({ architecture: { output_modalities: ["audio"] } }), "not-text");
});

test("the arrow modality string is read on its output side only", () => {
  // "text+image->text" takes text and images and produces text, so it answers.
  assert.equal(chatCapability({ architecture: { modality: "text+image->text" } }), "text");
  // "text->image" takes text and produces an image, so it cannot.
  assert.equal(chatCapability({ architecture: { modality: "text->image" } }), "not-text");
  assert.equal(chatCapability({ architecture: { modality: "audio->text" } }), "text");
});

test("a declared embedding or rerank type cannot answer", () => {
  // BAAI/bge-m3 was configured on SEA-LION and can only ever error. It sits in
  // the same /models response as that provider's chat models.
  assert.equal(chatCapability({ id: "BAAI/bge-m3", type: "embedding" }), "not-text");
  assert.equal(chatCapability({ id: "x", type: "rerank" }), "not-text");
  assert.equal(chatCapability({ id: "x", type: "moderation" }), "not-text");
  assert.equal(chatCapability({ id: "x", type: "chat" }), "unknown", "a chat type adds nothing the check needs");
});

test("a type that merely contains a family name does not fire", () => {
  // "text-embedding-ada" as a MODEL ID must not be read as a declared type,
  // and the check never infers from an id at all.
  assert.equal(chatCapability({ id: "text-embedding-3-large" }), "unknown");
  assert.equal(chatCapability({ type: "embedding-model" }), "unknown");
});

test("catalogueRows keeps the objects that catalogueIds discards", () => {
  const payload = { data: [{ id: "a", architecture: { output_modalities: ["image"] } }, "bare-string"] };
  const rows = catalogueRows(payload);
  assert.equal(rows.length, 1, "a bare string carries no type information");
  assert.equal(chatCapability(rows[0]), "not-text");
  assert.deepEqual(catalogueIds(payload), ["a", "bare-string"]);
});

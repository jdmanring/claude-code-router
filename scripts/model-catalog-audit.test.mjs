// node --test scripts/model-catalog-audit.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { catalogueIds, isPublished } from "./model-catalog-audit.mjs";

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

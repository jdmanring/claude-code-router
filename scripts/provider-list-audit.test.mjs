// node --test scripts/provider-list-audit.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { blockHeadings, headingFor, listNameAliases } from "./provider-list-audit.mjs";

const sample = [
  "SOME SECTION HEADING:",
  "",
  "Groq - $0 Free (30 R/min)",
  "    pool: account",
  "    usage tracking: none found",
  "    qwen/qwen3.8-27b",
  "",
  "Ollama Cloud — $0 Free, Usage Plan: $20 Pro",
  "    usage tracking: tracked: /v1/credits",
  ""
].join("\n");

test("a block is keyed by its heading, before the dash", () => {
  const headings = blockHeadings(sample);
  assert.ok(headings.has("groq"));
  assert.ok(headings.has("ollama cloud"), "an em-dash heading is read the same as a hyphen one");
});

test("an all-caps section heading is not mistaken for a provider", () => {
  // Otherwise every line under it is attributed to a provider that does not exist.
  assert.ok(!blockHeadings(sample).has("some section heading"));
});

test("indented lines belong to the block above them", () => {
  const headings = blockHeadings(sample);
  assert.match(headings.get("groq").join(" "), /qwen3\.8-27b/);
  assert.ok(!headings.get("groq").join(" ").includes("/v1/credits"), "a block must not absorb the next one");
});

test("a provider is found under its brand name through the alias table", () => {
  const headings = blockHeadings(sample);
  assert.equal(headingFor("Groq", headings), "groq");
  assert.equal(headingFor("Ollama", headings), "ollama cloud");
  assert.equal(headingFor("Nonexistent", headings), undefined);
});

test("every alias points at a different name than its key", () => {
  // An alias equal to its key is a no-op that hides a genuinely missing block.
  for (const [key, value] of Object.entries(listNameAliases)) {
    assert.notEqual(key, value, `alias for ${key} does nothing`);
  }
});

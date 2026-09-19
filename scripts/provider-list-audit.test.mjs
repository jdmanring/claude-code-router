// node --test scripts/provider-list-audit.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { blockHeadings, headingFor, listNameAliases, orphanedBlocks } from "./provider-list-audit.mjs";

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
  assert.match(headings.get("groq").flat().join(" "), /qwen3\.8-27b/);
  assert.ok(!headings.get("groq").flat().join(" ").includes("/v1/credits"), "a block must not absorb the next one");
});

test("a provider listed twice keeps each appearance separate", () => {
  // The list carries some providers in a plans section and again in a
  // free-tier section. Merging them makes one tracking line per appearance
  // look like a duplicated field.
  const twice = [
    "Groq - plans section",
    "    usage tracking: tracked",
    "",
    "Groq - free section",
    "    usage tracking: tracked",
    ""
  ].join("\n");
  const occurrences = blockHeadings(twice).get("groq");
  assert.equal(occurrences.length, 2, "two appearances, not one merged block");
  for (const body of occurrences) {
    assert.equal(body.filter((l) => /usage tracking:/.test(l)).length, 1);
  }
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

test("a provider listed twice keeps each appearance separate", () => {
  // The list carries some providers in a plans section and again in a free
  // section. Merging the two made one tracking line per appearance look like a
  // duplicated field, and the checker reported three faults that were not there.
  const twice = [
    "Groq - plans section",
    "    usage tracking: tracked",
    "",
    "Groq - free section",
    "    usage tracking: tracked",
    ""
  ].join("\n");
  const occurrences = blockHeadings(twice).get("groq");
  assert.equal(occurrences.length, 2, "two appearances, not one merged block");
  for (const body of occurrences) {
    assert.equal(body.filter((line) => /usage tracking:/.test(line)).length, 1);
  }
});

test("a block left behind by a removed provider is reported", () => {
  // The forward check passes in exactly this case, because every configured
  // provider still has a block. Only the reverse direction sees it.
  const headings = blockHeadings([
    "Groq - still configured",
    "    usage tracking: none found",
    "",
    "Venice - removed from the config",
    "    usage tracking: none found",
    ""
  ].join("\n"));
  assert.deepEqual(orphanedBlocks(headings, new Set(["groq"])), ["venice"]);
});

test("a block saying it is not configured is not an orphan", () => {
  // The list carries providers it has deliberately never connected. They make
  // no claim about the running config and must not fire this check.
  const headings = blockHeadings([
    "Deepseek - never connected",
    "    usage tracking: not configured in CCR, so not probed",
    ""
  ].join("\n"));
  assert.deepEqual(orphanedBlocks(headings, new Set()), []);
});

test("a hard-wrapped prose line is not a provider block", () => {
  // The document's introduction is wrapped flush left and is followed by an
  // indented legend, so only the blank line separates it from a real heading.
  const headings = blockHeadings([
    "A status here is the provider's own answer, not a",
    "reading taken through CCR.",
    "",
    "  [ok]  answered 200",
    ""
  ].join("\n"));
  assert.ok(!headings.has("reading taken through ccr."));
});

test("a heading whose body starts after a blank line is still a block", () => {
  // The heading rule requires an indented body to separate a provider from the
  // document's flush-left prose. If a blank line between the two dropped the
  // block, the provider would read as having none, and the orphan check could
  // not see it either. Both directions would go quiet at once.
  const headings = blockHeadings([
    "Groq - configured",
    "",
    "    usage tracking: none found",
    ""
  ].join("\n"));
  assert.ok(headings.has("groq"), "a blank line under the heading must not drop the block");
});

test("a heading directly under the previous block's body is its own block", () => {
  // Blocks are stacked with no blank line between them, so a heading is
  // normally preceded by the indented last line of the block above. Treating
  // that as a continuation merged the two and reported a duplicated field.
  const headings = blockHeadings([
    "Groq - first",
    "    usage tracking: tracked",
    "    some/model-id",
    "Cerebras - second, no blank line above",
    "    usage tracking: none found",
    ""
  ].join("\n"));
  assert.ok(headings.has("cerebras"), "a stacked heading must not merge into the block above");
  assert.equal(headings.get("groq").flat().filter((l) => /usage tracking:/.test(l)).length, 1);
});

test("a trailing 'not configured' clause does not exempt a tracked block", () => {
  // The document writes a verdict and then a qualifying clause. Matching the
  // phrase anywhere in the line exempted a block that says tracked, which is
  // precisely the block the check exists to find.
  const headings = blockHeadings([
    "Venice - removed from the config",
    "    usage tracking: tracked via /api/user/self, though the balance meter is not configured",
    ""
  ].join("\n"));
  assert.deepEqual(orphanedBlocks(headings, new Set()), ["venice"]);
});

test("the exemption still covers a real not-configured block with a trailing clause", () => {
  const headings = blockHeadings([
    "Deepseek - never connected",
    "    usage tracking: not configured in CCR, so not probed",
    ""
  ].join("\n"));
  assert.deepEqual(orphanedBlocks(headings, new Set()), []);
});

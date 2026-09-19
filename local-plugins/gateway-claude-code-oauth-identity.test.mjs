import assert from "node:assert/strict";
import { test } from "node:test";
import { applyIdentity, usesClaudeCodeOauth, CLAUDE_CODE_IDENTITY }
  from "./gateway-claude-code-oauth-identity.mjs";

const msgs = [{ role: "user", content: "hi" }];
const firstText = (body) =>
  typeof body.system[0] === "string" ? body.system[0] : body.system[0].text;

test("adds the block when no system is present", () => {
  const { applied, body } = applyIdentity({ messages: msgs });
  assert.equal(applied, true);
  assert.equal(firstText(body), CLAUDE_CODE_IDENTITY);
});

test("keeps an existing string system as a second block", () => {
  const { applied, body } = applyIdentity({ messages: msgs, system: "be terse" });
  assert.equal(applied, true);
  assert.equal(body.system.length, 2);
  assert.equal(firstText(body), CLAUDE_CODE_IDENTITY);
  assert.equal(body.system[1].text, "be terse");
});

test("prepends to an existing array without dropping anything", () => {
  const original = [{ type: "text", text: "a" }, { type: "text", text: "b" }];
  const { applied, body } = applyIdentity({ messages: msgs, system: original });
  assert.equal(applied, true);
  assert.equal(body.system.length, 3);
  assert.deepEqual(body.system.slice(1), original);
  assert.equal(original.length, 2);
});

test("leads a block that only begins with the identity", () => {
  // Adapting for a non-Anthropic protocol flattens the CLI's two blocks into
  // one string, and the API refuses that, so it still has to be led.
  const flattened = `${CLAUDE_CODE_IDENTITY}\nYou are an interactive agent that helps.`;
  for (const system of [flattened, [{ type: "text", text: flattened }]]) {
    const { applied, body } = applyIdentity({ messages: msgs, system });
    assert.equal(applied, true);
    assert.equal(firstText(body), CLAUDE_CODE_IDENTITY);
    assert.equal(body.system.length, 2);
  }
});

test("leads a system whose identity is not first", () => {
  const system = [{ type: "text", text: "other" }, { type: "text", text: CLAUDE_CODE_IDENTITY }];
  assert.equal(applyIdentity({ messages: msgs, system }).applied, true);
});

test("leaves a request that already leads with the exact identity untouched", () => {
  for (const system of [
    [{ type: "text", text: CLAUDE_CODE_IDENTITY }],
    [{ type: "text", text: CLAUDE_CODE_IDENTITY, cache_control: { type: "ephemeral" } }],
    [{ type: "text", text: CLAUDE_CODE_IDENTITY }, { type: "text", text: "more" }],
    [CLAUDE_CODE_IDENTITY],
    CLAUDE_CODE_IDENTITY
  ]) {
    assert.equal(applyIdentity({ messages: msgs, system }).applied, false);
  }
});

test("ignores a body that is not an Anthropic Messages body", () => {
  for (const body of [undefined, null, {}, { input: [] }, { messages: "no" }]) {
    assert.equal(applyIdentity(body).applied, false);
  }
});

test("does not mutate the body it was given", () => {
  const body = { messages: msgs, system: [{ type: "text", text: "a" }] };
  applyIdentity(body);
  assert.equal(body.system.length, 1);
});

test("matches only a request carrying the oauth beta", () => {
  assert.equal(usesClaudeCodeOauth({ headers: { "anthropic-beta": "oauth-2025-04-20" } }), true);
  assert.equal(usesClaudeCodeOauth({ headers: { "Anthropic-Beta": "a,oauth-2025-04-20,b" } }), true);
  assert.equal(usesClaudeCodeOauth({ headers: { "anthropic-beta": "other-2024-01-01" } }), false);
  assert.equal(usesClaudeCodeOauth({ headers: {} }), false);
  assert.equal(usesClaudeCodeOauth({}), false);
});

test("a decline says why, except when the identity is already there", () => {
  // Without the block Anthropic answers an empty 429, which reads as an
  // exhausted plan. A silent decline is that same symptom with no cause.
  const already = applyIdentity({ messages: [], system: [{ type: "text", text: CLAUDE_CODE_IDENTITY }] });
  assert.equal(already.applied, false);
  assert.equal(already.declined, undefined, "the benign case must stay quiet");

  const notMessages = applyIdentity({ prompt: "hi" });
  assert.match(notMessages.declined, /not an Anthropic messages request/);

  const oddSystem = applyIdentity({ messages: [], system: { text: "you are helpful" } });
  assert.equal(oddSystem.applied, false);
  assert.match(oddSystem.declined, /neither a string nor an array/);
});

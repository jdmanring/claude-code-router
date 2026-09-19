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
});

test("leaves a request that already identifies itself untouched", () => {
  const already = { messages: msgs, system: [{ type: "text", text: `${CLAUDE_CODE_IDENTITY} Extra.` }] };
  const { applied, body } = applyIdentity(already);
  assert.equal(applied, false);
  assert.equal(body, already);
});

test("leaves a string system that already identifies itself untouched", () => {
  const already = { messages: msgs, system: CLAUDE_CODE_IDENTITY };
  assert.equal(applyIdentity(already).applied, false);
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

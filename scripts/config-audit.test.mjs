// node --test scripts/config-audit.test.mjs
//
// The audit's dangerous failure is a false "matches baseline": a value that
// decides behaviour, changed, and not reported. Its blind spot has already
// been real once - the provider-level base url was absent from the snapshot
// while a capability url was present, so a base url corrupted to a doubled
// slash passed clean. These pin the fields the snapshot must carry.

import assert from "node:assert/strict";
import test from "node:test";

import { flatten, secretLength, snapshot, danglingChainEntries } from "./config-audit.mjs";

const providerConfig = (overrides = {}) => ({
  Providers: [{
    api_base_url: "https://api.example/v1",
    api_key: "sk-0123456789",
    capabilities: [{ baseUrl: "https://api.example/v1", type: "openai_chat_completions" }],
    models: ["a", "b"],
    name: "Example",
    protocolDetectionMode: "manual",
    ...overrides
  }]
});

test("a credential is reduced to its length, never carried", () => {
  const taken = snapshot(providerConfig());
  const text = JSON.stringify(taken);
  assert.equal(taken.providers.Example.apiKey, `len:${"sk-0123456789".length}`);
  assert.ok(!text.includes("sk-0123456789"), "the baseline must not hold the secret");
});

test("secretLength separates absent from present without revealing either", () => {
  assert.equal(secretLength(""), "absent");
  assert.equal(secretLength(undefined), "absent");
  assert.equal(secretLength("abc"), "len:3");
});

test("the provider base url is watched, not only the capability url", () => {
  // The regression this file exists for: a doubled slash here is answered 404
  // by the host before any credential is read, and it passed the audit clean.
  const before = flatten(snapshot(providerConfig()), "", new Map());
  const after = flatten(snapshot(providerConfig({ api_base_url: "https://api.example//v1" })), "", new Map());
  assert.notEqual(before.get("providers.Example.baseUrl"), after.get("providers.Example.baseUrl"));
});

test("a usage connector moving to a different endpoint is drift", () => {
  const withConnector = (endpoint) => providerConfig({
    account: { connectors: [{ endpoint, type: "http-json" }], enabled: true }
  });
  const before = flatten(snapshot(withConnector("https://api.example/v1/credits")), "", new Map());
  const after = flatten(snapshot(withConnector("https://api.example/v1/status")), "", new Map());
  // flatten joins a list into one value, so the key is the list itself.
  assert.notEqual(
    before.get("providers.Example.usageConnectors"),
    after.get("providers.Example.usageConnectors")
  );
});

test("disabling usage tracking is drift, not a silent empty list", () => {
  const on = snapshot(providerConfig({ account: { connectors: [{ endpoint: "https://api.example/v1/credits", type: "http-json" }], enabled: true } }));
  const off = snapshot(providerConfig({ account: { connectors: [{ endpoint: "https://api.example/v1/credits", type: "http-json" }], enabled: false } }));
  assert.deepEqual(on.providers.Example.usageConnectors, ["https://api.example/v1/credits"]);
  assert.deepEqual(off.providers.Example.usageConnectors, []);
});

test("flatten reaches every leaf, so a nested change cannot hide", () => {
  const keys = [...flatten(snapshot(providerConfig()), "", new Map()).keys()];
  for (const expected of [
    "providers.Example.baseUrl",
    "providers.Example.apiKey",
    "providers.Example.modelCount",
    "providers.Example.enabled",
    "providers.Example.protocolDetectionMode",
    "providers.Example.capabilities",
    "providers.Example.usageConnectors"
  ]) assert.ok(keys.includes(expected), `snapshot lost ${expected}`);
});

test("a chain entry naming a removed provider is reported", () => {
  // Removing a provider is a deliberate change, so the baseline gets re-taken
  // and the drift check goes quiet. The entries pointing at it stay behind.
  const config = {
    Providers: [{ models: ["m1"], name: "Groq" }],
    profile: { profiles: [{ routing: { rules: [{ fallback: { models: ["Groq/m1", "Meta/m9"] }, id: "r1" }] } }] }
  };
  assert.deepEqual(danglingChainEntries(config), [{ entry: "Meta/m9", reason: "no such provider", rule: "r1" }]);
});

test("a chain entry naming a withdrawn model is reported", () => {
  const config = {
    Providers: [{ models: ["glm-4.7-flash-free"], name: "VSLLM" }],
    profile: { profiles: [{ routing: { rules: [{ fallback: { models: ["VSLLM/glm-5.2-free"] }, id: "r1" }] } }] }
  };
  assert.deepEqual(danglingChainEntries(config),
    [{ entry: "VSLLM/glm-5.2-free", reason: "provider does not carry this model", rule: "r1" }]);
});

test("a provider whose name contains a slash is matched whole", () => {
  // Splitting on the first slash attributes "A/B/model" to a provider "A",
  // which does not exist, and reports a working entry as dangling.
  const config = {
    Providers: [{ models: ["x"], name: "Z.ai (Global) - General/Endpoint" }],
    profile: { profiles: [{ routing: { rules: [{ fallback: { models: ["Z.ai (Global) - General/Endpoint/x"] }, id: "r1" }] } }] }
  };
  assert.deepEqual(danglingChainEntries(config), []);
});

test("a disabled provider's chain entries are reported, not silently accepted", () => {
  const config = {
    Providers: [{ enabled: false, models: ["m1"], name: "Groq" }],
    profile: { profiles: [{ routing: { rules: [{ fallback: { models: ["Groq/m1"] }, id: "r1" }] } }] }
  };
  assert.equal(danglingChainEntries(config).length, 1);
});

test("a slot naming a model the provider no longer carries is reported", () => {
  // Cutting a provider's model list to one entry left the sonnet slot naming
  // a model that no longer existed. Every request for that agent was refused
  // before any chain was consulted, and the chain check could not see it
  // because a slot is not a chain entry.
  const config = {
    Providers: [{ models: ["mimo-v2.5-free"], name: "Zen" }],
    profile: { profiles: [{ routing: { rules: [] }, sonnetModel: "Zen/muse-spark-1.3-contributor-free" }] }
  };
  const found = danglingChainEntries(config);
  assert.equal(found.length, 1);
  assert.match(found[0].reason, /slot sonnetModel names a model/);
});

test("a slot that resolves is not reported", () => {
  const config = {
    Providers: [{ models: ["mimo-v2.5-free"], name: "Zen" }],
    profile: { profiles: [{ routing: { rules: [] }, sonnetModel: "Zen/mimo-v2.5-free" }] }
  };
  assert.deepEqual(danglingChainEntries(config), []);
});

/**
 * A rule whose rewrite was clobbered with a bare string. The router reads
 * `rewrite.value`, so the directive stops firing while the rule keeps
 * succeeding down its chain, and nothing else in the audit reports it. This
 * happened while reordering the classifier chain: the rewrite read `null`
 * afterwards and only the baseline diff showed it.
 */
const ruleConfig = (rewrite, models = ["Example/a", "Example/b"]) => ({
  ...providerConfig(),
  profile: { profiles: [{ name: "p", routing: { rules: [{ fallback: { models }, id: "r1", rewrite }] } }] }
});

test("a rewrite assigned a bare string is reported, not silently inert", () => {
  const found = danglingChainEntries(ruleConfig("Example/a"));
  assert.equal(found.length, 1, "a string rewrite has no .value and must be reported");
  assert.match(found[0].reason, /never fires/);
});

test("a rewrite naming a model that is not its chain head is reported", () => {
  const found = danglingChainEntries(ruleConfig({ key: "request.body.model", operation: "set", value: "Example/b" }));
  assert.equal(found.length, 1);
  assert.match(found[0].reason, /head of its chain/);
  assert.equal(found[0].entry, "Example/b");
});

test("a correctly shaped rewrite matching the chain head is silent", () => {
  // The negative control for both checks above: without it, a check that
  // fired on everything would pass the two tests that expect it to fire.
  assert.deepEqual(
    danglingChainEntries(ruleConfig({ key: "request.body.model", operation: "set", value: "Example/a" })),
    []
  );
});

test("a rule with no rewrite at all is silent", () => {
  // Most rules carry none, so a check that treated absent as broken would
  // report every one of them.
  assert.deepEqual(danglingChainEntries(ruleConfig(undefined)), []);
});

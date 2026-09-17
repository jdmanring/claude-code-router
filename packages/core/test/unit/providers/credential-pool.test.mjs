import assert from "node:assert/strict";
import test from "node:test";
import {
  providerCredentialsAllCooling,
  readProviderCredentialCooldown,
  recordProviderCredentialOutcome
} from "@ccr/core/providers/credential-pool.ts";
import {
  providerCredentialInternalName,
  providerCredentialRuntimeId
} from "@ccr/core/providers/runtime-topology.ts";

let fixtureSequence = 0;

function fixture() {
  fixtureSequence += 1;
  const first = { apiKey: "first-key", id: "first" };
  const second = { apiKey: "second-key", id: "second" };
  const provider = {
    credentials: [first, second],
    models: ["model-a"],
    name: `Credential Test ${fixtureSequence}`
  };
  const protocol = "openai_chat_completions";
  const internalName = providerCredentialInternalName(provider, protocol, first);
  return {
    attempt: {
      credentialChain: [internalName],
      credentialProtocol: protocol,
      logicalProvider: internalName
    },
    config: { Providers: [provider], virtualModelProfiles: [] },
    first,
    provider,
    second
  };
}

test("provider credential failures cool down the attempted credential and success clears it", () => {
  const { attempt, config, first, provider } = fixture();

  recordProviderCredentialOutcome(config, "POST", attempt, 503, new Headers());
  const cooldown = readProviderCredentialCooldown(provider, first);
  assert.equal(cooldown?.reason, "HTTP 503");
  assert.ok((cooldown?.until ?? 0) > Date.now());

  recordProviderCredentialOutcome(config, "POST", attempt, 204, new Headers());
  assert.equal(readProviderCredentialCooldown(provider, first), undefined);
});

test("upstream credential response identity takes precedence over the planned chain", () => {
  const { attempt, config, first, provider, second } = fixture();
  const headers = new Headers({
    "x-ccr-provider-credential-id": providerCredentialRuntimeId(provider, second)
  });

  recordProviderCredentialOutcome(config, "POST", attempt, 429, headers);

  assert.equal(readProviderCredentialCooldown(provider, first), undefined);
  assert.equal(readProviderCredentialCooldown(provider, second)?.reason, "HTTP 429");

  recordProviderCredentialOutcome(config, "POST", attempt, 200, headers);
  assert.equal(readProviderCredentialCooldown(provider, second), undefined);
});


test("a quota reset hours away outlives the flat one minute cooldown", () => {
  const { attempt, config, first, provider } = fixture();

  recordProviderCredentialOutcome(config, "POST", attempt, 429, new Headers({ "retry-after": "3600" }));
  const honored = readProviderCredentialCooldown(provider, first);
  assert.ok((honored?.until ?? 0) - Date.now() > 59 * 60 * 1000);

  // Negative control: without the header the cooldown stays at one minute.
  const bare = fixture();
  recordProviderCredentialOutcome(bare.config, "POST", bare.attempt, 429, new Headers());
  const flat = readProviderCredentialCooldown(bare.provider, bare.first);
  assert.ok((flat?.until ?? 0) - Date.now() <= 60 * 1000);

  // A header past the cap cannot retire the credential for the day.
  const capped = fixture();
  recordProviderCredentialOutcome(capped.config, "POST", capped.attempt, 429, new Headers({ "retry-after": "86400" }));
  const ceiling = readProviderCredentialCooldown(capped.provider, capped.first);
  assert.ok((ceiling?.until ?? 0) - Date.now() <= 6 * 60 * 60 * 1000);
});

test("a provider counts as cooling only when every active credential is cooling", () => {
  const { attempt, config, provider, second } = fixture();

  recordProviderCredentialOutcome(config, "POST", attempt, 429, new Headers());
  assert.equal(providerCredentialsAllCooling(provider, provider.credentials), false);

  recordProviderCredentialOutcome(
    config,
    "POST",
    attempt,
    429,
    new Headers({ "x-ccr-provider-credential-id": providerCredentialRuntimeId(provider, second) })
  );
  assert.equal(providerCredentialsAllCooling(provider, provider.credentials), true);
  assert.equal(providerCredentialsAllCooling(provider, []), false);
});

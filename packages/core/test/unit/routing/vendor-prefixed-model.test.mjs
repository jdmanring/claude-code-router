import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultAppConfig } from "@ccr/core/config/default-config.ts";
import { resolveConfiguredProviderModelSelector } from "@ccr/core/routing/model-resolution.ts";
import { modelRegistryForConfig } from "@ccr/core/routing/model-registry.ts";

// Measured against the running router: a model id whose first segment is
// "openai" reached the provider with that segment removed, so the provider was
// asked for a model it does not have and answered 400. Groq's
// "openai/gpt-oss-120b" and Fastrouter's "openai/gpt-oss-120b:free" both failed
// this way, while "qwen/..." and "google/..." on the same providers worked.
function configWith(models, extraProviders = []) {
  const config = createDefaultAppConfig();
  config.Providers = [
    { api_base_url: "https://probe.test/v1", api_key: "k", models, name: "Probe" },
    ...extraProviders
  ];
  return config;
}

test("a vendor-prefixed model keeps its prefix when only one provider offers it", () => {
  const config = configWith(["openai/clean-model"]);
  const resolved = resolveConfiguredProviderModelSelector("openai/clean-model", config);
  assert.equal(resolved?.provider.name, "Probe");
  assert.equal(resolved?.model, "openai/clean-model", "the vendor prefix must survive resolution");
});

test("a vendor-prefixed model is not confused with the bare model on the same provider", () => {
  const config = configWith(["clean-model", "openai/clean-model"]);
  const resolved = resolveConfiguredProviderModelSelector("openai/clean-model", config);
  assert.equal(resolved?.model, "openai/clean-model",
    "resolving must not collapse onto the bare id that sits beside it");
});

// The shape that actually occurs: another configured provider is named for the
// vendor that prefixes the model.
test("a provider named for the vendor does not capture another provider's prefixed model", () => {
  const config = configWith(["openai/gpt-oss-120b"], [
    { api_base_url: "https://api.openai.com/v1", api_key: "k", models: ["gpt-oss-120b"], name: "OpenAI" }
  ]);
  const resolved = resolveConfiguredProviderModelSelector("openai/gpt-oss-120b", config);
  assert.equal(resolved?.provider.name, "Probe", "the prefixed id belongs to the provider that lists it");
  assert.equal(resolved?.model, "openai/gpt-oss-120b", "and it must not be rewritten to the bare id");
});

test("registry resolution agrees with the selector resolver", () => {
  const config = configWith(["openai/gpt-oss-120b"], [
    { api_base_url: "https://api.openai.com/v1", api_key: "k", models: ["gpt-oss-120b"], name: "OpenAI" }
  ]);
  const ref = modelRegistryForConfig(config).resolve("openai/gpt-oss-120b");
  assert.equal(ref?.kind, "provider");
  assert.equal(ref?.model, "openai/gpt-oss-120b");
});

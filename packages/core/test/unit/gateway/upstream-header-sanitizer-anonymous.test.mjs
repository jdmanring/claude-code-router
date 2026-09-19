// A provider configured with no key must reach upstream with no credential.
//
// The vendored runtime resolves a missing provider key by falling back to the
// bearer on the inbound request, which is this gateway's own API key, and
// forwards it. A provider that takes no credential then sees a non-empty token
// it cannot verify and refuses.
//
// Measured 2026-09-19 against OVH, which is anonymous: 403 "Forbidden:
// authentication failed" on 585 consecutive requests through the chain, while
// the same model, url and body answered 200 with no authorization header. A
// deliberately invalid token reproduces the 403; an absent header does not.

import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayPlugin } from "@ccr/core/gateway/core-runtime/upstream-header-sanitizer.ts";

const hook = () => {
  const plugin = createGatewayPlugin();
  const entry = plugin.providerHooks?.[0] ?? plugin.providerHooks;
  return entry.transformRequest ?? entry;
};

const run = (upstreamRequest, targetProviderConfig) =>
  hook()({ request: { headers: {} }, targetProviderConfig, upstreamRequest });

test("an anonymous provider receives no credential of any kind", () => {
  const upstreamRequest = {
    body: "{}",
    headers: {
      authorization: "Bearer ccr-local-gateway-key",
      "content-type": "application/json"
    },
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions"
  };
  const result = run(upstreamRequest, { apikey: "", type: "openai_chat_completions" });
  const headers = (result?.value ?? upstreamRequest).headers;
  assert.equal(headers.authorization, undefined, "the gateway's own key was forwarded upstream");
  assert.equal(headers["content-type"], "application/json", "unrelated headers must survive");
});

test("a provider with a key keeps it", () => {
  // The control. Stripping unconditionally would break every real provider.
  const upstreamRequest = {
    body: "{}",
    headers: { authorization: "Bearer sk-provider-key" },
    url: "https://api.example.com/v1/chat/completions"
  };
  const result = run(upstreamRequest, { apikey: "sk-provider-key", type: "openai_chat_completions" });
  const headers = (result?.value ?? upstreamRequest).headers;
  assert.equal(headers.authorization, "Bearer sk-provider-key");
});

test("a whitespace-only key counts as no key", () => {
  const upstreamRequest = {
    body: "{}",
    headers: { authorization: "Bearer ccr-local-gateway-key" },
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions"
  };
  const result = run(upstreamRequest, { apikey: "   ", type: "openai_chat_completions" });
  const headers = (result?.value ?? upstreamRequest).headers;
  assert.equal(headers.authorization, undefined);
});

test("the alternative credential headers are stripped too", () => {
  const upstreamRequest = {
    body: "{}",
    headers: { "api-key": "leaked", "x-api-key": "leaked" },
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions"
  };
  const result = run(upstreamRequest, { apikey: undefined, type: "openai_chat_completions" });
  const headers = (result?.value ?? upstreamRequest).headers;
  assert.equal(headers["x-api-key"], undefined);
  assert.equal(headers["api-key"], undefined);
});

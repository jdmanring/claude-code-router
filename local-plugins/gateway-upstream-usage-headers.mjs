// Records the usage figures a provider puts in its response headers.
//
// Most providers on this install publish no account endpoint and report
// remaining capacity the way the OpenAI API does, in x-ratelimit-* on every
// response. Those headers never reach the CCR process: the vendored gateway
// child answers with its own x-gateway-* set, and the request log stores an
// empty header record for every upstream attempt. A response hook inside the
// child is the one place the real upstream Response is in scope.
//
// MEASURED DEAD on this install, kept as the probe that establishes it.
//
// Three hook kinds were tried and none is reached by the traffic here.
// `responseHooks` and `streamHooks` registered and never fired.
// `providerHooks.transformResponse` is handed the real upstream Response by
// the runtime's `applyProviderResponsePlugins`, but that function lives in
// `src/gateway/openai-json.ts` and is only reached on that adapter path. The
// decisive reading: on one `Claude Code API` request, with both plugins
// loaded, the identity plugin logged `transformRequest reached this dispatch
// path` while this plugin logged nothing. Same request, same host, same
// provider: the request side of a provider hook runs, the response side is
// never reached.
//
// So the usage figures the OpenAI convention publishes in response headers
// cannot be read from any extension point this runtime offers here. Changing
// that needs a change in the vendored runtime, not in this repository.
//
// Left present and disabled. Re-enable it to re-test after a runtime upgrade:
// if a line appears below the registration line, the path has opened.

import fs from "node:fs";
import path from "node:path";

export const manifest = {
  id: "upstream-usage-headers",
  name: "Upstream usage headers",
  version: "0.1.0"
};

// The OpenAI convention, plus the spellings seen from providers that predate
// it. Matched case-insensitively against the header name.
const USAGE_HEADER = /^(x-)?ratelimit[-_]|^x-rate-limit|^(x-)?quota|^x-credits?|^x-balance|^retry-after$/i;

export function usageHeaders(headers) {
  const found = {};
  if (!headers || typeof headers.forEach !== "function") return found;
  headers.forEach((value, name) => {
    if (USAGE_HEADER.test(name)) found[name.toLowerCase()] = String(value);
  });
  return found;
}

export function createGatewayPlugin(context = {}) {
  const dir = context.dataDir ?? process.env.CCR_INTERNAL_APP_DATA_DIR ?? path.join(process.env.HOME ?? ".", ".claude-code-router", "app-data");
  const file = path.join(dir, "upstream-usage-headers.json");
  console.log(`[upstream-usage-headers] response hook registered, writing ${file}`);

  const record = (label, input) => {
    try {
      const response = input?.upstreamResponse;
      const found = usageHeaders(response?.headers);
      const provider = input?.targetProvider ?? input?.targetProviderConfig?.provider ?? input?.model ?? "(unknown)";
      console.log(`[upstream-usage-headers] ${label} provider=${provider} usage-headers=${Object.keys(found).length}`
        + (Object.keys(found).length > 0 ? ` ${JSON.stringify(found)}` : ""));
      if (Object.keys(found).length === 0) return;
      let store = {};
      try { store = JSON.parse(fs.readFileSync(file, "utf8")); } catch { store = {}; }
      store[provider] = { headers: found, model: input?.model, observedAt: new Date().toISOString() };
      fs.writeFileSync(file, JSON.stringify(store, null, 1));
    } catch (error) {
      console.log(`[upstream-usage-headers] ${label} failed: ${String(error?.message ?? error)}`);
    }
  };

  return {
    providerHooks: [
      {
        key: "upstream-usage-headers",
        transformResponse(input) {
          record("provider", input);
          // Returning the payload unchanged keeps this observation only.
          return { ok: true, value: input.upstreamPayload };
        }
      }
    ]
  };
}

export default createGatewayPlugin;

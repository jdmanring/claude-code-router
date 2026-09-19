// Records the usage figures a provider puts in its response headers.
//
// Most providers on this install publish no account endpoint and report
// remaining capacity the way the OpenAI API does, in x-ratelimit-* on every
// response. Those headers never reach the CCR process: the vendored gateway
// child answers with its own x-gateway-* set, and the request log stores an
// empty header record for every upstream attempt. A response hook inside the
// child is the one place the real upstream Response is in scope.
//
// This stage is deliberately observation only. It writes what it sees to a
// JSON file and changes no response.

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
    responseHooks: [{
      key: "upstream-usage-headers-response",
      transformResponse(input) { record("response", input); return undefined; }
    }],
    streamHooks: [{
      key: "upstream-usage-headers-stream",
      transformResponse(input) { record("stream", input); return undefined; }
    }]
  };
}

export default createGatewayPlugin;

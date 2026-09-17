import type { ProviderAccountConfig } from "@ccr/core/contracts/app";
import type { ProviderPreset } from "@ccr/core/providers/presets/types";

// Electron Hub documents this as "Get Usage" and serves it from the same host
// as inference. Every other path on that host answers with a Cloudflare
// challenge, including paths that do not exist, so the endpoint has to come
// from the documentation rather than from probing. Their reference notes the
// figures can be read once a minute without drawing on the request quota.
const electronHubProviderAccountConfig: ProviderAccountConfig = {
  connectors: [
    {
      auth: "provider-api-key",
      endpoint: "https://api.electronhub.ai/v1/user/me",
      mapping: {
        message: "$.subscription",
        meters: [
          {
            id: "credits",
            kind: "balance",
            label: "Credits",
            remaining: "$.credits",
            unit: "credits"
          },
          {
            id: "input_tokens",
            kind: "tokens",
            label: "Input tokens",
            unit: "tokens",
            used: "$.usage.input_tokens"
          },
          {
            id: "output_tokens",
            kind: "tokens",
            label: "Output tokens",
            unit: "tokens",
            used: "$.usage.output_tokens"
          }
        ]
      },
      type: "http-json"
    }
  ],
  enabled: true,
  refreshIntervalMs: 5 * 60 * 1000
};

export const electronHubProviderPreset: ProviderPreset = {
  account: electronHubProviderAccountConfig,
  aliases: ["electronhub", "electron hub", "electron-hub"],
  endpoints: [
    {
      baseUrl: "https://api.electronhub.ai/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "electronhub",
  name: "Electron Hub",
  websiteUrl: "https://www.electronhub.ai/"
};

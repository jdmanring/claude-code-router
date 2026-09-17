import type { ProviderAccountConfig } from "@ccr/core/contracts/app";
import type { ProviderPreset } from "@ccr/core/providers/presets/types";

// Shapes taken from Mistral's published OpenAPI document (LimitsOUT ->
// LimitsContext -> UsageLimits). The endpoint carries the beta.admin.billing
// tag and is declared with AdminApiKey security, so it answers for an
// organization admin key and returns 401 for an ordinary inference key.
const mistralProviderAccountConfig: ProviderAccountConfig = {
  connectors: [
    {
      auth: "provider-api-key",
      endpoint: "https://api.mistral.ai/v1/admin/spend-limit",
      mapping: {
        meters: [
          {
            id: "monthly_spend",
            kind: "quota",
            label: "Monthly spend",
            limit: "$.limits.completion.usage_limit",
            unit: "USD",
            used: "$.limits.completion.total_usage",
            window: "monthly"
          },
          {
            id: "completion_usage",
            kind: "quota",
            label: "Completion spend",
            unit: "USD",
            used: "$.limits.completion.usage",
            window: "monthly"
          },
          {
            // The Vibe pool is billed against the same organization limit.
            // Per-agent and per-workspace breakdowns live under
            // /v1/admin/analytics/vibe/, but those require a start_time and
            // end_time window that a static connector cannot supply.
            id: "vibe_usage",
            kind: "quota",
            label: "Vibe spend",
            unit: "USD",
            used: "$.limits.completion.vibe_usage",
            window: "monthly"
          }
        ]
      },
      type: "http-json"
    }
  ],
  enabled: true
};

export const mistralProviderPreset: ProviderPreset = {
  account: mistralProviderAccountConfig,
  aliases: ["mistral"],
  endpoints: [
    {
      baseUrl: "https://api.mistral.ai/v1",
      protocols: ["openai_chat_completions"]
    },
    {
      // Codestral has its own host and key, separate from the main API.
      baseUrl: "https://codestral.mistral.ai/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "mistral",
  name: "Mistral",
  websiteUrl: "https://mistral.ai/"
};

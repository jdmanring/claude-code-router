import type { ProviderAccountConfig } from "@ccr/core/contracts/app";
import type { ProviderPreset } from "@ccr/core/providers/presets/types";

// Mistral publishes usage only through its Admin API, which its documentation
// describes as an Enterprise-only feature in preview. That API rejects an
// ordinary inference key outright ("Standard workspace/inference API keys are
// rejected"), takes an Admin API key issued from backoffice.mistral.ai, and
// reads it from an x-api-key header rather than a bearer token.
//
// CCR can only place a provider's own key in the authorization header, and the
// admin key is a different key in any case, so this connector cannot work from
// the preset alone and ships disabled rather than producing a permanent 401.
// An Enterprise organization enables it and supplies the key as a header:
//
//   account.connectors[0].headers = { "x-api-key": "<admin key>" }
//   account.enabled = true
//
// Shapes are taken from the published OpenAPI document, LimitsOUT ->
// LimitsContext -> UsageLimits.
const mistralProviderAccountConfig: ProviderAccountConfig = {
  connectors: [
    {
      auth: "none",
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
  enabled: false
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

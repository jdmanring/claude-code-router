import type { ProviderPreset } from "@ccr/core/providers/presets/types";

// Cloudflare addresses an account through the URL rather than a header, so the
// endpoint cannot be a constant. The account id is the 32 hex characters shown
// on the dashboard overview and returned by `wrangler whoami`.
export const cloudflareWorkersAiProviderPreset: ProviderPreset = {
  aliases: ["cloudflare", "cloudflare workers ai", "workers ai"],
  endpoints: [
    {
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "cloudflare-workers-ai",
  name: "Cloudflare Workers AI",
  variables: [
    {
      description: "The 32 character id on your Cloudflare dashboard overview, also printed by `wrangler whoami`.",
      key: "accountId",
      label: "Account ID",
      pattern: "[0-9a-fA-F]{32}",
      placeholder: "0123456789abcdef0123456789abcdef"
    }
  ],
  websiteUrl: "https://developers.cloudflare.com/workers-ai/"
};

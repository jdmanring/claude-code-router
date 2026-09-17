import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const bazaarlinkProviderPreset: ProviderPreset = {
  aliases: ["bazaarlink"],
  endpoints: [
    {
      baseUrl: "https://api.bazaarlink.ai/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "bazaarlink",
  name: "Bazaarlink",
  websiteUrl: "https://bazaarlink.ai"
};

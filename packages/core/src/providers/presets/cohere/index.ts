import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const cohereProviderPreset: ProviderPreset = {
  aliases: ["cohere"],
  endpoints: [
    {
      baseUrl: "https://api.cohere.ai/compatibility/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "cohere",
  name: "Cohere",
  websiteUrl: "https://cohere.ai"
};

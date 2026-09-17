import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const veniceProviderPreset: ProviderPreset = {
  aliases: ["venice"],
  endpoints: [
    {
      baseUrl: "https://api.venice.ai/api/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "venice",
  name: "Venice",
  websiteUrl: "https://venice.ai"
};

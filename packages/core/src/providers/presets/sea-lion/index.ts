import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const seaLionProviderPreset: ProviderPreset = {
  aliases: ["sea lion", "sea-lion"],
  endpoints: [
    {
      baseUrl: "https://api.sea-lion.ai/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "sea-lion",
  name: "SEA-LION",
  websiteUrl: "https://sea-lion.ai"
};

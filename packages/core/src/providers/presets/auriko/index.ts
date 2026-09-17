import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const aurikoProviderPreset: ProviderPreset = {
  aliases: ["auriko"],
  endpoints: [
    {
      baseUrl: "https://api.auriko.ai/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "auriko",
  name: "Auriko",
  websiteUrl: "https://auriko.ai"
};

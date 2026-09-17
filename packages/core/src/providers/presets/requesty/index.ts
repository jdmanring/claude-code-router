import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const requestyProviderPreset: ProviderPreset = {
  aliases: ["requesty"],
  endpoints: [
    {
      baseUrl: "https://router.requesty.ai/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "requesty",
  name: "Requesty",
  websiteUrl: "https://requesty.ai"
};

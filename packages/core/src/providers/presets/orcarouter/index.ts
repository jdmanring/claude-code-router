import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const orcarouterProviderPreset: ProviderPreset = {
  aliases: ["orcarouter"],
  endpoints: [
    {
      baseUrl: "https://api.orcarouter.ai/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "orcarouter",
  name: "Orcarouter",
  websiteUrl: "https://orcarouter.ai"
};

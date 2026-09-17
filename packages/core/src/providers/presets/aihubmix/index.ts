import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const aihubmixProviderPreset: ProviderPreset = {
  aliases: ["aihubmix"],
  endpoints: [
    {
      baseUrl: "https://aihubmix.com/v1",
      protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "aihubmix",
  name: "AIHubMix",
  websiteUrl: "https://aihubmix.com"
};

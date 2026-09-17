import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const routewayProviderPreset: ProviderPreset = {
  aliases: ["routeway"],
  endpoints: [
    {
      baseUrl: "https://api.routeway.ai/v1",
      protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "routeway",
  name: "Routeway",
  websiteUrl: "https://routeway.ai"
};

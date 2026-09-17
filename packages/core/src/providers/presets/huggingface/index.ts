import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const huggingfaceProviderPreset: ProviderPreset = {
  aliases: ["huggingface"],
  endpoints: [
    {
      baseUrl: "https://router.huggingface.co/v1",
      protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "huggingface",
  name: "Huggingface",
  websiteUrl: "https://huggingface.co"
};

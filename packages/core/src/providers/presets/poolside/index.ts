import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const poolsideProviderPreset: ProviderPreset = {
  aliases: ["poolside"],
  endpoints: [
    {
      baseUrl: "https://inference.poolside.ai/v1",
      protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "poolside",
  name: "Poolside",
  websiteUrl: "https://poolside.ai"
};

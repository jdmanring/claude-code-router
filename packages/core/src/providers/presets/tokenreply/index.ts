import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const tokenreplyProviderPreset: ProviderPreset = {
  aliases: ["tokenreply"],
  endpoints: [
    {
      baseUrl: "https://api.tokenreply.com/v1",
      protocols: ["anthropic_messages", "gemini_generate_content", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "tokenreply",
  name: "Tokenreply",
  websiteUrl: "https://tokenreply.com"
};

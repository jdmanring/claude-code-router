import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const fastrouterProviderPreset: ProviderPreset = {
  aliases: ["fastrouter"],
  endpoints: [
    {
      baseUrl: "https://api.fastrouter.ai/api/v1",
      protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "fastrouter",
  name: "Fastrouter",
  websiteUrl: "https://fastrouter.ai"
};

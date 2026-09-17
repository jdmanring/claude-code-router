import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const groqProviderPreset: ProviderPreset = {
  aliases: ["groq"],
  endpoints: [
    {
      baseUrl: "https://api.groq.com/openai/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "groq",
  name: "Groq",
  websiteUrl: "https://groq.com"
};

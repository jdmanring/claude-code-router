import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const llm7ProviderPreset: ProviderPreset = {
  aliases: ["llm7"],
  endpoints: [
    {
      baseUrl: "https://api.llm7.io/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "llm7",
  name: "llm7",
  websiteUrl: "https://llm7.io"
};

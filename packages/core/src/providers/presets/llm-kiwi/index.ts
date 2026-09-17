import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const llmKiwiProviderPreset: ProviderPreset = {
  aliases: ["llm kiwi", "llm-kiwi", "llm.kiwi"],
  endpoints: [
    {
      baseUrl: "https://api.llm.kiwi/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "llm-kiwi",
  name: "LLM.kiwi",
  websiteUrl: "https://llm.kiwi"
};

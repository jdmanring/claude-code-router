import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const ollamaProviderPreset: ProviderPreset = {
  aliases: ["ollama"],
  endpoints: [
    {
      baseUrl: "https://ollama.com/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "ollama",
  name: "Ollama",
  websiteUrl: "https://ollama.com"
};

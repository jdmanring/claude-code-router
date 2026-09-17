import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const sambanovaProviderPreset: ProviderPreset = {
  aliases: ["sambanova"],
  endpoints: [
    {
      baseUrl: "https://api.sambanova.ai/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "sambanova",
  name: "Sambanova",
  websiteUrl: "https://sambanova.ai"
};

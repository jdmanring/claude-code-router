import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const pooledProviderPreset: ProviderPreset = {
  aliases: ["pooled"],
  endpoints: [
    {
      baseUrl: "https://ai.pooled.dev/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "pooled",
  name: "Pooled",
  websiteUrl: "https://ai.pooled.dev"
};

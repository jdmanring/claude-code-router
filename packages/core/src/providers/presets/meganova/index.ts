import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const meganovaProviderPreset: ProviderPreset = {
  aliases: ["meganova"],
  endpoints: [
    {
      baseUrl: "https://api.meganova.ai/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "meganova",
  name: "MegaNova",
  websiteUrl: "https://meganova.ai"
};

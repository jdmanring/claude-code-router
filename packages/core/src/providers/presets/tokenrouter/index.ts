import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const tokenrouterProviderPreset: ProviderPreset = {
  aliases: ["tokenrouter"],
  endpoints: [
    {
      baseUrl: "https://api.tokenrouter.com/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "tokenrouter",
  name: "Tokenrouter",
  websiteUrl: "https://tokenrouter.com"
};

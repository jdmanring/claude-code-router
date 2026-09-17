import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const literouterProviderPreset: ProviderPreset = {
  aliases: ["literouter"],
  endpoints: [
    {
      baseUrl: "https://api.literouter.com/v1",
      protocols: ["openai_chat_completions", "openai_responses"]
    }
  ],
  id: "literouter",
  name: "Literouter",
  websiteUrl: "https://literouter.com"
};

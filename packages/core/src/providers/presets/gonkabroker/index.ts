import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const gonkabrokerProviderPreset: ProviderPreset = {
  aliases: ["gonkabroker"],
  endpoints: [
    {
      baseUrl: "https://proxy.gonkabroker.com/v1",
      protocols: ["openai_chat_completions", "openai_responses"]
    }
  ],
  id: "gonkabroker",
  name: "GonkaBroker",
  websiteUrl: "https://gonkabroker.com"
};

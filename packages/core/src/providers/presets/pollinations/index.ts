import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const pollinationsProviderPreset: ProviderPreset = {
  aliases: ["pollinations"],
  endpoints: [
    {
      baseUrl: "https://gen.pollinations.ai",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "pollinations",
  name: "Pollinations",
  websiteUrl: "https://gen.pollinations.ai"
};

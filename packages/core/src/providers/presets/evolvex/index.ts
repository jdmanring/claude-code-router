import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const evolvexProviderPreset: ProviderPreset = {
  aliases: ["evolvex"],
  endpoints: [
    {
      baseUrl: "https://api.evolvex.gg/v1",
      protocols: ["anthropic_messages", "openai_chat_completions"]
    }
  ],
  id: "evolvex",
  name: "EvolveX",
  websiteUrl: "https://evolvex.gg"
};

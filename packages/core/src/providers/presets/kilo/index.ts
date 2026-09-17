import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const kiloProviderPreset: ProviderPreset = {
  aliases: ["kilo"],
  endpoints: [
    {
      baseUrl: "https://api.kilo.ai/api/gateway",
      protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions"]
    }
  ],
  id: "kilo",
  name: "Kilo",
  websiteUrl: "https://kilo.ai"
};

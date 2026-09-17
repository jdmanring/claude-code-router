import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const metaProviderPreset: ProviderPreset = {
  aliases: ["meta"],
  endpoints: [
    {
      baseUrl: "https://api.meta.ai//v1",
      protocols: ["anthropic_messages"]
    }
  ],
  id: "meta",
  name: "Meta",
  websiteUrl: "https://meta.ai"
};

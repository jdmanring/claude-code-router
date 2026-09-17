import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const v0ProviderPreset: ProviderPreset = {
  aliases: ["v0"],
  endpoints: [
    {
      baseUrl: "https://api.v0.dev/v2/chats",
      protocols: ["anthropic_messages"]
    }
  ],
  id: "v0",
  name: "v0",
  websiteUrl: "https://v0.dev"
};

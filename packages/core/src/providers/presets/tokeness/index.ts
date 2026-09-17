import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const tokenessProviderPreset: ProviderPreset = {
  aliases: ["tokeness"],
  endpoints: [
    {
      baseUrl: "https://n-us.tokeness.dev/v1",
      protocols: ["anthropic_messages"]
    }
  ],
  id: "tokeness",
  name: "Tokeness",
};

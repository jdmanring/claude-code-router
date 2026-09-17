import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const xkiroProviderPreset: ProviderPreset = {
  aliases: ["xkiro"],
  endpoints: [
    {
      baseUrl: "https://api.xkiro.com/v1",
      protocols: ["anthropic_messages", "openai_chat_completions"]
    }
  ],
  id: "xkiro",
  name: "XKIRO",
  websiteUrl: "https://xkiro.com"
};

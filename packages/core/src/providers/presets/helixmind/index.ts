import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const helixmindProviderPreset: ProviderPreset = {
  aliases: ["helixmind"],
  endpoints: [
    {
      baseUrl: "https://helixmind.online/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "helixmind",
  name: "Helixmind",
  websiteUrl: "https://helixmind.online"
};

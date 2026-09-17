import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const nagaProviderPreset: ProviderPreset = {
  aliases: ["naga"],
  endpoints: [
    {
      baseUrl: "https://api.naga.ac/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "naga",
  name: "Naga",
  websiteUrl: "https://naga.ac"
};

import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const mixlayerProviderPreset: ProviderPreset = {
  aliases: ["mixlayer"],
  endpoints: [
    {
      baseUrl: "https://models.mixlayer.ai/v1",
      protocols: ["openai_chat_completions", "openai_responses"]
    }
  ],
  id: "mixlayer",
  name: "Mixlayer",
};

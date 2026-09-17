import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const opencodeZenProviderPreset: ProviderPreset = {
  aliases: ["opencode zen", "zen"],
  endpoints: [
    {
      baseUrl: "https://opencode.ai/zen/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "opencode-zen",
  name: "OpenCode Zen",
  websiteUrl: "https://opencode.ai"
};

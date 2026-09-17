import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const codexProviderPreset: ProviderPreset = {
  aliases: ["codex"],
  endpoints: [
    {
      baseUrl: "https://chatgpt.com/backend-api/codex",
      protocols: ["openai_responses"]
    }
  ],
  id: "codex",
  name: "Codex",
  websiteUrl: "https://chatgpt.com"
};

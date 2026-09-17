import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const zyloaiProviderPreset: ProviderPreset = {
  aliases: ["zyloai"],
  endpoints: [
    {
      baseUrl: "https://api.zyloai.net/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "zyloai",
  name: "ZyloAI",
  websiteUrl: "https://zyloai.net"
};

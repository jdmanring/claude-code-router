import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const agnesFreeProviderPreset: ProviderPreset = {
  aliases: ["agnes free", "agnes-free", "agnes-paid"],
  endpoints: [
    {
      baseUrl: "https://apihub.agnes-ai.com/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "agnes-free",
  name: "Agnes-Free",
  websiteUrl: "https://apihub.agnes-ai.com"
};

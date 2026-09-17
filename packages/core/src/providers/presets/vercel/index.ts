import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const vercelProviderPreset: ProviderPreset = {
  aliases: ["vercel"],
  endpoints: [
    {
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "vercel",
  name: "Vercel",
  websiteUrl: "https://ai-gateway.vercel.sh"
};

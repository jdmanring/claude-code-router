import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const internAiProviderPreset: ProviderPreset = {
  aliases: ["intern ai", "intern-ai"],
  endpoints: [
    {
      baseUrl: "https://chat.intern-ai.org.cn/api/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "intern-ai",
  name: "Intern AI",
  websiteUrl: "https://chat.intern-ai.org.cn"
};

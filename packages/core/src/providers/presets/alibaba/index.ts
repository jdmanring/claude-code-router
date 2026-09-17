import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const alibabaProviderPreset: ProviderPreset = {
  aliases: ["alibaba"],
  endpoints: [
    {
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      protocols: ["openai_chat_completions", "openai_responses"]
    }
  ],
  id: "alibaba",
  name: "Alibaba",
};

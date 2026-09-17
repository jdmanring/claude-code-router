import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const yoloAutoProviderPreset: ProviderPreset = {
  aliases: ["yolo auto", "yolo-auto"],
  endpoints: [
    {
      baseUrl: "https://yolo-auto.com/v1",
      protocols: ["openai_chat_completions"]
    }
  ],
  id: "yolo-auto",
  name: "Yolo-Auto",
  websiteUrl: "https://yolo-auto.com"
};

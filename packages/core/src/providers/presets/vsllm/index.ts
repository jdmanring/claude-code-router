import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const vsllmProviderPreset: ProviderPreset = {
  aliases: ["vsllm"],
  endpoints: [
    {
      baseUrl: "https://vsllm.cc/v1",
      protocols: ["anthropic_messages"]
    }
  ],
  id: "vsllm",
  name: "VSLLM",
  websiteUrl: "https://vsllm.cc"
};

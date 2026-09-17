import type { ProviderPreset } from "@ccr/core/providers/presets/types";

export const ovhProviderPreset: ProviderPreset = {
  aliases: ["ovh"],
  endpoints: [
    {
      baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
      protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"]
    }
  ],
  id: "ovh",
  name: "OVH",
  websiteUrl: "https://ovh.net"
};

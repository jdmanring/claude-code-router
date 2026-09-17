import type { GatewayProviderProtocol } from "@ccr/core/contracts/app";
import type { ProviderPreset } from "@ccr/core/providers/presets/types";

// Hosted OpenAI-compatible gateways that CCR can reach but has no dedicated
// preset for. Every entry was confirmed against the live service: the base URL
// answered a model listing with a working key, and the website answered a
// request. None of them serves an account or usage endpoint, so none carries an
// account config at all; an all-disabled one is not the same as its absence,
// because an imported provider would then hold an empty object rather than
// nothing.
//
// A provider whose base URL embeds an account identifier, or which addresses a
// process on the local machine, is deliberately absent: neither is meaningful
// to anyone else.
type CommunityProviderEntry = {
  aliases: string[];
  baseUrl: string;
  id: string;
  name: string;
  protocols: GatewayProviderProtocol[];
  websiteUrl?: string;
};

const communityProviderEntries: CommunityProviderEntry[] = [
  {
    aliases: ["opencode zen", "zen"],
    baseUrl: "https://opencode.ai/zen/v1",
    id: "opencode-zen",
    name: "OpenCode Zen",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://opencode.ai"
  },
  {
    aliases: ["agnes free", "agnes-free", "agnes-paid"],
    baseUrl: "https://apihub.agnes-ai.com/v1",
    id: "agnes-free",
    name: "Agnes-Free",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://apihub.agnes-ai.com"
  },
  {
    aliases: ["aihubmix"],
    baseUrl: "https://aihubmix.com/v1",
    id: "aihubmix",
    name: "AIHubMix",
    protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://aihubmix.com"
  },
  {
    aliases: ["alibaba"],
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    id: "alibaba",
    name: "Alibaba",
    protocols: ["openai_chat_completions", "openai_responses"]
  },
  {
    aliases: ["auriko"],
    baseUrl: "https://api.auriko.ai/v1",
    id: "auriko",
    name: "Auriko",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://auriko.ai"
  },
  {
    aliases: ["bazaarlink"],
    baseUrl: "https://api.bazaarlink.ai/v1",
    id: "bazaarlink",
    name: "Bazaarlink",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://bazaarlink.ai"
  },
  {
    aliases: ["codex"],
    baseUrl: "https://chatgpt.com/backend-api/codex",
    id: "codex",
    name: "Codex",
    protocols: ["openai_responses"],
    websiteUrl: "https://chatgpt.com"
  },
  {
    aliases: ["cohere"],
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    id: "cohere",
    name: "Cohere",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://cohere.ai"
  },
  {
    aliases: ["evolvex"],
    baseUrl: "https://api.evolvex.gg/v1",
    id: "evolvex",
    name: "EvolveX",
    protocols: ["anthropic_messages", "openai_chat_completions"],
    websiteUrl: "https://evolvex.gg"
  },
  {
    aliases: ["fastrouter"],
    baseUrl: "https://api.fastrouter.ai/api/v1",
    id: "fastrouter",
    name: "Fastrouter",
    protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://fastrouter.ai"
  },
  {
    aliases: ["gonkabroker"],
    baseUrl: "https://proxy.gonkabroker.com/v1",
    id: "gonkabroker",
    name: "GonkaBroker",
    protocols: ["openai_chat_completions", "openai_responses"],
    websiteUrl: "https://gonkabroker.com"
  },
  {
    aliases: ["groq"],
    baseUrl: "https://api.groq.com/openai/v1",
    id: "groq",
    name: "Groq",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://groq.com"
  },
  {
    aliases: ["helixmind"],
    baseUrl: "https://helixmind.online/v1",
    id: "helixmind",
    name: "Helixmind",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://helixmind.online"
  },
  {
    aliases: ["huggingface"],
    baseUrl: "https://router.huggingface.co/v1",
    id: "huggingface",
    name: "Huggingface",
    protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://huggingface.co"
  },
  {
    aliases: ["intern ai", "intern-ai"],
    baseUrl: "https://chat.intern-ai.org.cn/api/v1",
    id: "intern-ai",
    name: "Intern AI",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://chat.intern-ai.org.cn"
  },
  {
    aliases: ["kilo"],
    baseUrl: "https://api.kilo.ai/api/gateway",
    id: "kilo",
    name: "Kilo",
    protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions"],
    websiteUrl: "https://kilo.ai"
  },
  {
    aliases: ["literouter"],
    baseUrl: "https://api.literouter.com/v1",
    id: "literouter",
    name: "Literouter",
    protocols: ["openai_chat_completions", "openai_responses"],
    websiteUrl: "https://literouter.com"
  },
  {
    aliases: ["llm kiwi", "llm-kiwi", "llm.kiwi"],
    baseUrl: "https://api.llm.kiwi/v1",
    id: "llm-kiwi",
    name: "LLM.kiwi",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://llm.kiwi"
  },
  {
    aliases: ["llm7"],
    baseUrl: "https://api.llm7.io/v1",
    id: "llm7",
    name: "llm7",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://llm7.io"
  },
  {
    aliases: ["meganova"],
    baseUrl: "https://api.meganova.ai/v1",
    id: "meganova",
    name: "MegaNova",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://meganova.ai"
  },
  {
    aliases: ["meta"],
    baseUrl: "https://api.meta.ai//v1",
    id: "meta",
    name: "Meta",
    protocols: ["anthropic_messages"],
    websiteUrl: "https://meta.ai"
  },
  {
    aliases: ["mixlayer"],
    baseUrl: "https://models.mixlayer.ai/v1",
    id: "mixlayer",
    name: "Mixlayer",
    protocols: ["openai_chat_completions", "openai_responses"]
  },
  {
    aliases: ["naga"],
    baseUrl: "https://api.naga.ac/v1",
    id: "naga",
    name: "Naga",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://naga.ac"
  },
  {
    aliases: ["ollama"],
    baseUrl: "https://ollama.com/v1",
    id: "ollama",
    name: "Ollama",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://ollama.com"
  },
  {
    aliases: ["orcarouter"],
    baseUrl: "https://api.orcarouter.ai/v1",
    id: "orcarouter",
    name: "Orcarouter",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://orcarouter.ai"
  },
  {
    aliases: ["ovh"],
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    id: "ovh",
    name: "OVH",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://ovh.net"
  },
  {
    aliases: ["pollinations"],
    baseUrl: "https://gen.pollinations.ai",
    id: "pollinations",
    name: "Pollinations",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://gen.pollinations.ai"
  },
  {
    aliases: ["pooled"],
    baseUrl: "https://ai.pooled.dev/v1",
    id: "pooled",
    name: "Pooled",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://ai.pooled.dev"
  },
  {
    aliases: ["poolside"],
    baseUrl: "https://inference.poolside.ai/v1",
    id: "poolside",
    name: "Poolside",
    protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://poolside.ai"
  },
  {
    aliases: ["requesty"],
    baseUrl: "https://router.requesty.ai/v1",
    id: "requesty",
    name: "Requesty",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://requesty.ai"
  },
  {
    aliases: ["routeway"],
    baseUrl: "https://api.routeway.ai/v1",
    id: "routeway",
    name: "Routeway",
    protocols: ["anthropic_messages", "gemini_generate_content", "gemini_interactions", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://routeway.ai"
  },
  {
    aliases: ["sambanova"],
    baseUrl: "https://api.sambanova.ai/v1",
    id: "sambanova",
    name: "Sambanova",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://sambanova.ai"
  },
  {
    aliases: ["sea lion", "sea-lion"],
    baseUrl: "https://api.sea-lion.ai/v1",
    id: "sea-lion",
    name: "SEA-LION",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://sea-lion.ai"
  },
  {
    aliases: ["tokeness"],
    baseUrl: "https://n-us.tokeness.dev/v1",
    id: "tokeness",
    name: "Tokeness",
    protocols: ["anthropic_messages"]
  },
  {
    aliases: ["tokenreply"],
    baseUrl: "https://api.tokenreply.com/v1",
    id: "tokenreply",
    name: "Tokenreply",
    protocols: ["anthropic_messages", "gemini_generate_content", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://tokenreply.com"
  },
  {
    aliases: ["tokenrouter"],
    baseUrl: "https://api.tokenrouter.com/v1",
    id: "tokenrouter",
    name: "Tokenrouter",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://tokenrouter.com"
  },
  {
    aliases: ["v0"],
    baseUrl: "https://api.v0.dev/v2/chats",
    id: "v0",
    name: "v0",
    protocols: ["anthropic_messages"],
    websiteUrl: "https://v0.dev"
  },
  {
    aliases: ["venice"],
    baseUrl: "https://api.venice.ai/api/v1",
    id: "venice",
    name: "Venice",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://venice.ai"
  },
  {
    aliases: ["vercel"],
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    id: "vercel",
    name: "Vercel",
    protocols: ["anthropic_messages", "openai_chat_completions", "openai_responses"],
    websiteUrl: "https://ai-gateway.vercel.sh"
  },
  {
    aliases: ["vsllm"],
    baseUrl: "https://vsllm.cc/v1",
    id: "vsllm",
    name: "VSLLM",
    protocols: ["anthropic_messages"],
    websiteUrl: "https://vsllm.cc"
  },
  {
    aliases: ["xkiro"],
    baseUrl: "https://api.xkiro.com/v1",
    id: "xkiro",
    name: "XKIRO",
    protocols: ["anthropic_messages", "openai_chat_completions"],
    websiteUrl: "https://xkiro.com"
  },
  {
    aliases: ["yolo auto", "yolo-auto"],
    baseUrl: "https://yolo-auto.com/v1",
    id: "yolo-auto",
    name: "Yolo-Auto",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://yolo-auto.com"
  },
  {
    aliases: ["zyloai"],
    baseUrl: "https://api.zyloai.net/v1",
    id: "zyloai",
    name: "ZyloAI",
    protocols: ["openai_chat_completions"],
    websiteUrl: "https://zyloai.net"
  }
];

export const communityProviderPresets: ProviderPreset[] = communityProviderEntries.map((entry) => ({
  aliases: entry.aliases,
  endpoints: [{ baseUrl: entry.baseUrl, protocols: entry.protocols }],
  id: entry.id,
  name: entry.name,
  ...(entry.websiteUrl ? { websiteUrl: entry.websiteUrl } : {})
}));

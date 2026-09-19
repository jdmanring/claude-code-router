# Pool scope and how many models a provider should carry

The question is how many models each provider should list, and which. The
answer follows from what the provider meters, which is recorded per block as
`pool:` in the provider list.

Three shapes, and the rule each implies:

- **The allowance is a count of requests, or a pure rate with no finite
  budget.** Token cost is not charged, so the only thing a second model buys is
  a weaker answer for the same request. Carry **one** model, the most capable
  one that answers.
- **The allowance is a budget of money or tokens.** Every token spent is
  allowance gone, so carry **one** model, the one that finishes the work in the
  fewest tokens. Note that this is not the smallest model: a weak model that
  needs three attempts spends more of the budget than a capable one that needs
  one.
- **The allowance is metered per model.** Each configured model is its own
  bucket, so carrying more is strictly more capacity. Carry **every** model at
  or above the working floor.

A pure rate limit collapses into the first shape rather than forming a fourth.
Nothing is being spent, so there is no efficiency to trade for.

## Requests or a pure rate: one model, the most capable

| Provider | What is metered | Models now | Keep |
| --- | --- | --- | --- |
| Literouter | 50 requests a day | 10 | untested, see below |
| Kilo | 200 a day, 5 a minute | 9 | `nex-agi/nex-n2.5-pro:free` |
| Routeway | 200 a day | 3 | `minimax-m2.7:free` |
| Yolo-Auto | 15 a day | 2 | `qwen3.8-27b` |
| Groq | 14,400 a day, 30 a minute | 2 | `openai/gpt-oss-120b` |
| SEA-LION | 10 a minute | 5 | `aisingapore/Llama-SEA-LION-v3-70B-IT` |
| EvolveX | 5 a minute | 3 | `moonshotai/kimi-k3` |
| GonkaBroker | 6 a minute | 2 | `MiniMaxAI/MiniMax-M2.7` |
| Mistral Studio | 30 a minute, 50K tokens a minute | 3 | `mistral-medium-latest` |
| Mistral Vibe | shares the Studio plan | 3 | `mistral-medium-latest` |
| Cohere | 1,000 calls a month | 1 | already one |

Five of these keep the model that already leads, so the change is deleting the
rest. Three move the lead: Routeway, SEA-LION and GonkaBroker currently lead
with a flash-class model while carrying a larger one, which under a request
budget is capacity given away.

**Literouter is the one that cannot be decided from the catalogue.** Only
`mistral-medium-2508:free` has ever answered; `gpt-oss-120b:free` and
`qwen3.8-27b:free` are both larger and both untested. Its own limit is one
message every seven seconds, so settling it costs two requests spaced by that,
and guessing instead risks trading a model known to answer for one that does
not.

## A budget of money or tokens: one model, fewest tokens for the work

| Provider | What is metered | Models now | Keep |
| --- | --- | --- | --- |
| Huggingface | monthly inference credit | 5 | `inclusionAI/Ling-3.0-flash-Fin:novita` |
| ZyloAI | 200,000 tokens a day | 3 | `gpt-oss-20b` |
| XKIRO | 500,000 tokens a day | 2 | unsettled, see below |
| VSLLM | one key quota | 2 | `glm-4.7-flash-free` |
| Bazaarlink | one credit pool | 4 | `deepseek/deepseek-v4-flash-0731free:free` |
| Orcarouter | one workspace allowance | 4 | `deepseek/deepseek-v4-flash-free` |

All six already lead with the model to keep, so every change here is a deletion.

## Metered per model: carry every model above the floor

| Provider | Bucket | Models now | Published and free and not carried |
| --- | --- | --- | --- |
| Naga | per-model rate | 13 | none: the three remaining are text-to-speech and transcription |
| Fastrouter | 10 requests a day per model | 6 | `google/gemma-4-26b-a4b-it` |
| MegaNova | tiered per model | 7 | `meganova-ai/manta-pro-1.0`, `BruhzWater/Sapphira-L3.3-70b-0.1`, `zai-org/GLM-4.7-Flash` |
| Google Gemini | per-model | 12 | catalogue answers 404, not established |
| Auriko | per-model | 5 | not established: it publishes 197 models and no pricing at all |
| Requesty | per upstream | 9 | not established: cost follows the prefix, not a price field |
| Claude Code API | account plus per-model meters | 4 | not applicable |

The headline number here is misleading and worth recording. Fastrouter
publishes 200 models of which 67 are free, which reads as a large unused
allowance; 61 of the 67 generate images, video or audio, and of the remaining
six only `google/gemma-4-26b-a4b-it` is a text model that is not already
carried. Naga is the same story: 16 ids contain `free`, 13 are carried, and the
three left are speech.

Auriko and Requesty are open rather than exhausted. A filter keyed on a price
field reports zero for both, and in neither case does that zero mean the
catalogue is used up: Auriko publishes no pricing field, and Requesty prices
every model non-zero while charging differently per upstream prefix. Settling
either needs the provider's own documentation.

## Providers to leave alone

Vercel, Zen, Tokenrouter, Codex API, AIHubMix, Electronhub, Tokenreply and v0
have no model that answers, measured this day over two passes. On a provider
that is down the configured list is the search space `--all-models` walks, so
cutting it to one model now would hide whichever model answers when the
provider recovers.

## Pool never established

Go carries 8 models, OpenCode Go Responses 4, Pooled 3, and Alibaba, LLM.kiwi
and Poolside 2 each: 21 models on an allowance nobody here has read. Go is the
paid lane and is the one worth reading the documentation for first.

## Incidental findings

- SEA-LION carries `BAAI/bge-m3`, which is an embedding model and cannot answer
  a chat request at all. It occupies a chain slot and can only fail.
- XKIRO's configured models are `minimax/minimax-m3:free` and
  `qwen/qwen3.8-max:free`, while its block records "MiniMax M3 (Free)" and
  "DeepSeek V4.1 Flash (Free)". One of the two is stale and the pick depends on
  which.
- Orcarouter's four models are still marked `[gate]` although the gates section
  records the GitHub link as having opened them. The markers predate the fix.
- ZyloAI's block lists `kimi-k3` and `step-3.7`, neither configured.
- VSLLM's block still shows the withdrawn `glm-5.2-free`.

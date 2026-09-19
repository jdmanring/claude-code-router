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

**Literouter is settled, and the catalogue was the reason it could not be
decided from the configuration.** It publishes 443 models, and the free tier
includes `mistral-large-3:free`, `glm-5:free` and `deepseek-v3.2:free`, none of
which was configured. Four candidates were called directly, spaced by the
seven seconds the provider enforces, and all four answered 200:

| Model | Status | Output tokens | Latency |
| --- | --- | --- | --- |
| `mistral-large-3:free` | 200 | 2 | 3.2s |
| `glm-5:free` | 200 | 39 | 3.5s |
| `deepseek-v3.2:free` | 200 | 2 | 1.5s |
| `gpt-oss-120b:free` | 200 | 54 | 19.4s |

The configured lead was `mistral-medium-2508:free`, which under a 50-requests-a-day
budget is a smaller model from the same family as one that answers. The pick is
`mistral-large-3:free`. Between it, `glm-5:free` and `deepseek-v3.2:free` the
choice is a preference rather than a measurement: all three are flagship tier
and all three answer, and nothing available here ranks them.

**Groq keeps the qwen id rather than the larger model, deliberately.** Its two
models are `qwen/qwen3.8-27b` and `openai/gpt-oss-120b`, and the 120B is the
more capable. The gateway strips a leading segment matching the protocol
vendor, so `openai/gpt-oss-120b` addressed on `openai_chat_completions` reaches
Groq as `gpt-oss-120b`. `qwen/` does not collide. Deliverability decides it.

## A budget of money or tokens: one model, fewest tokens for the work

| Provider | What is metered | Models now | Keep |
| --- | --- | --- | --- |
| Huggingface | monthly inference credit | 5 | `inclusionAI/Ling-3.0-flash-Fin:novita` |
| ZyloAI | 200,000 tokens a day | 3 | `gpt-oss-20b` |
| XKIRO | 500,000 tokens a day | 2 | `minimax/minimax-m3:free` |
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
- XKIRO's block was the stale side, not the configuration. Both configured ids
  are published, and the catalogue carries **no DeepSeek model on the free
  tier at all**: every `deepseek/` id there is paid, so "DeepSeek V4.1 Flash
  (Free)" describes nothing. Asked the same question, `minimax/minimax-m3:free`
  spent 35 output tokens and `qwen/qwen3.8-max:free` spent 39. One sample four
  tokens apart does not separate them, so the existing lead stands on the
  grounds that it is already the lead, not on the measurement.
- Orcarouter's four models are still marked `[gate]` although the gates section
  records the GitHub link as having opened them. The markers predate the fix.
- ZyloAI's block lists `kimi-k3` and `step-3.7`, neither configured.
- VSLLM's block still shows the withdrawn `glm-5.2-free`.

## Applied

The configuration now carries 160 models across 54 providers, down from 202.
Sixteen providers hold a single model, and the ones still holding several are
the three groups that should: metered per model, no model answering and left
as the search space, or an allowance never established.

Cutting the lists alone would have orphaned seventeen chain entries, because a
chain names a model rather than a provider and several of these providers
appear in a chain five times. The edit therefore repointed each entry at the
kept model and dropped the duplicates that created, which also shortened the
sonnet chain from 28 to 25 and the haiku chain from 41 to 36. Verified by
running the config audit's dangling check over the result before writing: zero
entries naming a provider or model that is not configured, confirmed again
against stored config afterwards.

Two lessons from the edit to the hand-written list, both caught by a dry run
rather than by review. A heuristic reading "an indented line whose first token
looks like an identifier" as a model line also matched prose and endpoint
names, and would have deleted `get-api-key-identity` and `rate-limit` from
Auriko's block along with models the list deliberately records as available
but not configured. And matching a dropped model id across the whole document
deletes another provider's line, because the same id appears under several
providers. Scope such an edit to the provider's own block, and drive it from
the difference between two configuration snapshots rather than from what a
line looks like.

## The picks were made from the wrong pool

The consolidation chose, for fourteen of the sixteen providers, the best model
**already configured** rather than the best model the provider **publishes**.
Literouter showed why that is wrong: its free tier carries 42 models and the
configured lead was a mid-tier member of a family whose flagship is also free.
Reading every consolidated provider's catalogue afterwards, at no inference
cost, found three more:

- **EvolveX** was configured with `moonshotai/kimi-k3`, which appears in
  neither its free list nor anywhere a free marker is published. Its free tier
  is `free-nemotron`, `free-glm-air` and `free-step-flash`.
- **Kilo** publishes 22 free models, among them
  `nvidia/nemotron-3-ultra-550b-a55b:free`, `z-ai/glm-5.2:free` and
  `cohere/north-mini-code:free`, against a configured `nex-agi/nex-n2.5-pro:free`.
- **Huggingface** was configured with `inclusionAI/Ling-3.0-flash-Fin:novita`,
  a finance-tuned variant, for general coding work, while the same account
  reaches `zai-org/GLM-5.3-Flash` and `deepseek-ai/DeepSeek-V4.1-Flash`.

Three picks were confirmed rather than changed. Routeway publishes only three
free models and the configured one is the strongest. Yolo-Auto publishes two.
GonkaBroker publishes no free model at all: every id carries a price, from
$0.20 per million for `zai-org/GLM-5.3-Flash` to $0.25 for the configured
`MiniMaxAI/MiniMax-M2.7`, so its "$0 Free" is a rate allowance rather than a
free catalogue and the capable pick stands.

**Where a provider grants a credit balance and also publishes free models, the
free model wins.** The balance is the scarce side: on most of these accounts it
does not refresh, while the free tier resets. This is not a preference to
weigh against capability, because the most capable id in a catalogue is
normally the paid one, which is exactly how EvolveX ended up configured with a
model off its free list.

Parameter count is not capability, and "this model is larger" is a claim from
priors rather than a reading. Where two candidates are both free and both
answer, the tie is broken by a probe with one correct answer, and one probe is
one reading.

## Auriko and Requesty were classified wrong, and their own pricing pages say so

Both were left carrying several models on the grounds that their allowance
looked per model. Reading what each publishes:

**Auriko** charges pay-as-you-go with zero markup, and its free plan is "$0 plus
pay-as-you-go API costs". There are no free models: the free tier removes the
platform fee, not the inference cost, which is why its catalogue of 197 models
publishes no pricing field and a filter keyed on one reported nothing. The
per-model limit seen earlier ("Rate limit exceeded for model 'glm-4.7-flash'")
is a rate, and the allowance being spent is one account balance. That makes it
a money pool carrying five models where it should carry one.

**Requesty**'s free plan is "the full platform, on free models, access to all
free models, 200 requests per day". The allowance is a count of requests held
by the account, not a bucket per upstream. The per-upstream behaviour recorded
earlier is real but is about which copy of a model is free, not about separate
allowances: `google/gemma-4-31b-it` answers while `deepinfra/google/gemma-4-31B-it`
returns a balance error. So it belongs with the request budgets, carrying one
model rather than nine.

Neither was settled by probing, and neither could have been: the catalogues
carry no free marker and no usable price. The pricing page answered both in one
fetch each.

## Literouter, settled across four task shapes

The single-question probe picked `mistral-large-3:free`, a second one picked
`glm-5.2:free`, and a battery of four task shapes says both were wrong.

| Model | instruction | reasoning | code | summarise | |
| --- | --- | --- | --- | --- | --- |
| `deepseek-v3.2:free` | pass | fail | pass | pass | 3 of 4 |
| `glm-5.2:free` | fail | pass | fail | fail | 1 of 4 |
| `mistral-large-3:free` | pass | fail | fail | not reached | 1 of 4 |

`glm-5.2:free` returned one or two words on three of the four tasks against a
300-token ceiling, which reads as reasoning tokens consuming the budget before
any answer is produced. A single probe missed that because the one question it
was asked happened to complete.

## Mistral keeps its general model

`codestral-latest` won a Python-semantics question and lost every task that
required following an instruction, answering a request for a single number
with "Alright, let's tackle this problem step by step" and exceeding a
twenty-word limit. `mistral-medium-latest` took instruction-following and the
length limit. Both stay on `mistral-medium-latest`, and the probe that said
otherwise was a code question chosen to separate code models.

## Applied: the final picks, and two faults in how this was recorded

The configuration carries 148 models across 54 providers. Huggingface holds
`zai-org/GLM-5.3-Flash:zai-org`, Literouter `deepseek-v3.2:free`, Requesty
`nvidia/nemotron-3-super-120b-a12b`, Auriko `glm-4.7-flash`, and both Mistral
providers keep `mistral-medium-latest`. Verified against stored config: zero
chain entries naming a provider or model that is not configured.

**The snapshots taken before each edit were not snapshots.** The configuration
database runs in WAL mode with a write-ahead log several megabytes long, and
`cp config.sqlite` copies only the main file, so each "backup" held whatever
had last been checkpointed rather than the state at the moment of the copy.
Both read 216 models while the live database read 148. Use `VACUUM INTO`,
which serialises the log into the copy, and verify the copy by reading a count
out of it rather than by its existence.

**Editing the list to mirror the configuration destroys what the list is
for.** The bulk edit that followed the first consolidation removed 44 lines,
nine of which carried a measured status, and the next one would have removed
thirteen more from Requesty alone, including the three `[gate] billed pool`
readings that record which upstream prefix is charged and three `[gone]`
readings for withdrawn ids. Those cost requests to learn; the configuration
they were being reconciled against costs nothing to re-read. The document
already had a marker for the distinction and had never defined it, so the
asterisk now means "configured in CCR right now" and is written into the
legend, and an unstarred line stays because of what it records.

One finding is left open rather than scripted over. Forty-three configured
model ids have no matching line in their provider's block, because the
document and the configuration spell ids differently: the block writes
`Groq/qwen-qwen3.8-27b` where the configuration holds `qwen/qwen3.8-27b`.
Inserting lines for them would duplicate models already present under another
spelling, so the mismatch needs a person, not a pass.

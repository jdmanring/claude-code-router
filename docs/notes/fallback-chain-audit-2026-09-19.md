# What the fallback chains contained on 2026-09-19

**Every count below is a reading taken before the repairs and the
consolidation were applied, and none of them survived those edits.** At 04:53
the chains held 76 entries, not 84: classifier 5, opus 10, sonnet 25, haiku 36.
The classifier already leads with `Groq/qwen/qwen3.8-27b`, so its first live
entry is position 1 and the repair this note recommends is done. Kilo and
Huggingface hold two chain entries each rather than five. The two entries named
below as unable to answer are both gone. What is durable here is the method and
the mechanisms; for the numbers, read the config.

Read from `profile.profiles[0].routing.rules`, which is where the chains live;
`Router.rules` is empty and carries nothing. Four rules, 84 chain entries.

## The rules all fire

The documented failure here is a rule whose `condition.right` names a provider
label rather than the string a slot exports, which leaves the rule and its
whole chain unreachable while requests still succeed down the default path.
Tested by taking each rule's `condition.right` as a prefix of every slot value:

| Rule | Matches on | Slots it fires for |
| --- | --- | --- |
| Auto-mode classifier | `request.body.system` | not a slot test |
| Opus routing | `request.body.model` | `model`, `opusModel` |
| Sonnet routing | `request.body.model` | `sonnetModel` |
| Haiku routing | `request.body.model` | `haikuModel`, `smallFastModel` |

No dead rules **among the three that match on the model**. The classifier
matches `contains-deep` against `request.body.system` for the literal "You are
a security monitor for autonomous AI coding agents", which this test does not
reach and nothing else here tests, so it is three rules of evidence behind a
four-rule heading.

## The fable slot has no rule, deliberately

`fableModel` is `Claude Code API/claude-fable-5-1`, no rule's condition
prefixes it, and `Router.rules` is empty, so a fable request has exactly one
place to go. That is the intended design and not a defect: nothing else
configured here can match that model, so any chain behind it could only
downgrade the answer. A 429 from that provider is better handled by reading
`getProviderAccountSnapshots`, since the empty 429 usually means the request
lacked its identity block rather than that the plan is spent.

## Dead weight, by position

Counting a provider as dead when no configured model of it answered on the
sweep of 2026-09-19 (Vercel, Zen, Tokenrouter, Codex API, AIHubMix,
Electronhub, Tokenreply, v0, OVH) plus Meta, which has been removed:

| Rule | Entries | Live | First live | Dead in the first five |
| --- | --- | --- | --- | --- |
| Auto-mode classifier | 5 | 4 | **position 2** | 1 |
| Opus routing | 10 | 8 | 1 | 1 |
| Sonnet routing | 28 | 23 | 1 | 0 |
| Haiku routing | 41 | 29 | 1 | 0 |

**The classifier rule is the one that costs on every request.** Its rewrite
target and its first chain entry are both `OVH/gpt-oss-120b`, and OVH answered
403 on the sweep. OVH takes no API key and its limit is shared across every
anonymous caller, so it is the least predictable provider configured and it
sits at the head of the one chain that runs on every auto-mode turn. Moving
`Groq/qwen/qwen3.8-27b` to the front costs nothing and removes a guaranteed
wasted attempt.

The other three rules lead with a live provider, and their dead entries sit in
the tail where a chain is supposed to put its least reliable members. The tail
of the haiku chain is nonetheless inert: of its last nine entries, eight are
Zen, Vercel, v0 or Tokenreply.

## Two entries that cannot ever answer

- `Meta/muse-spark-1.3-contributor` in the sonnet chain names a provider that
  is no longer in the configuration. Removing a provider does not remove the
  chain entries pointing at it.
- `VSLLM/glm-5.2-free` in the haiku chain names the model that was withdrawn
  and is the reason VSLLM once read as dead. VSLLM now carries
  `glm-4.7-flash-free` and `glm-4.6v-flash-free`, both answering, and the chain
  points at neither.

## Providers carrying the chains

| Entries | Provider |
| --- | --- |
| 8 | OVH |
| 8 | Google Gemini |
| 5 | Kilo, Huggingface |
| 4 | Zen |

OVH is the most-used provider across all chains and is anonymous shared
access: a single sweep exhausts its rate limit on its own. That is also why
the dead-weight table above should not be read as settled. It counts all eight
OVH entries as dead, on the strength of a sweep whose own traffic exhausts the
limit being measured, and OVH is the largest single contributor to those
totals. Every "live" count in that table is downstream of a classification the
instrument cannot make. Zen's entries
carry free models that refuse every client that is not OpenCode, by the
provider's own design. One of the four, `Zen/big-pickle`, is not a `-free` id,
so "none of them can answer" generalizes the free-tier refusal past what was
measured. Note also that Zen holds the **same API key as Go and OpenCode Go
Responses**: it is the same OpenCode account reached a third way, which this
note elsewhere treats as an unrelated provider.

## Configured and never routed to

`Go` and `OpenCode Go Responses` are one account reached two ways. Both carry
the base url `https://opencode.ai/zen/go/v1`; they are split by protocol,
`openai_chat_completions` and `openai_responses`, because the models divide
along that line. The Sonnet rule rewrites to
`OpenCode Go Responses/muse-spark-1.3-contributor` and lists it as chain entry
one, so the subscription is exercised on every sonnet turn.

What is unrouted is the eight chat-completions models on the `Go` provider,
not the account. Reading the provider name alone gives the opposite and wrong
impression, which is what happened when this note was first written.

Pooled, Poolside, Tokeness and Mistral Vibe appear in no chain and in no slot.
AIHubMix is also unrouted, which matters less because nothing of it answers.

Ollama appears in no chain but is the `model` and `opusModel` slot value, so it
is reached as a target rather than as a fallback.

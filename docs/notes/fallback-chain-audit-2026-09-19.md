# What the fallback chains actually contain

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

No dead rules.

## The fable slot has no rule and no fallback

`fableModel` is `Claude Code API/claude-fable-5-1`, and no rule's condition
prefixes it. With `Router.rules` empty there is no default chain behind it
either, so a fable request has exactly one place to go. That provider answers
429 when its request arrives without the Claude Code identity block, which
reads as an exhausted plan and is not one, and there is nothing behind it to
absorb the failure.

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
access: a single sweep exhausts its rate limit on its own. Zen's four entries
refuse every client that is not OpenCode, by the provider's own design, so
none of them can answer a request from Claude Code.

## Configured and never routed to

Go, Pooled, Poolside, Tokeness and Mistral Vibe appear in no chain and in no
slot. Go is the paid OpenCode lane, so it is being paid for and never reached.
AIHubMix is also unrouted, which matters less because nothing of it answers.

Ollama appears in no chain but is the `model` and `opusModel` slot value, so it
is reached as a target rather than as a fallback.

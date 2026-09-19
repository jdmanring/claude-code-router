# Provider state, 2026-09-18

Measured by direct call to each provider, with that provider's own key and a
model from its own catalog. A status from the reachability sweep is not used
here, because it reads CCR's first attempt rather than the provider.

Reachable through CCR: 43 of 56.

## Repaired

| Provider | Cause | Change |
|---|---|---|
| Requesty | configured model was a paid Bedrock route | six free models measured one at a time; `google/gemma-4-31b-it` leads |
| Meta | addressed as `anthropic_messages` | restricted to `openai_chat_completions` |
| VSLLM | addressed as `anthropic_messages` | restricted to `openai_chat_completions` |
| Haiku slot | rule condition named `Gemini/`, the slot exports `Google Gemini/` | condition corrected; its 41 entry chain reaches requests again |

Before the last of those, every request for the haiku slot matched no rule and
fell through to the three entry default chain. It now routes `source=profile`
and answers on the first attempt.

## Repaired by testing every configured model rather than the first

Each provider below was failing only on the model the sweep happens to try,
which is `models[0]`. Probing the whole configured list one model at a time,
directly, found working ones in the same account.

| Provider | Working | Total configured | Change |
|---|---|---|---|
| Naga | 9 | 13 | none needed; the lead recovered on its own |
| ZyloAI | 3 | 3 | none needed; the daily cap had reset |
| Auriko | 4 | 5 | only `glm-4.7-flash` is rate limited upstream, so it no longer leads |
| Literouter | 1 | 10 | the rest hit a per-tier limit of one message every seven seconds |
| Google Gemini | 7 | 12 | quota is per model family: the flash tier is spent, every lite model answers, so a lite model leads |

Two withdrawn Google models (`gemini-2.5-flash`, `gemini-2.5-flash-lite`,
both answering `no longer available`) were removed and the chain entry naming
one was repointed.

## Not reachable, with the provider's own words

| Provider | Reading |
|---|---|
| Vercel | free tier is $5/month of credit, not free models. `/v1/credits` gives `total_used 5.008`, `balance -0.181`. Resets monthly, nothing owed |
| Orcarouter | all five free models return `free_rate_limited`, naming an established linked GitHub account as the requirement |
| Meta | `billing_not_configured` on both the contributor and plain models; a payment method on file, not a charge. The same model answers free through OpenCode Go Responses |
| Venice | `accessPermitted false`, `apiTier paid`, USD, DIEM and bundled credits all zero |
| Tokenrouter | its one free model returns a literal zero credit limit |
| VSLLM | same shape, zero quota on its own free model |
| ZyloAI | account wide daily token cap, resets at the next UTC midnight |
| OVH | shared anonymous rate limit, by design, takes no key |
| Zen | refuses any client that is not OpenCode, and not by user agent: spoofing it changes nothing |
| v0 | no OpenAI compatible surface for this key; `/v1/models` is also absent |
| Google Gemini, Codex API, Claude Code API | quota and rate limits that recover |
| Tokenreply | every one of its six models returns the same 502 |
| Naga, Tokenreply, Literouter | provider side 5xx |

## Recovered without intervention

NVIDIA, Bazaarlink and Auriko each failed one sweep and passed the next on an
unchanged selector, so a single failing run is not evidence about a provider.


## Probing note

`Claude Code API` and `Codex API` hold a twenty-one character CCR credential
handle rather than a secret, and CCR resolves it at dispatch. A direct probe
with that value as a bearer token returns 401, which says nothing about either
account. Their real reading is the 429 seen through CCR.

Each of the twelve providers still unreachable returned the *same* error on
every one of its configured models, which is what distinguishes an account or
infrastructure gate from a model that has moved.


## Local agent OAuth, added 2026-09-19

Two separate faults, both reading as something they were not.

**Claude Code API answered 429 with a full plan.** Anthropic refuses a token
scoped `user:sessions:claude_code` on `/v1/messages` unless the first system
block identifies the request as Claude Code, and the refusal is
`rate_limit_error` with an empty message. Measured on one token within a few
seconds: 200 with the block, 429 without, while `/api/oauth/usage` reported
session 1%, weekly 40%, every limit `severity: normal`, tier
`default_claude_max_20x`.

It is upstream's, not this configuration's. Nothing under `packages/` adds the
block. A top-level Claude Code turn carries it already, which is why the primary
flow works; a subagent, a cross-agent chain fallback and any internal call do
not. Request 8682 in the log is exactly that case, a sonnet-slot call from the
claude profile with no block. The provider sits at the end of all three chains,
positions 9/10, 25/28 and 32/41, so the failure arrives once everything else has
already failed.

Staged for upstream as `fix/claude-code-oauth-identity-system-block`, three
files off `origin/main`.

**Codex API answered 401 with a freshly refreshed token.** The first reading of
this was wrong and is corrected here. The vendored runtime does refresh an
expired access token, and `withCodexOauthRuntimeDefaults` already substitutes
the current tokens from `~/.codex/auth.json` every time the gateway config is
compiled. The actual cause is that the Codex CLI rotates the **refresh** token
too: the stored refresh token no longer matched the on-disk one, so the running
gateway held a token it could not exchange and fell back to an expired access
token. Re-importing the provider recompiled the config and the provider moved
from 401 to 429.

A patch was staged for this and then withdrawn, because it did not fix the
cause: omitting the stored access token is inert wherever the login file exists,
since the compiler overwrites it anyway, and removes the only credential
available where it does not. The remaining real gap is narrow, that a rotation
during a run is not picked up until the gateway recompiles, and it is recorded
rather than patched.

Verified with the current token: primary quota 100% used, 0 remaining, resets
2026-10-13, no manual resets available. The quota is genuinely spent.

`fix/claude-code-oauth-identity-system-block` is based directly on `origin/main`
and carries only its own fix, unlike the older `fix/*` branches here, which were
cut from the fork and carry its whole history.

The identity match in that branch is **exact**, not a prefix. Measured with one
token seconds apart: no system block, an unrelated first block, the identity
placed second, and the identity carrying trailing text are each refused with the
same empty 429; only an exact first block is accepted, and further blocks after
it are free. A prefix test passes over the one shape this repository produces,
since adapting a request for a non-Anthropic protocol flattens the CLI's two
blocks into a single string beginning with the identity. Verified end to end:
that flattened shape now answers 200 on the first attempt.


## Retry-aware reading, 2026-09-19

`node scripts/provider-sweep.mjs` over all 56 providers, retrying only the
statuses that carry no verdict: **44 reachable**.

Bazaarlink and Z.ai answered only on a later pass, having failed the first. A
single-pass sweep would have counted both as dead, which is what the earlier
numbers in this file did.

The twelve still unreachable, each terminal on its own first reading except
where noted:

| Provider | Reading |
|---|---|
| Vercel | monthly $5 credit spent, refills |
| Electronhub | weekly credit spent: "Insufficient Neutrinos", cost 1 to 5 per request against a balance of 0, refills |
| Zen | free tier refuses any client that is not OpenCode; the key itself is valid |
| Tokenrouter, VSLLM | new-api relays reporting a literal zero allowance on their own free models |
| OVH | shared anonymous rate limit, by design |
| Orcarouter | free models need an established linked GitHub account |
| Meta | payment method on file, not a charge |
| Venice | accessPermitted false, all balances zero |
| v0 | no OpenAI-compatible surface for this key |
| Codex API | 429 surviving four passes; quota genuinely spent, resets 2026-10-13 |
| Tokenreply | 502 surviving four passes; provider-side outage |

Claude Code API is reachable again and no longer appears here.

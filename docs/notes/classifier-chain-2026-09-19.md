# The Bash classifier is a routed request like any other

Auto mode runs a safety check before shell commands and network requests. In
this configuration that check is a model call that leaves the client, matches a
routing rule, and walks a fallback chain. It blocks the action it is judging, so
its latency is felt on every Bash call and its failure halts work.

## It is not the free server-side check, and cannot be

Anthropic's own page on this is explicit that the check is free "when the server
performs them", carried on the session's own model requests. A session routed to
Gemini, MegaNova or Fastrouter never reaches Anthropic, so nothing performs it
and Claude Code falls back to its own classifier request.

The remedy the page names, asking the gateway to pass `safeguards` and
`safeguard_results` through unchanged, addresses a different failure. A gateway
that forwards perfectly still does not make a third-party provider into
Anthropic. Seventeen configured providers speak `anthropic_messages`; exactly one
points at `api.anthropic.com`.

So the two are exclusive: a free classifier means metered inference, and free
inference means a classifier that spends chain capacity. The page also notes
"Pro, Max, and Team plans never show the notice", so seeing the notice says the
free checks are available on a direct connection rather than that anything is
broken.

## How the rule finds it

The condition matches `request.body.system` containing "You are a security
monitor for autonomous AI coding agents", which is the classifier's own prompt
and is present in the client binary. Matching the prompt rather than a model name
is what makes the rule survive a slot change: the classifier sends whichever
model the `sonnet` slot names, so a rule keyed on the model would have to be
re-edited every time that slot moved.

## What the request actually looks like

Measured over 137 calls, 2026-09-19 14:05 to 15:48 UTC:

| | |
| --- | --- |
| calls | 137 |
| answered | 108 |
| body size | 176KB min, 203KB mean, 240KB max |
| chain position reached | 4.6 mean |
| duration | 3,191ms mean |

The body is the transcript the action is being judged against, so it is large and
the output is around 100 tokens. That combination is the measurement that
matters: latency is prefill-dominated, and a model's speed on a short prompt
predicts nothing about it.

**A high chain position is not waste here.** Position counts entries the loop
walked, including ones skipped because the target was cooling down, and a skip
costs a loop iteration rather than a request. One trace reached position 5 having
sent exactly one request:

```
1. skip groq::.../qwen3.8-27b       cooling for another 1632711ms
2. skip ovh::.../gpt-oss-120b       cooling for another 1634371ms
3. skip fastrouter::.../gemma4-26b  cooling for another 294004ms
4. skip meganova::.../manta-flash   cooling for another 294669ms
5. 200 Google Gemini / gemini-3.5-flash-lite
```

That is the escalating target cooldown working. The defect it exposes is depth,
not order: five entries of which two are pinned at the thirty-minute cap leaves
three live, and a 429 is account-scoped, so one refusal sidelines a whole
provider. When the live entries cool together there is nothing left and the
client reports the classifier as rate-limited.

## Choosing the entries

The log already holds the measurement, so no quota was spent making it. Every
request with a body at or above 170KB that answered 200, with the latency for the
short-output subset that matches the classifier's shape:

| model | answered | latency | largest body |
| --- | --- | --- | --- |
| `fastrouter` gemma4 | 2/2 | 3,599ms | 205KB |
| `google-gemini` gemini-3.5-flash-lite | 112/175 | 3,931ms | 289KB |
| `meganova` manta-flash-1.0 | 50/50 | 5,347ms | 208KB |
| `xkiro` minimax-m3:free | 322/322 | 34,166ms | 1,177KB |
| `nvidia` kimi-k3 | 41/41 | 115,551ms | 1,044KB |
| `alibaba` glm-5.3 | 8/8 | 169,121ms | 1,055KB |

Reliability and latency point in opposite directions, and neither alone picks the
head. A head that answers 64 per cent at 3.9s costs more in expectation than one
that answers every time at 5.3s, because each miss pays its own latency and then
the next entry's as well. MegaNova leads on that arithmetic, not on being
fastest.

The slow entries are not useless. A 34-second answer at the back of the chain is
better than a refusal, so `minimax-m3` earns the last position as a floor that
has never refused a request of this size, and is wrong anywhere earlier.

The resulting chain, every entry measured answering 200 at this body size:

1. `MegaNova/meganova-ai/manta-flash-1.0`
2. `Google Gemini/gemini-3.5-flash-lite`
3. `Fastrouter/google/gemma4-26b:free`
4. `Groq/qwen/qwen3.8-27b`
5. `XKIRO/minimax/minimax-m3:free`

OVH was removed: it answered nothing in 590 requests over the window.

## The catalog could not answer this

`models.json` carries none of these ids, so the context window each model
publishes was unavailable. The log was the better instrument anyway, because a
published context window is a claim about capacity while a stored 200 at 240KB is
a measurement of the request that is actually sent.

## A rewrite is a directive, not a string

`rule.rewrite` is `{ key, operation, value }` and the router reads `.value`.
Assigning a bare string leaves `.value` undefined, the rewrite stops firing, and
the rule keeps succeeding down its chain, so nothing reports it. The baseline diff
was the only thing that caught it during this edit.

`danglingChainEntries` now reports a rewrite carrying no `.value`, and a rewrite
whose value is not the head of its own chain. The second is the convention this
configuration follows, and a mismatch sends the first attempt to a target the
chain does not list, which reads as an extra entry nobody configured.

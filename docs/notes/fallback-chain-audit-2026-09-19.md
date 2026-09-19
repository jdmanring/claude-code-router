# Reading the fallback chains

The chains live in `profile.profiles[0].routing.rules`, each rule carrying its
own `fallback.models`. `Router.rules` is empty and carries nothing, so a
request sent straight to 3456 by hand routes `source=default` and exercises
none of them.

Counts below are deliberately absent. `node scripts/config-audit.mjs --show`
prints the chains, and the same instrument reports on every run any entry
naming a provider or model that is not configured.

## Testing whether a rule can fire

A rule condition compares against `request.body.model` exactly as the agent
sent it. A condition naming a provider's display name rather than the string a
slot exports never fires, which leaves its rewrite and its whole chain
unreachable while requests still succeed down the short default path. The
symptom is silence.

Test it by taking each rule's `condition.right` as a prefix of every slot value
(`model`, `opusModel`, `sonnetModel`, `haikuModel`, `fableModel`,
`smallFastModel`) and treating a rule that prefixes none as dead. The test
covers only rules matching on the model: the classifier matches
`contains-deep` against `request.body.system`, and nothing here tests that.

## The fable slot has no rule, deliberately

`fableModel` is the Claude plan model, no rule's condition prefixes it, and
there is no default chain behind it. That is intended rather than a defect:
nothing else configured can match that model, so any chain behind it could only
downgrade the answer. Read a 429 from that provider with
`getProviderAccountSnapshots` before calling it a quota, since an empty 429
usually means the request lacked its identity block.

## What a dead-weight count is worth

Counting chain entries as live or dead requires classifying each provider, and
for some that classification is not available. OVH is anonymous shared access
whose rate limit a single sweep exhausts on its own, and it holds more chain
entries than any other provider, so any total that counts its entries as dead
rests on a reading the instrument cannot make.

Zen's entries carry free models that refuse every client that is not OpenCode,
by the provider's own design, but not every Zen entry is a `-free` id, so
"none can answer" generalizes past what was measured.

## One account can appear as three providers

`Go`, `OpenCode Go Responses` and `Zen` carry the same API key and the same
base url. They are one OpenCode account reached three ways, split because the
models divide by protocol: `openai_responses` carries the contributor models,
`openai_chat_completions` the rest. Reading the provider name alone gives the
opposite impression, and did: a note here once recorded the paid lane as
unrouted when the sonnet rule rewrites to it and lists it first.

## Two counting traps

Removing a provider does not remove the chain entries pointing at it, and the
baseline that drift is measured against is re-taken after a deliberate removal,
so the entries survive with nothing reporting them. The same holds for a model
withdrawn from a provider's list. This is why `config-audit.mjs` reports
dangling entries on every invocation rather than only when something moved.

Cutting a provider's model list orphans every chain entry naming a model that
was dropped. A consolidation has to repoint those entries and drop the
duplicates that creates, or it trades one class of dead entry for another.

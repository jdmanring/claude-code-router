# How many models a provider should carry

How many models a provider lists, and which, follows from what that provider
meters. The `pool:` line in the provider list records it.

## Three shapes

**The allowance is a count of requests, or a rate with no finite budget.**
Nothing is spent per token, so a second model buys only a weaker answer to the
same request. Carry one model, the most capable that answers. A pure rate limit
belongs here rather than forming a fourth shape: there is no consumption to
trade efficiency against.

**The allowance is a budget of money or tokens.** Every token is allowance
gone. Carry one model, the one that finishes the work in the fewest tokens,
which is not the smallest model: a weak model that needs three attempts spends
more than a capable one that needs one.

**The allowance is metered per model.** Each configured model is its own
bucket, so more models is more capacity. Carry every model at or above the
working floor.

Read what is configured with `node scripts/config-audit.mjs --show`, and which
providers meter per model from the `pool:` line in the list. A table of current
picks would be wrong the first time anyone changes one.

## Choosing the model

**Where a provider grants credit and also publishes free models, take the free
one.** The balance is the scarce side: on most accounts here it does not
refresh while the free tier resets. This is not a preference to weigh against
capability, because the most capable id in a catalog is normally the paid one.
EvolveX was configured with `moonshotai/kimi-k3`, which is on neither of its
free lists.

**Choose from the catalog, not from the configured list.** Fourteen of the
sixteen providers consolidated here were given the best model already
configured, which is a different question. Literouter publishes 443 models and
42 free ones; its configured lead was a mid-tier member of a family whose
flagship is also free.

**Parameter count predicts nothing.** `nvidia/nemotron-3-ultra-550b-a55b` tied
with a far smaller sibling on one provider and lost to
`nemotron-3-super-120b-a12b` on another.

**One question decides nothing either, because a probe shaped like a model's
specialty selects that model.** `codestral-latest` won a Python-semantics
question and lost every task that required following an instruction, answering
a request for a single number with "Alright, let's tackle this problem step by
step". Use `scripts/model-probe.mjs`, which asks four shapes, and treat a
one-task margin as no result.

**Deliverability outranks capability where the gateway rewrites the id.** Groq
publishes `openai/gpt-oss-120b`, which is the more capable of its two models
and which the gateway strips to `gpt-oss-120b` on `openai_chat_completions`.
Its `qwen/` id does not collide. Fastrouter carries two `openai/`-prefixed free
models on the same protocol and is exposed to the same rule; neither has been
measured through CCR, so that is a lead rather than a verdict.

## Providers to leave alone

A provider with no model that answers keeps its full list. On a provider that
is down the configured list is the search space `--all-models` walks, so
cutting it to one hides whichever model answers when the provider recovers.

## What the catalogs do and do not settle

A catalog answers what is published and, where it declares modality, whether a
model can answer a chat request at all. `scripts/model-catalog-audit.mjs`
reports both and spends no inference quota.

It does not answer what is free. Auriko publishes 197 models and no pricing
field at all; Requesty prices every model non-zero while charging differently
per upstream prefix. A filter keyed on price reports zero free models for both,
and that zero is the filter. Their pricing pages answered it in one fetch each:
Auriko is pay-as-you-go with no free models, so its per-model rate limit sits
over one account balance; Requesty's free plan is 200 requests a day across the
account, not a bucket per upstream.

Nor is a headline count what it looks like. Fastrouter publishes 200 models of
which 67 are free, and 61 of those generate images, video or audio.

## Keeping the list in step

The provider list is not a mirror of the configuration and editing it into one
destroys what it is for. Its model lines carry measured status, which cost
requests to learn; the configuration costs nothing to re-read. Mark the
configured model with the asterisk the legend now defines and leave the rest.

Two mechanical traps, both caught by a dry run rather than by review. A
heuristic reading "an indented line whose first token looks like an identifier"
as a model line also matches prose and endpoint names. And matching a dropped
model id across the whole document deletes another provider's line, because the
same id appears under several providers: scope any such edit to the provider's
own block.

Forty-three configured model ids have no matching line in their block, because
the document and the configuration spell ids differently. That needs a person
deciding which spelling is canonical.

## Snapshotting the configuration before an edit

The configuration database runs in WAL mode, so `cp config.sqlite` copies only
the main file and yields whatever was last checkpointed. Two backups taken that
way read 216 models while the live database read 148. Use `VACUUM INTO`, and
verify the copy by reading a count out of it rather than by its existence.

## Open

- Whether `moonshotai/kimi-k3` spends money on EvolveX. Its three free models
  answered HTTP 522 on three attempts across forty minutes, so the free pick
  cannot be made and the paid question is unresolved.
- Whether Kilo's `z-ai/glm-5.2:free` beats its configured model. It answered
  429 on both attempts.
- Whether the two `openai/`-prefixed Fastrouter models survive the id rewrite.

The measurements behind all of this, and the errors made reaching them, are in
`provider-audit-2026-09-19.md`.

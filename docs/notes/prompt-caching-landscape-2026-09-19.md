# How other projects cache, and what this fork should take

Researched 2026-09-19 against the providers' own specifications and the two
gateways solving the same problem, OpenRouter and LiteLLM. The question behind
it: 93 per cent of a Bash-classifier request is a prefix identical to the last
one, and only some providers charge less for reading it again.

## One mechanism, two interfaces

Every provider here caches a **prefix**, and reuse requires the rendered prefix
to match exactly. Nothing caches a response, and nothing matches approximately.
What differs is whether the client has to say where the prefix ends.

**Implicit, no marker in the request.** OpenAI, DeepSeek, Grok, Moonshot, Groq,
Z.AI and Gemini 2.5 or newer. Gemini's guidance is the whole technique in one
line: put large common content at the beginning, and send requests with a
similar prefix close together in time. Minimums bind: 4,096 tokens on Gemini
3.5 through 3.8 Flash, 2,048 on Gemini 2.5.

**Explicit, a marker is required.** Anthropic, Alibaba Qwen, and Gemini's
`cachedContent` objects. Without the marker nothing is cached and no error is
raised, which is exactly the failure this fork is in.

That split explains the measured table directly. The providers reading cached
tokens here are Gemini, XKIRO, NVIDIA, Ollama and Alibaba, all on the implicit
side. MegaNova, Fastrouter and Cohere read zero because nothing in the request
asks them to and they do not match prefixes on their own.

Groq is the apparent exception and is not one. OpenRouter prices Groq cache
writes at zero and reads at half, so Groq caches, but Groq answers 413 to every
request at this size, so it never sees a prefix to cache.

## What Anthropic's specification adds

The hierarchy is `tools`, then `system`, then `messages`, and a change at one
level invalidates everything below it. Tool definitions are the dangerous one:
modifying any name, description or parameter invalidates the entire cache.

Two facts matter most for a gateway.

**Automatic caching needs no breakpoint bookkeeping.** A single `cache_control`
at the top level of the request makes the breakpoint move to the last cacheable
block by itself, so nothing has to be repositioned as a conversation grows.
That removes the hardest part of doing this from inside a gateway, which is
knowing where the stable part of someone else's prompt ends.

**Silence is the failure mode.** A prompt below the minimum cacheable length is
processed without caching and without an error, so a marker that is present and
ineffective looks exactly like one that worked. Any change here has to be
verified by reading `cache_read_tokens`, never by the request being accepted.

Ceilings worth knowing: four explicit breakpoints, of which automatic caching
consumes one; a twenty block lookback; a 5 minute TTL by default and 1 hour at
twice the write price.

## What the two peer gateways do

Both solve it the same way, and both do something this fork does not.

**They translate the marker between protocol families.** OpenRouter's
documentation states that the block level markers are interchangeable: a text
block carrying Anthropic style `cache_control` is given a
`prompt_cache_breakpoint` when it is routed to a supporting OpenAI model.
LiteLLM does the same, translating `cache_control` into Bedrock's `cachePoint`
and into Google's context caching API.

**They normalize cache reporting.** LiteLLM reports every provider in OpenAI's
shape, `prompt_tokens_details.cached_tokens`. OpenRouter goes further and
returns a `cache_discount` field saying what the response saved.

The pattern is the same one this repository already applies to model ids and
protocols: the client speaks one dialect, the gateway speaks each provider's.
Caching is a dialect that was left untranslated.

## What to take, in order

**1. Translate the cache marker across protocol families.** This is the single
highest-value item and it is what both peers built. The classifier chain sends
one prefix to providers in three protocol families; a marker that survives
conversion is worth more than any reordering. It belongs where the model id
rewrite already lives.

**2. Mark the prefix on Anthropic-protocol targets using automatic caching.**
`Claude Code API` is the one provider here metered against a plan rather than a
free tier, and it reads zero cached tokens today. A single top-level
`cache_control` is the smallest possible change, needs no breakpoint
bookkeeping, and is measurable immediately.

**3. Report the saving, not only the hit rate.** `ccr-log.mjs --usage` now
reports the share of a prompt served from cache. OpenRouter's `cache_discount`
is the next column, and the pricing data to compute it is already in
`models.json`.

**4. Keep treating prefix stability as a routing property.** Ordering a chain
by measured cache behavior is this fork's own version of Gemini's advice, and
it is already done. The corollary is that anything injected ahead of the prefix
must be byte-stable, which
`local-plugins/gateway-claude-code-oauth-identity.mjs` is.

## What not to take

**Semantic or response caching.** Portkey and LiteLLM both offer caching keyed
on similarity between prompts, returning a stored response for a near match.
For ordinary chat that trades accuracy for cost. For the auto-mode classifier
it is a security hole: two shell commands can differ in one path and differ
completely in blast radius, and a near match returning a cached allow verdict
defeats the control. Prefix caching reuses computation and returns a fresh
answer; semantic caching returns an old answer. Only the first is safe here.

**Per-provider cache plumbing written by hand.** The reason both peers
converged on translation at one boundary is that the alternative is a growing
matrix of provider-specific special cases. This fork has 53 providers.

## What is measured and what is not

Measured here: which providers read cached tokens and at what share, that no
request carries a `cache_control` key, and that the injected identity block is
constant. Recorded in `classifier-payload-audit-2026-09-19.md`.

Not measured, and required before building item 1 or 2: whether the client
sends a marker that this gateway drops, which `request_logs.ingress_field_paths`
now records and `ccr-log.mjs --trace` reports. Marking a prefix a provider was
already matching implicitly buys nothing, so the gain has to be read from
`cache_read_tokens` before and after rather than assumed.

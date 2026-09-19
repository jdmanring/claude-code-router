# Why a classifier call ships 182KB

Every shell command in an auto-mode session is preceded by a blocking model
call carrying 182KB. This is what is in it and what can be done about it.

## Composition

| block | size | who owns it |
| --- | --- | --- |
| permissions corpus | 93,216 | Anthropic, 84KB of it |
| the classifier's own task rules | 41,066 | Anthropic |
| CLAUDE.md block | 39,348 | James |
| the action under review | ~12,700 | the session |

Inside the permissions corpus:

```
   5KB    27 bullets  Environment
   8KB    10 bullets  Definitions
   6KB     6 bullets  HARD BLOCK
  57KB    72 bullets  SOFT BLOCK
  12KB    28 bullets  ALLOW (exceptions)
```

**The hand-written part is 7KB of the 93KB**, across 25 entries. The other
84KB arrives through the literal token `$defaults` in each `autoMode` list.
So the size is not something the configuration caused and not something
editing the configuration can undo.

## What the 57KB is for

Reading the rules, a large minority describe systems this workstation does not
have. Measured sizes for the ones that presuppose absent infrastructure:

| rule | chars | presupposes |
| --- | --- | --- |
| Containment Escape | 4,615 | container/pod boundary, cloud instance metadata, sibling tenants |
| Command Network Lists | 2,148 | the sandbox's `allowed_domains` surface |
| Interfere With Workloads | 1,496 | Kubernetes, Slurm, Nomad, Ray, Temporal |
| Package Registry Bypass | 1,303 | an internal registry, which Environment records as none configured |
| Shared Cluster Mutation | 942 | a shared compute cluster |
| Live-Shared Artifact Sensitive Delta | 905 | a live-shared artifact audience |
| Sandbox Network Callback | 810 | sandboxed execution |

That is 12,219 chars from the seven largest alone. Adding the smaller
cloud-shaped rules (Cloud Storage Mass Delete, Production Deploy, Production
Reads, Sensitive Remote Exec, Blind Apply, Protected-Scope IaC Apply,
Permission Grant, DNS / Domain / Cert Changes, Secret-Store Writes, CI Bypass,
Modify Shared Resources) brings the total to roughly 20KB to 22KB, about 38 per
cent of the SOFT BLOCK section. The Chrome-MCP definition in Definitions adds
about 1.5KB for a tool surface that is not installed.

The remainder is load-bearing here and would have to be kept: irreversible
local destruction, unverifiable deletion target and scope, shared scratch
sweeps, git destructive operations, code from external sources, code that leaks
when run, the four credential rules, sensitive-source provenance, traffic
redirection, remote repoint, out-of-place publication, public surface creation,
exposing local services, ingress tunnels, unauthorized persistence and the
security-weakening family. Several of those are the reason the control exists.

## Verdict: not worth doing

Removing every environment-irrelevant rule takes the corpus from 93KB to about
70KB and the request from 182KB to about 159KB, a 13 per cent cut. That is not
enough to change anything that matters:

- It does not widen the candidate model pool. The requirement moves from about
  60K tokens to about 52K, and the models disqualified at 60K are disqualified
  at 52K.
- The lead chain entry already prompt-caches about 29,570 tokens of the prefix,
  so the marginal cost where most traffic lands is already reduced. Ordering
  the chain by cache behavior bought more than this would.
- It trades real coverage for the 13 per cent. Every rule removed is a class of
  action that stops being recognized, and the judgment about which cannot fire
  on this machine has to be right every time.
- It needs re-deriving whenever the upstream defaults change, with no signal
  when they do.

The honest conclusion is that the payload is large because the control is
general, and a single-user workstation pays for rules written for shared
infrastructure. The lever is not trimming the corpus.

## The decision that is actually available

Auto mode is what runs this at all. On this machine it costs a blocking model
call on every shell command, at 182KB and two stages per decision, and its
threat model is only partly the threat model here: prompt injection through
fetched content and irreversible local destruction are real, while cross-tenant
reach and cloud control-plane escape are not reachable. Whether that trade is
worth paying is a judgment about risk appetite rather than a measurement, and
it belongs to the person whose machine it is.

## False positives are a running cost, not a nuisance

Recorded 2026-09-19 in one session, five blocks on read-only or
self-directed work: two `Security Weaken` on setting an environment variable
documented as changing no behavior, and three `Self-Modification`, one of them
on writing a memory file and two on analysing this corpus from a session that
does not route through the gateway at all. The classifier's premise in the last
three was that the session was editing its own permissions, which it was not.

This is the same failure the `allow[7]` repair addressed from the other side: a
rule that is true of one context being applied in every context. It is worth
counting rather than working around, because the rate is what decides whether
the control is affordable.

## Caching: what is happening, and what is not

Measured 2026-09-19 by sweeping all 12,692 stored request bodies for a
`"cache_control"` JSON key: **none carries one.** That includes the seven sent
to `claude-code-api::anthropic_messages`, where explicit `cache_control` is the
only caching mechanism and the tokens are metered against the plan.

So every cache hit recorded here is **implicit prefix matching**, done by the
provider with no marker in the request: XKIRO 37.0M cached tokens, Google
Gemini 5.6M, NVIDIA 4.0M, Ollama 1.25M. The vendored runtime's only
`cache_control` handling copies the field on web-search tool definitions, and
nothing in core sets it; core reads cache token counts for accounting and
nothing more.

Why no marker is sent is unresolved. The client carries a global cache strategy
and an error classifier for `cache_control_field`, `unknown field` and
`cannot be set`, which is the shape of a client that disables the feature when
a provider rejects it, but no response in the window mentions `cache_control`
and no 4xx names an unknown field, so that mechanism is not evidenced here. The
decisive measurement is what the client sends inbound to 3456, which the
request log cannot show because it stores the upstream body.

### What already holds

Implicit caching needs a byte-stable prefix, so anything injected ahead of it
matters. `gateway-claude-code-oauth-identity.mjs` prepends a constant with no
timestamp, counter or session id, and declines when the block already leads, so
it is idempotent and cache-safe. That was worth checking rather than assuming:
a varying injected block would have cost every cache hit on every request.

Chain ordering was checked against the cache column across all four rules. The
heads are `Google Gemini` at 66 per cent, `Codex API` at 92 per cent and
`OpenCode Go Responses` at 89 per cent, so the chains already lead with
caching providers and no reordering is called for.

### The lever that is still unpulled

Where a target speaks `anthropic_messages`, a provider hook could mark the
invariant prefix with `cache_control` rather than relying on the provider to
match it implicitly. The hook layer is the only one that sees a built upstream
body, and `gateway-claude-code-oauth-identity.mjs` already proves a hook can
reshape the `system` array on that path and have the provider accept it.

Two things have to be established before building it, and neither is expensive.
Whether the client already sends the marker and something drops it, which a
local sink on a provider's base URL answers in one request. And whether the
gain is real, which the `cache_read_tokens` column reports directly once a
marker is present. Marking a prefix that the provider was already matching
implicitly buys nothing, so the measurement decides whether the feature exists
at all.

### What cannot be fixed here

The 84KB of `$defaults` is the bulk of the invariant prefix and belongs to the
client. Caching reduces what re-reading it costs; nothing available here
reduces what is sent.

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

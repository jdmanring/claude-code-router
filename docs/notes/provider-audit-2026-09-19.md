# Provider configuration audit, 2026-09-19

One pass over every configured provider, against its own published
documentation rather than against this repository's assumptions. Append-only:
each provider keeps the reading it was given on the date it was read.

For each: where the documentation is, whether it publishes a usage or account
endpoint CCR can consume, whether the access this repository configured is the
one the provider recommends, and anything the provider expects that is not
being sent.

Status vocabulary:

- `wired` a usage connector now reports for it
- `no endpoint` the documentation names none, or none carries consumption
- `needs account action` documented, but gated behind something only James can obtain
- `access changed` the configured base url, protocol or model ids were corrected
- `as documented` configuration already matches what the provider asks for

## Inventory at the start of the pass

56 providers enabled, 18 reporting usage. Reachability from
`node scripts/provider-sweep.mjs --passes 2`: 43 of 56.

## Findings

### Zen (OpenCode Zen free lane) - blocked by vendor policy, not by configuration

Documentation: `https://opencode.ai/docs/zen/`. It lists the model endpoints as
`/zen/v1/responses` and `/zen/v1/messages` and publishes the catalogue at
`/zen/v1/models`. It documents no usage, credits or billing endpoint.

The 403 is a deliberate client-identity gate, not a protocol or credential
fault. Since 2026-09-15 the free lane requires the request to come from the
OpenCode client: `User-Agent: opencode/` at version 1.17.0 or later, plus
`x-opencode-session` matching `ses_` followed by 12 hex and 14 base62
characters, and `x-opencode-client` and `x-opencode-request`. The refusal
reads "OpenCode's free tier can only be used from within OpenCode". Reported
across several third-party projects (anomalyco/opencode#49621, #49144,
#49756; 6Kmfi6HP/opencode2api#19; can1357/oh-my-pi#12306) and against the
vendor's own plugin (headroomlabs-ai/headroom#3656).

**Disposition: do not defeat it.** Sending those headers from CCR would be
impersonating the vendor's client to reach a tier they have said is not for
other clients, and the project maintainers have an open question thread about
exactly that. The free models stay configured but cannot answer, so the entries
are dead weight in any fallback chain and should not be counted as capacity.
The paid Go lane (`/zen/go/v1`) is a different endpoint and is unaffected: both
`Go` and `OpenCode Go Responses` answer.

Status: `no endpoint`, access gated by vendor policy.

### v0 - the 404 is a documented plan gate

Documentation: `https://chat.v0.dev/docs/api/model`. The Model API is beta and
**requires a Premium or Team plan with usage-based billing enabled**; the base
url and model ids configured here (`https://api.v0.dev/v1`, `v0-1.5-md`) are
the documented ones, so nothing in this repository is wrong. Vercel's own
community forum carries this exact symptom: `404 not_found_error` on
`/v1/chat/completions` while `/v1/user` answers on the same key, which is what
the plan gate looks like from outside.

Status: `needs account action` (a v0 Premium or Team plan). Configuration is
`as documented`.


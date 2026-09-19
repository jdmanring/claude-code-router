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

### Electronhub - the 402 is a spent Neutrino balance, and the meter does not show it

Documentation: `https://docs.electronhub.ai/billing/model-access` and
`/billing/credits`. Three model classes: `:free` models "use **Neutrinos**
instead of credits" and need no subscription; freemium models deduct credits;
premium models need a subscription. Credits refill weekly, Sundays at 21:00
UTC, by subscription tier. The documented 402 body is "Insufficient balance.
Please wait for the next weekly refill or purchase more tokens".

The configured lead model is `deepseek-v4-flash:free`, so it spends Neutrinos,
and the account has credits (0.25 on the meter here) while still answering 402.
The existing connector reports credits and token counters but no Neutrino
figure, which is why the meter reads healthy while the provider refuses. The
documentation names no endpoint for the Neutrino balance; that is the gap to
close if one is ever published.

Status: `as documented`, recovery is automatic on the weekly refill.

### OVH - configuration matches the published endpoint

Documentation: `https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/`
confirms `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` as the
OpenAI-compatible base url, which is what is configured. No usage or quota
endpoint is published. Anonymous access and its shared limit are covered in
project memory and are not revisited here.

Status: `as documented`, `no endpoint`.

## Account meters as read on 2026-09-19

Eighteen providers reporting. Recorded because several of these numbers explain
a sweep result that otherwise reads as a fault:

| Provider | Reading |
| --- | --- |
| Claude Code API | 5h 93%, 7d 58% remaining |
| Codex API | primary quota 0%, resets 2026-10-13 |
| OpenRouter | a balance in USD |
| Tokenreply | a balance meter in USD |
| XKIRO | a daily token allowance free tokens |
| ZyloAI | a daily token allowance daily tokens, a daily request allowance |
| Go, OpenCode Go Responses | 5h 100%, weekly 100%, monthly 80% |
| Yolo-Auto | 10 of 15 daily requests |
| Electronhub | credits 0.25, Neutrino balance not exposed |
| Orcarouter | paid balance 0, **free credit 6** |
| Vercel | a negative balance |
| Venice, AIHubMix, Tokenrouter, Bazaarlink | zero balance |
| VSLLM | allowance spent, 0 of 1000 |

Orcarouter is worth a second look: the account holds 6 units of free credit
while every free model still refuses with the GitHub-account message, so the
gate is on the model tier rather than on the balance.

### The class this audit turned up: usage that arrives in response headers

Groq publishes no usage endpoint. It reports remaining capacity on **every
response**, in `x-ratelimit-limit-requests`, `x-ratelimit-limit-tokens`,
`x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens` and the two
matching `-reset` headers. That is the OpenAI convention, so it is not one
provider's habit but the default for a large part of this list.

CCR cannot consume it. `ProviderAccountHttpJsonConnectorConfig` maps JSONPath
expressions over a response **body**; there is no header source, and nothing in
`packages/core/src` reads an `x-ratelimit` header at all.

Worse, the headers are not even recorded. `request_logs.response_headers` is
populated for all 2,855 rows and holds `{}` for 2,488 of them. Split by
provider, every row whose provider is the `slug::protocol` form - that is,
every request the vendored gateway child actually sent upstream - is empty:
codex-api 661/661, google-gemini 574/574, openrouter 315/315, ollama 214/214,
nvidia 64/64. The rows that do carry headers are the older in-process path
(`Gemini` 353 populated). `sanitizeHeaders` is not the cause: it redacts
sensitive names and passes everything else through, so the headers are absent
before they reach the store.

Two consequences worth separating. The observability defect stands on its own:
a column recorded on every request, always empty, describing the response the
client received. And it is the precondition for header-based usage, which is
the only usage signal a documented majority of these providers offer.

DEFER(when the response-header capture is fixed): a `headers` mapping source
for `http-json` connectors, which would bring Groq and every other
OpenAI-convention provider into usage tracking without a new endpoint.

Status for Groq: `no endpoint`; usage exists but is unreachable by this
codebase today.

### Cohere - no balance endpoint

Documentation: `https://docs.cohere.com/docs/cohere-faqs` and
`/reference/about`. Usage is reported as per-response metadata and in the
dashboard; no account or credit endpoint is published. Trial keys carry 1,000
calls a month with per-endpoint rate limits (chat 20/min); production keys
1,000/min and unmetered monthly. The configured compatibility base url
`https://api.cohere.ai/compatibility/v1` is the documented OpenAI-compatible
one.

Status: `as documented`, `no endpoint`.

### Requesty - a management API exists, its usage endpoint is not in the overview

Documentation: `https://docs.requesty.ai/api-reference/management-apis`. All
management endpoints sit on `https://api-v2.requesty.ai/v1/manage`, separate
from the router base url configured here. The overview lists key management and
group budgets, and says the organization endpoint returns "organization details
including settings and usage information", but names neither the exact path nor
the credential. An OpenAPI specification is published and is where that
resolves.

Requesty is also the provider whose billing pool is chosen by the model prefix,
which is already recorded in the repository guide.

Status: candidate, unresolved. Next step is the OpenAPI spec, not a probe.

### Cloudflare Workers AI - free allowance is real, usage lives behind a different credential

Documentation: `https://developers.cloudflare.com/workers-ai/platform/pricing/`.
10,000 Neurons a day free, a hard limit on the free plan rather than a spend;
paid usage is $0.011 per 1,000 Neurons. Usage is reported in the dashboard and
through Cloudflare's analytics API, which takes an account-scoped API token
with analytics permission, not the Workers AI token configured here. The
configured base url carries the account id and is the documented REST form.

Status: `as documented`; `needs account action` for usage (an analytics-scoped
Cloudflare token).

### Hugging Face - no credits endpoint is documented

Documentation: `https://huggingface.co/docs/inference-providers/` and the Hub
API reference. `api/whoami-v2` validates a token and reports the account, but
Hugging Face documents no endpoint for remaining inference credit, and does not
document the error returned when the monthly credit is spent. The credit is the
only limit; no per-minute rate limit is published for Inference Providers.

Status: `no endpoint`.

## Chasing the header class to its boundary

Writing "no endpoint" a fourth time for a provider that does publish usage was
the signal to stop cataloguing and go after the blocker. Four measurements, in
order:

1. **The child replaces the headers.** One request through CCR to Groq returns
   27 response headers to the client and not one of them is Groq's. The
   vendored gateway child answers with its own set: `x-gateway-billing-*`,
   `x-gateway-target-provider`, `x-ccr-provider-protocol`. Groq's
   `x-ratelimit-*` do not survive the hop, so the empty `response_headers`
   column is not CCR failing to record what it had.

2. **CCR's own executor does hold a `Response` with headers.**
   `upstream/executor.ts` already reads them, for
   `recordProviderCredentialOutcome` and `cooldownAfterStatus`. But that
   response is the child's, per point 1, so those headers are the child's too.

3. **The route trace carries no headers either.** An
   `upstream.attempt.outcome` hop holds `statusCode`, `fallbackReason`,
   `retryDelayMs` and nothing else, so nothing downstream can recover them.

4. **The extension point is real and documented.** The vendored runtime ships
   `docs/plugins.md`, which lists `responseHooks` ("transform final
   non-streaming client responses") and `streamHooks` ("transform an upstream
   streaming Response before it is relayed"), with `transformResponse(input)`
   and an input carrying `upstreamResponse`. CCR's own `router-plugin.ts`
   registers both.

`local-plugins/gateway-upstream-usage-headers.mjs` is the evidence gate for
that last point: it registers a response hook and a stream hook, extracts any
`x-ratelimit`, quota, credit, balance or `retry-after` header from
`input.upstreamResponse`, and writes them to
`app-data/upstream-usage-headers.json`. It changes no response.

**Measured result: the module loads and both hooks register, and neither fired**
on three dispatch paths - `openai_chat_completions` (Groq),
`openai_responses` (OpenCode Go) and `anthropic_messages` (Claude Code API).
The registration line appears in `ccr-service.log`; no invocation line does.
That is a measured negative, not a conclusion about why.

Next step, bounded: read the hook dispatch in the vendored bundle
(`dist/main/next-ai-gateway.js`, 22 occurrences of `responseHooks`) to find the
condition under which a module hook is invoked. The plugin stays registered so
that the answer can be tested immediately. Until it fires, header-reported
usage - which is the only usage signal Groq and the rest of the OpenAI
convention offer - stays out of reach, and writing "no endpoint" against those
providers is accurate but incomplete.


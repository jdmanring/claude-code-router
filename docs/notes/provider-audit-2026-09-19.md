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

RESOLVED 2026-09-19, negatively. See "Header-published usage: settled" below.
No `headers` mapping source is worth building, because no extension point in
this runtime is handed the upstream response on the paths this traffic takes.

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

## Instruments added during this audit

`scripts/model-catalog-audit.mjs` (+ `.test.mjs`, 4 tests). One `GET /models`
per provider, diffing the configured ids against what the provider publishes.
No inference, no quota spent, so it is safe to run when a sweep is not. First
run over 56 providers: 45 clean, 5 carrying unlisted ids (9 in total), 6 whose
catalogue could not be read.

Unlisted ids found: Huggingface 5 (`inclusionAI/Ling-3.0-flash-Fin:novita`,
`inclusionAI/Ling-3.0-flash-VL:novita`, `zai-org/GLM-5.3-Flash:zai-org`,
`CohereLabs/command-a-reasoning-08-2025:cohere`,
`zai-org/GLM-5.3-Flash-BF16:zai-org`), AIHubMix `gemini-3.7-flash-free`, VSLLM
`glm-5.2-free`, Tokeness `glm-5.3-free`, Z.ai `glm-4.7-flash`.

**The tool overclaimed on its first run and was corrected.** Z.ai publishes
eleven ids and `glm-4.7-flash` is not among them, yet that exact model answered
200 in the sweep the same day. So a provider will serve an id it does not
publish, and "not listed" is a lead to check rather than a withdrawal. The
report now says "not listed" and the script carries the Z.ai case as the reason.
Cross-checking a new tool's output against a measurement already in hand is what
caught it.

`scripts/provider-sweep.test.mjs` (5 tests) pins `producedNoOutput`, the one
piece of judgement in the sweep, including the cases where it must **not** fire:
an unparseable body, an HTML error page, a truncated read and a non-numeric
token count are not declines. Reporting any of those as a decline would turn a
transport problem into a provider verdict.

Both scripts had the same defect and it was fixed in both: the module body ran
the whole job on import, so importing the sweep for one function swept 56
providers. The imperative run now sits behind an entrypoint check, which is
what made either testable.

### Zen, after the account change of 2026-09-19

James restricted the Zen key to free models. Measured immediately afterwards,
the answer is unchanged: `403 FreeTierError`, "OpenCode's free tier can only be
used from within OpenCode", both through CCR and called directly. The gate is
client identity, not key permissions, so a key setting cannot move it. Note the
side effect: with the key limited to free models, the paid lane that previously
returned a balance error is no longer reachable either, so this closes the only
door that funding could have opened on this endpoint. The Go lane is a separate
endpoint and is unaffected.

## Fork survey, 2026-09-19

`gh api repos/musistudio/claude-code-router/forks?sort=stargazers`. Of the
fifteen most-starred, exactly one carries substantial independent work:
`oakimov/claude-code-router`, 165 commits ahead and 588 behind, last pushed
2026-09-09. `steipete` is 1 ahead, `02Fabs` 0 ahead; the rest are stale
mirrors. Being 588 behind means oakimov sits on the pre-3.x architecture
(`transformers/`, `src/api/routes`), so their commits are ideas to read rather
than patches to cherry-pick.

Taken from it and applied: **fast-uri**. Their `fix(security)` commits bump it
twice. This fork's own `overrides` entry pinned `fast-uri@3.1.2` to `3.1.5`,
which is one patch below the fix for four advisories - host confusion via
percent-encoded scheme normalization (GHSA-jqff-g426-hqxp), host confusion via
skipped IDN canonicalization (GHSA-5jgf-p345-68v8), and request forgery through
malformed IPv6 normalization (GHSA-f65p-4m7j-42xc) and repeated hostname
percent-decoding (GHSA-fph4-wmhf-6fwf). Both consumers accept `^3.0.0`, so the
pin moved to 3.1.8 and `npm audit` reports fast-uri clean. Nine advisories
remain in the tree: @xmldom/xmldom, brace-expansion, electron, esbuild,
fastify, js-yaml, pm2, tar, undici.

Leads not yet read, all from the same fork: `fix: propagate Retry-After headers
from provider errors`, `fix(router): stop tiktoken crash and empty-default
route from killing requests`, `fix(ui): replace localStorage API key with
HttpOnly session cookies`, `fix: prune server logs daily and stabilize ccr.log
rotation`, `perf(core): reduce JSON serialize/deserialize on hot path`.

## The OpenCode extension question

CCR already ships the extension. `packages/core/src/agents/local-providers/`
holds `claude-code.ts`, `codex.ts`, `grok.ts`, `kimi.ts`, `zcode.ts` **and
`opencode.ts`** (688 lines), which knows both endpoints
(`https://opencode.ai/zen/v1`, `/zen/go/v1`), reads OpenCode's credential from
its config files, `OPENCODE_AUTH_CONTENT`, or `OPENCODE_API_KEY`, and imports
it as a provider with its model catalogue.

What it imports is an **API key**. That is the whole difference from the Codex
and Claude Code providers: those borrow a locally installed agent's OAuth token
and the vendor accepts it, because what is checked is the credential. Zen's
free lane checks the **client**, so no credential import can satisfy it.
Borrowing a better token would not help; there is no token that makes CCR
OpenCode.

`oakimov/claude-code-router` does close that gap, by sending OpenCode's
identity: `chore(opencode): bump USER_AGENT to 1.18.25`, `feat:
opencode-headers Zen retry`, `fix(opencode): parity session tricks for Zen
prompt caching`, `fix(opencode): align Zen reliability with upstream 1.18.23`.
Those commit titles are also the maintenance cost: the User-Agent has to track
OpenCode's releases, so it is a treadmill against a vendor actively tightening
the check.

Not adopted here. It impersonates another client to reach a tier the vendor
restricted to that client, which is a different act from borrowing a credential
the vendor accepts.

### OpenCode on this machine

Installed 2026-09-19: `~/.opencode/bin/opencode`, v2.0.9, a 198MB ELF binary
(no source tree). State lives in `~/.local/share/opencode/opencode.db`.

**It is not signed in.** The `account`, `account_state`, `control_account` and
`credential` tables all hold zero rows; `session_v2` holds one session and
`session_message` three. So there is currently no OpenCode credential for
`opencode.ts` to import, and the Zen provider configured here is using an API
key entered by hand rather than anything OpenCode supplied. Signing OpenCode in
would give `importLocalAgentProvider` something to read, and would not change
the free-tier answer.

### OpenCode signed in to Go, 2026-09-19: a defect the sign-in exposed

After signing in, `opencode.db` holds one row: `credential`, `integration_id`
`opencode-go`, label "OpenCode Go", `active = 1`, value a 90-character JSON
object of the shape `{"type":…,"key":…}`. The `account`, `account_state` and
`control_account` tables stay empty, so the Go sign-in is an integration
credential rather than an account session.

`getLocalAgentProviderCandidates` still offered only `codex-api` and
`claude-code`. The cause: `openCodeAuthFiles()` returns exactly one path,
`<dataRoot>/auth.json`, and OpenCode 2.x does not write it. Confirmed absent at
all four plausible locations. So a signed-in OpenCode is invisible to CCR, and
this is a defect in CCR rather than anything missing on the OpenCode side.

Fixed by reading the `credential` table when the file scan finds nothing, and
handing the stored value to the same `openCodeCredentialFromRecord` the file
path uses, since the shapes match. Read-only, best effort, no throw: it runs
while listing candidates. Four tests added to the existing OpenCode suite
(16 pass). Staged upstream as
`fix/opencode-credential-from-database`.

Note it will not change the running install until the package is rebuilt and
reinstalled, per the build-provenance section of the repository guide.

The three negative tests passed vacuously on first run, because a candidate's
id carries its protocol (`opencode-go-api-openai-chat-completions`) and the
assertions matched on the bare provider id. They now filter on the provider
prefix *and* on the source file, which is what makes the database the thing
being tested.

## Header-published usage: settled, negatively

The runtime ships its own TypeScript in `dist/index.js.map` under
`sourcesContent`, so the dispatch was read rather than inferred from the
minified bundle.

- `responseHooks` run only on the final **non-streaming** client response,
  behind `hasResponseHook && upstreamPayloadForResponseHooks !== undefined` in
  `src/gateway/handler.ts`. Registered here; never invoked.
- `streamHooks` likewise never fired.
- `providerHooks.transformResponse` **is** handed the real upstream `Response`
  by `applyProviderResponsePlugins`, and `shouldRunProviderPlugin` imposes no
  filter an unmatched hook would fail. But that function lives in
  `src/gateway/openai-json.ts` and is reached only on that adapter path.

The decisive reading, on one `Claude Code API` request with both local plugins
loaded: `[claude-code-oauth-identity] transformRequest reached this dispatch
path` appeared and the usage-header plugin logged nothing. Same request, same
host, same provider. The request side of a provider hook runs; the response
side is not reached.

So the verdict belongs to the runtime rather than to the providers. Writing "no
endpoint" against Groq and its peers is accurate and complete, and the only way
to change it is a change in the vendored runtime.
The probe that established all of this has since been **deleted** rather than
kept disabled. A file that runs nothing is not a record; this note is. To
re-test after a runtime upgrade, register a plugin returning
`providerHooks: [{ key, transformResponse(input) }]`, log
`input.upstreamResponse?.headers`, restart the gateway child and send one
request: a line below the registration line means the path has opened. That is
about twenty lines.

## Untracked tier: the balance endpoints are real, behind a second credential

Three findings from reading documentation rather than probing.

**Requesty.** `GET https://api-v2.requesty.ai/v1/manage/org` returns the
organization's name and current balance, bearer authenticated. The configured
inference key is refused with `403 "API key does not have manage permissions"`,
so this needs a manage-scoped key from their console.

**Naga.** `GET https://api.naga.ac/v1/account/balance` returns
`{"balance": "42.50"}`, a USD amount as a string, and
`/v1/account/activity?days=N` returns requests, token usage, costs, top models
and per-key activity. Both require a **provisioning key**; the inference key is
refused with `401 invalid_provisioning_key`.

**Routeway.** `GET /v1/account/keys` and `/v1/account/keys/{id}` carry
`balance`, `daily_limit`, `usage_today` and `usage_minute`. They require a
**management key** created from Dashboard -> Management Keys, and the full value
is shown only once at creation. The inference key is refused with
`401 "Invalid account key"`.

Each is a console action of about a minute that turns on real tracking. None
can be reached with what is configured now.

**Fastrouter**, by contrast, publishes no balance endpoint, and its free tier
has a rule worth recording: free models are 10 requests per organization per
day per model, reset at UTC midnight, and an organization with a paid credit
balance of $1 or less **cannot use free models at all**. Same shape as the
AIHubMix and Orcarouter gates: the deposit is verification, not payment for the
inference.

### The relay-console pattern is exhausted

Every untracked provider's host was asked for `/api/status`, unauthenticated,
one request each. **None of the 38 runs the new-api relay software**: 26
answered 404, four 403, two 405, one HTML, one 401. All four new-api providers
here (Tokenrouter, VSLLM, Tokenreply, AIHubMix) are already tracked. So there
is no second wave of relay endpoints to find by that route, and what remains is
per-provider documentation.

## Corrections from the account actions of 2026-09-19

**Orcarouter is open, and it cost nothing.** After linking an established
GitHub account, all four configured free models answer with real output tokens
(`orcarouter/free`, `deepseek/deepseek-v4-flash-free`, `tencent/hy3-free`,
`z-ai/glm-5.3-flash-free`). The deposit their error offered was always the
alternative to the link, never the requirement.

**v0 was reported wrongly and the account proves it.** `/v1/user/billing`
returns plan `v0-level0` with cycle credit largely unspent remaining this cycle, and
`/v1/rate-limits` returns a limit of 10 with a daily 7. So the free access is
real and the earlier "requires a Premium or Team plan" verdict, taken from a
search summary rather than the account, was wrong. The 404 is not a plan gate
either: `api.v0.dev` has no `/v1/chat/completions` on any model id, while
`/v1/chats` and `/v1/deployments` answer, so it is a chat-session API and
unroutable by CCR whatever the plan. Its credit is now tracked.

**Meta: an inference withdrawn.** Writing that its message "implies no charge"
was not something any source said. What is established is the message itself,
`billing_not_configured` asking for a payment method, and that it is account
level rather than per model. No pricing page for `api.meta.ai` was found, and
the model is named `-contributor`, which suggests a programme rather than a
free-forever tier. Left as not established, for James to read their billing
page before adding a card.

**Connector mapping arithmetic, precisely.** Between two JSONPaths it works:
`"$.data.balance.total - $.data.balance.remaining"` produced v0's used figure.
Against a literal it does not: `"$.data.total_granted / 500000"` produced no
meter. The earlier note said only the second half.

Tracked providers: 13 at the start of this session, 22 now.

## Endpoint discovery is exhausted for the untracked tier

Two wins this session (Naga, Routeway) came from `/v1/account/balance`, a shape
the earlier discovery sweep had not tried, so it was worth trying across
everything else. Both passes came back empty and both were controlled:

- **With the inference key**, 33 untracked providers were asked for
  `/account/balance`, `/account/usage`, `/account/credits` and `/account`.
  Zero returned a body carrying a consumption figure. The filter was run first
  against Routeway (`{"balance":0}`) and Naga (`{"balance":"0"}`) and reported
  consumption for both, so it can see a numeric zero and a quoted zero, which
  is the artifact that produced a false `0/43` earlier in this project.
- **Looking for the opposite signal**, the same providers were asked again over
  six paths, keeping only 401 and 403 answers whose body mentions a scope,
  permission, provisioning or management credential. That is the shape Requesty
  ("API key does not have manage permissions") and Routeway ("Account key
  missing required scopes") produced, and both strings match the filter. Zero
  untracked providers answered that way.

So no untracked provider here hides an account route group behind a
console-issued credential. What remains is per-provider documentation, which
cannot be enumerated and has to be read one at a time.

### Alibaba (Model Studio, international) - free tier is time limited

Documentation: `alibabacloud.com/help/en/model-studio/`. The configured base
url `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` is the documented
OpenAI-compatible one. A new account gets **1,000,000 tokens per eligible
model, valid for 90 days** from activating Model Studio on the Singapore
endpoint. Usage is visible in the Alibaba Cloud console only; no account or
quota endpoint is published for the compatible-mode API.

Worth flagging because it is the only expiring allowance found here: it will
stop working on a date rather than on a number, and nothing in CCR will say
why.

Status: `as documented`, `no endpoint`.

### SambaNova - the free tier is the one without a payment method

Documentation: `docs.sambanova.ai/docs/en/models/rate-limits`. The Free Tier
applies **when no payment method is linked**: 30 requests a minute and no total
token cap. Linking a payment method moves the account to the Developer Tier,
which raises concurrency but caps it at 20M tokens a day across all models.
Separately, $5 of credit is granted and expires after three months.

This one is the inverse of the deposit gates elsewhere in this audit: adding
payment does not unlock the free tier, it replaces it. No usage endpoint is
published.

Status: `as documented`, `no endpoint`.

### Ollama Cloud - works, but not on the documented host

Documentation: `docs.ollama.com/cloud`. It gives the base url as
`https://api.ollama.com/v1`, while the configured one here is
`https://ollama.com/v1`. The configured form answers 200 in the sweep, so it is
served, but the documented host is the one to prefer if it ever stops.

The free tier is metered by **GPU time rather than tokens**, with one
concurrent request, session limits resetting every five hours and weekly limits
resetting every seven days. The numbers themselves are not published, so there
is nothing to map a meter onto even if an endpoint existed. No account endpoint
is published.

Status: `as documented`; `no endpoint`; base url differs from the documented
host and is worth changing on the next failure.

### MegaNova - wired, from a platform API on a different path prefix

Documentation: `docs.meganova.ai`, which publishes an `llms.txt` index. Its
Platform API includes "Billing: Retrieve the user's current credit balance",
`GET {API_URL}/users/credits`, bearer authenticated, returning
`data.available_balance` as a string.

The base url had to be found: inference is on `https://api.meganova.ai/v1`
while the platform API is on `/api/v1`, so `/v1/users/credits` and
`/users/credits` both answer 404 and `/api/v1/users/credits` answers 200. The
ordinary inference key is accepted; no console credential is needed. Reports
`available_balance` `"0.0000"`. Wired.

Their free quota is also documented properly: granted **per account**, reset
daily at 00:00 UTC, and tiered per model, with `meganova-ai/manta-mini-1.0` at
50 on tier 1 and 500 on tier 2. Once exhausted, usage continues on the account's
billing configuration if the charge switch is on, which is worth knowing before
leaving it in a fallback chain.

### Kilo - three endpoints, and none of them is a balance

Their documentation is open source, so the reference was read directly:
`Kilo-Org/kilocode`, `packages/kilo-docs/pages/gateway/api-reference.md`. It
documents exactly `POST /chat/completions`, `POST /api/fim/completions` and
`GET /models`. There is no account, credit or usage endpoint. The configured
base url `https://api.kilo.ai/api/gateway` is the documented one.

Status: `as documented`, `no endpoint`.

### Poolside, SEA-LION, llm7, LLM.kiwi, Auriko - checked, nothing to wire

All five publish documentation and none publishes a consumption endpoint.

- **Poolside**: the documentation is a self-hosted deployment guide (EKS, Helm,
  model inference charts). There is no consumer account API.
- **SEA-LION**: index carries no account, billing or usage page.
- **llm7**: documents limits by plan and nothing to read them from.
- **LLM.kiwi**: documents free-tier access, per-minute rate limits and token
  quotas as prose on a limits page; no endpoint.
- **Auriko**: `GET /api-reference/get-api-key-identity` returns workspace,
  scopes, profile and rate-limit ceilings. This confirms the earlier reading:
  it is key metadata, not consumption, so wiring it would report "ok" while
  showing nothing.

Status for all five: `as documented`, `no endpoint`.

### NVIDIA - the credits model this list assumed no longer exists

Documentation and their developer forum: the API catalogue on
`build.nvidia.com` used to grant 1,000 credits on signup and up to 5,000 with a
business email. **That credits system was withdrawn.** It is now a trial
experience whose rate varies per model and with the number of concurrent users,
with no credit balance at all. So there is nothing to meter, and the limit is
not a number anyone can read.

Status: `no endpoint`, and the free-tier description to correct is the credit
count rather than the access.

### Google Gemini - another member of the header class

Documentation: `ai.google.dev/gemini-api/docs/rate-limits`. Two things matter
here. Usage is published in **response headers**,
`x-ratelimit-remaining-requests` and `x-ratelimit-reset-requests`, which is
precisely the class settled above as unreachable from this codebase. And the
limits are **per Google Cloud project, not per API key**, resetting at midnight
Pacific, so a second key in the same project shares the same allowance rather
than doubling it. Free tier: Flash 10 a minute and 250 a day, Flash-Lite 15 a
minute and 1,000 a day.

Status: `no endpoint` reachable; the figures exist but only in headers.

### Mistral and Mistral Vibe - an Enterprise credential, already recorded

Both are configured against `https://api.mistral.ai/v1`. Usage needs an
Enterprise Admin API key created in the Mistral backoffice, which is not
available on a normal plan; this is already recorded in project memory along
with the Codestral host and the separate Vibe pool. Nothing has changed.

Status: `needs account action`, unavailable on this plan.

### Helixmind - confirmed again, and still not worth wiring

`/key` answers with key metadata: id, name, prefix, and the plan's
`max_input_tokens` of 10,000, which is a per-request ceiling rather than an
allowance. `/usage` returns individual request records. Ten paths were probed
and `/key` is the only one that answers. A connector over either would report
"ok" while showing no consumption.

Status: `no endpoint` carrying consumption.

### The eight small relays - documented where documentation exists, probed where it does not

EvolveX, Literouter, Pooled, Mixlayer, GonkaBroker, Agnes (Free and Paid),
Pollinations and Intern AI were each asked for `/key`, `/me`, `/user`,
`/credits`, `/balance`, `/usage`, `/limits`, `/quota`, `/subscription` and
`/analytics` under their configured base url, with their own key. **None
answered on any path.** None publishes an `llms.txt` documentation index
either.

Two corrections from their public material:

- **Literouter**: the Basic plan is free with no time limit and no card, and
  free models are capped at 100 requests an hour, roughly 2,400 a day. Their
  documentation page advertises "usage analytics" but exposes no endpoint for
  it.
- **EvolveX**: their site advertises "a single, keyless endpoint". That is
  marketing: `POST /v1/chat/completions` without an Authorization header
  answers **401**. A key is required and one is configured here.

Status for all eight: `no endpoint`.

### GitHub Copilot - not a remote provider at all

Configured against `http://127.0.0.1:9090/v1`, which is the local
`copilot-proxy` this repository supervises, not a GitHub host. Any usage figure
would have to come from GitHub's own entitlement rather than from the proxy,
and the proxy publishes none. Project memory already records why this provider
goes down and where its fix belongs.

Status: `no endpoint`; out of scope for provider usage tracking.

## Dependency advisories cleared, and one thing the bump surfaced

`npm audit` went from nine findings to zero: a critical node-tar crash and
denial of service, ten xmldom injection and complexity findings, six
brace-expansion denial-of-service findings, a fastify schema validation bypass
and X-Forwarded spoofing, three undici findings, a js-yaml CPU finding, an
Electron session cache mix-up and an esbuild development-server file read.
Every transitive fix is pinned inside the line its consumers already use.

Two notes worth keeping.

**A fork-local pin was holding one open.** The override read
`pm2: { js-yaml: "4.3.1" }`, which is exactly the last vulnerable release. This
is the second time this session that one of our own pins, not an upstream
omission, was the thing keeping a package vulnerable; `fast-uri` was the first.
When an advisory names a package this repository overrides, read the override
before reading the dependency.

**The published package resolves its own tree.** `packages/cli/package.json`
carries no `overrides`, so a global install does not inherit the root ones.
Fixing the monorepo audit is therefore not the same as fixing what runs.
Measured on the installed tree after reinstalling: undici 6.28.1 and 7.29.1,
fastify 5.12.5, brace-expansion 5.0.12, fast-uri 3.1.8 and 4.2.1, all fixed,
and tar, js-yaml and xmldom are not present in it at all because they were
build and Electron side.

**fastify 5.12.5 deprecates an option the vendored runtime uses.** The gateway
child now logs `FSTDEP023: disableRequestLogging option is deprecated ... will
be removed in fastify@6`. The string appears in
`@the-next-ai/ai-gateway/dist/index.js` and in none of `packages/*/src`, so it
is the vendored runtime's call, not ours. It works today and is a warning, not
a fault, but a fastify 6 bump will break that runtime until the vendor moves to
`logController`.

## The nine unlisted model ids, resolved by calling each one

The catalogue audit reported nine ids configured but absent from their
provider's `/models`. Each was called directly rather than removed on the
catalogue's word, and **six of the nine answer**:

| Id | Result |
| --- | --- |
| Huggingface, all five (`inclusionAI/Ling-3.0-flash-Fin:novita`, `-VL:novita`, `zai-org/GLM-5.3-Flash:zai-org`, `-BF16:zai-org`, `CohereLabs/command-a-reasoning-08-2025:cohere`) | 200, real output tokens |
| Z.ai `glm-4.7-flash` | 200, established earlier |
| AIHubMix `gemini-3.7-flash-free` | 404 `model_not_found`, genuinely withdrawn |
| VSLLM `glm-5.2-free` | 503 "No available channel for model glm-5.2-free under group free" |
| Tokeness `glm-5.3-free` | 400 "Failed to get available channel" |

That is the calibration earning itself: treating the catalogue as a removal
list would have deleted six working models, five of them Hugging Face routing
aliases that the router simply does not enumerate.

Three repairs, each made only after the id was called:

- **AIHubMix**: dropped the withdrawn id, four models remain.
- **Tokeness**: dropped the dead id; its sibling `tokeness/free` answers.
- **VSLLM was not dead, its configuration was.** Its single configured model
  was the 503 above, so the provider was unusable. Both ids it publishes,
  `glm-4.7-flash-free` and `glm-4.6v-flash-free`, answer 200, so it now carries
  those and the sweep reads it **OK** for the first time.

One observation left deliberately unacted on: that VSLLM 503 is permanent, and
the sweep classifies every 503 as retryable, so it retried a condition that
could never clear. The retry split is status-based by design, borrowed from the
awesome-free-byok-models verifier. One counter-example is not enough to start
reading bodies for it; if a second provider produces a terminal 5xx, that is
the point to revisit.

## A shipped fix that may be inert for the same reason

`oakimov/claude-code-router` carries `fix: propagate Retry-After headers from
provider errors`. Reading our side against it turned up a question about work
already merged here.

`retry-policy.ts` reads `headers.get("retry-after")` in two places:
`retryDelayAfterStatus`, which sets the backoff before the next chain attempt,
and `cooldownAfterStatus`, which decides how long a target is held down. Both
are handed `response.headers` from `upstream/executor.ts`. But that response is
the **gateway child's**, and the child answers with its own header set: a
request through CCR returns `x-gateway-billing-*`, `x-gateway-target-provider`
and `x-ccr-*`, and nothing of the provider's. `retry-after` is never among
them, and the only place this repository sets that header is a test helper.

If the child does not forward a provider's `Retry-After` on an error, then both
functions always fall through to their defaults, and the cooldown work merged
here is using 60 seconds every time rather than the interval the provider
asked for.

**Not established**, and the honest reason is that it needs a provider that
reliably answers 429 *with* a `Retry-After` header while the chain is watched.
Codex API, the obvious candidate, answered 200 through a fallback on this
attempt. The measurement to make: point a provider's base url at a local sink
that returns `429` with `Retry-After: 120`, send one request, and read whether
`cooldownAfterStatus` receives 120000 or the 60000 default. That is the same
local-sink technique the repository guide already describes for deciding which
process opens the upstream connection.

Until then the cooldown is correct in its logic and possibly blind in its
input, which is worth knowing before anyone tunes it.

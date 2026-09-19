# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Claude Code Router (CCR): a local model gateway and control plane for coding agents (Claude Code, Codex, Grok CLI, Kimi CLI, Kilo Code, OpenCode, Pi, ZCode, WorkBuddy). Agents hit one local endpoint; CCR routes to configured providers with retries, credential pools, routing rules, and request logging. Ships as an Electron desktop app, an npm CLI (`@musistudio/claude-code-router`, bin `ccr`), and a Docker image. Node >= 22 required.

This clone's `origin` is upstream `musistudio/claude-code-router` - never push here. James's fork is the `jdmanring` remote, and `main` tracks `jdmanring/main`; push branches and `main` there only. An ingest merge carries upstream contributors' commit messages verbatim, which the global pre-push message linter rejects for em-dashes and long subjects; confirm with `git log -1 --format=%an` that every flagged commit is an upstream author, then push with `--no-verify`. Rewriting those messages would permanently diverge the fork.

## Commands

```sh
npm ci                      # install (workspaces, single root node_modules)
npm run dev                 # alias for dev:cli
npm run dev:ui              # watch UI only
npm run dev:cli             # watch CLI + UI
npm run dev:electron        # watch everything + launch Electron (also the default target
                            # when running `node build/dev.mjs` directly)
npm run build:assets        # esbuild all dists + renderers (no electron-builder)
npm run build               # build:assets + electron-builder
npm run typecheck           # tsc --noEmit at root (only type gate; no per-package tsc)

# Tests: two-step harness, NOT jest/vitest. Compile, then run.
npm test                    # all workspaces + architecture tests
npm run test:core           # one workspace (also :ui, :electron, :cli)
npm run test:architecture   # build-boundary rules in tests/architecture/
npm run test:unit -w @claude-code-router/core        # scope filter; not every workspace has
npm run test:integration -w @claude-code-router/ui   # every scope. core: unit+integration;
                                                     # ui: unit+integration+component;
                                                     # electron: unit only; cli: integration only

# Single test file: compile the whole project first, then run node --test on one compiled file.
# node --test applies NO isolation - see the warning below before running one that writes config.
node build/test.mjs core
CCR_INTERNAL_HOME_DIR=$(mktemp -d) HOME=$CCR_INTERNAL_HOME_DIR \
  node --test .test-dist/core/test/unit/gateway/gateway-status.test.js
# Direct node --test bypasses run-tests.mjs home/env isolation; use a throwaway env when needed.

npm run test:e2e            # Playwright, needs build:assets first; tests/e2e/
npm run test:e2e:install    # one-time: playwright install chromium
npm run test:system         # Docker smoke test (alias: test:docker)
npm run docker:build        # also docker:compose:build, docker:compose:up, docker:run
npm run models:update       # regenerate packages/core/models.json from litellm/models.dev/openrouter
npm run rebuild:sqlite3     # electron-rebuild better-sqlite3 after Electron version bumps
```

There is no root lint script; use `npm run typecheck` plus the relevant test target as the routine static checks. The `docs/` directory is a separate Astro site with its own `package.json` (run its own `npm install` there; it is not part of the workspaces).

## Test harness mechanics (read before touching tests)

There is no test framework dependency. `build/test.mjs` esbuild-bundles each project's `test/` tree plus a list of runtime entry points into `.test-dist/<project>/test/` as CJS; `build/run-tests.mjs` runs the compiled files with Node's built-in runner (`node --test`). Each workspace's `npm test` just invokes both scripts with the workspace name. `--scope unit|integration|component` selects a subdirectory of `test/`.

**Running one compiled file directly bypasses home isolation.** The throwaway
`HOME` and `CCR_INTERNAL_*` come from `build/run-tests.mjs`, not from the test
files, so `node --test .test-dist/...` on its own resolves `CONFIGDIR` to the
real `~/.claude-code-router`. A test that calls `replacePersistedAppConfig` or
applies a profile then overwrites the user's actual configuration, silently and
completely. Most tests do not write config and are unaffected; the ones that do
set the env themselves at module scope and import what reads it dynamically
afterwards, because a static import is hoisted above the assignment
(`config-credential-writes.test.mjs` and
`profiles/claude-code-profile-shared-entries.test.mjs` are the pattern). A new
test that writes config does the same, and asserts the throwaway home is in
effect before it writes anything. Not every existing test does this yet, so pass
the env on the command line when running one file.

Two harness behaviors that matter:

- **Runtime selection**: `electron` tests run under the Electron binary (`ELECTRON_RUN_AS_NODE=1`); `core` probes whether plain node can load `better-sqlite3` and falls back to Electron when the native module does not match the node ABI.
- **Home isolation**: tests run with `HOME` and `CCR_INTERNAL_HOME_DIR`/`CCR_INTERNAL_APP_DATA_DIR`/`CCR_INTERNAL_USER_DATA_DIR` pointed at a throwaway temp dir. All config/data path resolution in core goes through `runtime/app-paths.ts` and honors these vars - never read or write `~/.claude-code-router` directly in code or tests.

## Monorepo layout and import system

npm workspaces, four packages:

- `packages/core` - `@claude-code-router/core`. All gateway, routing, providers, storage, agents, config logic. The real application.
- `packages/ui` - `@claude-code-router/ui`. React management UI. Three renderer entry pages under `src/pages/`: `home` (main window), `tray`, `browser`. Home-page state lives in `src/pages/home/shared/` (plain TS modules, no state library); `src/components/ui/` holds shadcn-style primitives.
- `packages/electron` - `@claude-code-router/electron`. Desktop shell: window/tray/menu management, IPC, bundled Claude runtime plugins.
- `packages/cli` - the published package. `src/cli.ts` is the entire CLI (`ccr start|ui|serve|stop|<profile>`).

Cross-package imports use path aliases `@ccr/cli/*`, `@ccr/core/*`, `@ccr/electron/*`, `@ccr/ui/*`, and `@/*` (ui internal). These are resolved by tsconfig `paths` for typecheck, by esbuild `packageAliasPlugin` (`build/esbuild.config.mjs`, `build/test.mjs`) for bundling. Never reach across packages with relative paths - `tests/architecture/package-boundaries.test.mjs` fails the build on it.

Each dist (`packages/*/dist/`) is produced by the root build; `build.mjs` builds all of them in one pass and syncs the ui renderer output into cli/core/electron dists.

## Gateway runtime architecture (the non-obvious part)

CCR does not serve model requests in-process. Flow:

1. `gateway/application/gateway-service.ts` (`gatewayService`, facade re-exported by `gateway/service.ts` - keep that import surface stable) is the orchestrator used by Electron, CLI, and the web management server.
2. The supervisor (`gateway/core-runtime/supervisor.ts`) spawns the vendored gateway runtime - `@the-next-ai/ai-gateway`'s `bin/next-ai-gateway.js`, bundled to `dist/main/next-ai-gateway.js` - as a managed child process.
3. The child runs the compiled `gateway/core-runtime/gateway-bootstrap.ts` first: it receives the compiled config over IPC, then monkey-patches `node:fs` so the gateway runtime "reads" a virtual config file from disk (`GATEWAY_CONFIG_PATH`). Writes/renames to managed config paths are blocked.
4. Config changes restart or reload the child via `gateway/runtime-change.ts`; the old gateway is probed/stopped by `existing-gateway-probe.ts` so port conflicts are detected.
5. Request handling: `routing/` compiles router rules and evaluates them (policies in `routing/policy-engine.ts`, JS route scripts execute in a sandboxed worker `route-script-worker.ts`), then `gateway/upstream/executor.ts` sends to the provider with retry/fallback (`retry-policy.ts`).

Which process runs what is easy to get wrong, and it matters when patching the request path. Agents connect to 3456, which is owned by the CCR process running `dist/main/cli.js`, not by the vendored child; the child owns 3457 only. The upstream fallback loop is bundled into `cli.js` alone. Confirm before assuming: `ss -ltnp | grep -E '3456|3457'` for ownership, and grep the installed `dist/main/*.js` for a symbol from the code being changed to find which bundle carries it.

**The child opens the connection to the provider.** Port ownership is as above,
but the socket to the upstream API belongs to the gateway child, not to
`cli.js`. Verify it rather than reasoning about it: point a provider's base URL
at a local listener, make one request, and read the peer of the established
connection (`ss -tnp | grep <sink-port>` gives both sides; the side whose LOCAL
port is the ephemeral one is the sender). This decides where a request-shaping
bug can live, and it is the difference between a fix that can work and one that
cannot.

**The child rewrites the model id, and drops a leading segment that repeats the
protocol family.** A model called `openai/gpt-oss-120b` addressed on
`openai_chat_completions` leaves as `gpt-oss-120b`; the provider then answers
`400 model_not_found` while the identical request made directly succeeds.
Measured against a local sink: `openai/clean-model` arrived as `clean-model`
while `qwen/`, `z-ai/` and an unrelated `vendorx/` prefix arrived intact. The
selector CCR hands the child is complete, so this is the vendored runtime, not
this repository. A provider hook cannot repair it either: `transformRequest` is
never invoked on that dispatch path, although it fires normally for
`openai_responses`.

The same rule strips a segment matching the provider's **runtime id**, which is
its explicit `id` when set: `poolside::openai_chat_completions/poolside/laguna-s-2.1`
reached the provider as `laguna-s-2.1`. That half has a config-level fix. Giving
the provider an id that is not the model's vendor prefix (`poolside` ->
`poolside-api`) stops the collision without touching the model ids the provider
requires, and both Poolside and Tokeness went from 400 to answering on the first
attempt. Where the colliding segment is the protocol vendor rather than the
provider id there is no such escape, so route those providers through a model
whose first segment is not the protocol vendor.

Other top-level core dirs worth knowing: `agents/` (per-agent integrations: claude-code, codex, claude-app, bot-gateway, kilo, opencode, pi, zcode, local-providers), `providers/` (presets, probing, credential pools, OAuth, account snapshots), `observability/` (request logs, SQLite-backed, body chunks served through a worker), `usage/` (token/cost stats), `mcp/` (MCP servers CCR exposes to agents), `plugins/` (wrapper + core gateway plugins, marketplace), `profiles/` (agent profiles and launching agents against the gateway), `contracts/app.ts` (shared types across all four packages), `web/management-server.ts` (HTTP API + static UI serving for CLI/Docker mode), `storage/sqlite-native.ts` (single better-sqlite3 instance boundary).

Default ports: gateway `127.0.0.1:3456` (agents point here), core gateway 3457, web management UI 3458. Docker fronts everything with nginx on container port 8080, published as 3458.

## Build-time boundary enforcement

Rules live in `build/esbuild.config.mjs` and `tests/architecture/` and fail the build, not review:

- CLI and core-server bundles must not import `electron` (`forbidCliElectronPlugin`). Desktop-only code goes behind an electron-package module.
- "Lightweight" MCP bundles (`fusion-vision-mcp`, `media-tools-proxy-mcp`, `browser-web-search-proxy-mcp`, `fusion-tool-fallback-mcp`) must stay under 128KB and must not pull in `config/`, `storage/`, electron, ui modules, or `better-sqlite3` (`validateLightweightMcpBundles`).
- The home renderer HTML must load `web-client-bridge.js` before the app bundle (`tests/architecture/ui-build-contract.test.mjs`).
- Every workspace must keep its own `test/` dir and `test` script.

When adding imports inside `core`, a new dependency edge can silently violate one of these; if a bundle size or forbidden-input error appears after an import change, this is why.

## Fork-local plugins (`local-plugins/`)

CCR's plugin system is the extension point for anything that must live and die
with the server. Plugins are loaded by absolute module path from the `plugins`
array in config, so `local-plugins/` adds no diff to any file upstream also
ships and an ingest merge has nothing to reconcile.

`local-plugins/process-supervisor.mjs` runs external processes for the server's
lifetime: it starts each in order, waits on its `readyUrl` before the next, and
unwinds in reverse on stop. Tests are not in the workspace harness; run them
with `node --test local-plugins/process-supervisor.test.mjs`.

Three things about the plugin API that are not discoverable from the types:

- **`context.pluginConfig` is the plugin entry's `config` value**, not the entry
  itself (`pluginConfig: pluginConfig.config` in `plugins/service.ts`). Reading
  `.config` off it again yields undefined, and the plugin then does nothing and
  reports nothing.
- **Setting all three `surfaces` to `false` disables the plugin entirely.**
  `loadConfiguredPlugin` returns before importing the module unless
  `apps || gateway || provider` is true, and each reads `!== false`. A
  lifecycle-only plugin must leave `surfaces` unset.
- **`ccr start` discards the daemon's output** (`stdio: "ignore"` in the CLI), so
  `[plugin:<id>] Disabled after startup failure` is never written anywhere. Use
  `ccr serve --no-open` in the foreground to see plugin diagnostics.

## Provider protocol selection

The router picks the upstream protocol from a provider's **`capabilities` list**,
not from its `type` and not from `protocolDetectionMode`. Detection adds a
capability whenever the route exists, and a route that answers 401 rather than
404 reads as supported, so an OpenAI-compatible provider can end up addressed as
`anthropic_messages`.

The failure surfaces as the provider's own HTTP error, which reads as a
credential or quota problem. Measured 2026-09-18: OVH answered 403 and
Fastrouter 400 on `provider::anthropic_messages/...` while both answered 200 on
`/chat/completions` with the same key. `protocolDetectionMode: "manual"` does
not restrict anything; OVH was already manual and still carried three
capabilities.

Read the `provider::protocol/model` triple in `node scripts/ccr-log.mjs --trace
<id>` before attributing a chain 4xx to a provider, and confirm by calling both
endpoints directly.

Note that **CCR stores response bodies only for the final answer, never for
chain attempts**, so a failing fallback leaves a status and no body.

## Model slots, subagents, and what they cost

A CCR-launched Claude Code session gets four model aliases from its profile,
exported as `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`
(`agents/claude-code/environment.ts`). A subagent's `model:` frontmatter selects
among exactly those four, so the choice of alias is a choice of provider chain
and therefore of cost:

| `model:` | Slot resolves to | Chain behind it |
|---|---|---|
| `haiku` | Gemini flash-lite | the Haiku rule's chain, about forty free models |
| `opus` | a local Ollama model | the Opus rule's chain |
| `fable` | the Claude plan model | metered against the plan |
| `sonnet` | an OpenCode Zen free model | see below |

The practical consequence is that **`haiku` subagents are close to free and can
be run many at a time**, which makes fan-out retrieval the cheapest way to
answer a question that spans many files. `fable` is the scarce one and is worth
spending on judgement rather than retrieval. `.claude/agents/scout.md` and
`.claude/agents/architect.md` are the two ends of that.

Two cautions. Small free models do not fail loudly: a scout-style agent must be
told to report "not found" rather than guess, because the caller cannot
distinguish a confident wrong answer from a real one. And the `sonnet` slot
currently points at an OpenCode Zen free model, which refuses every client that
is not OpenCode, so that alias spends an attempt before falling through to the
default chain on every call.

Read the chain a slot actually reaches with `node scripts/config-audit.mjs
--show` rather than assuming; the slots are config, not code.

The rules that give a slot its chain do not live in `Router.rules`, which is
empty. They are in `profile.profiles[<n>].routing.rules`, each with its own
`fallback.models`, which is why a request sent straight to 3456 by hand routes
`source=default` and never exercises them. Checking one by hand therefore needs
the profile, not a bare curl.

That separation hides a dead rule well. A condition is compared against
`request.body.model` verbatim, so it has to spell the provider's display name
exactly as the slot exports it, and nothing warns when it does not: the request
still succeeds, straight down the short default chain. Audit them against each
other rather than reading them, by testing every rule's `condition.right` as a
prefix of some slot value and treating a rule that prefixes none as dead.

## Provider triage

**OVH is anonymous access and takes no API key.** Its empty `api_key` is correct
and is not the cause of any failure; its 429 is the shared anonymous rate limit,
which a probe sweep exhausts on its own. Do not go looking for a credential.

Every provider failure repaired here came down to one of four causes, cheapest
first: a stale model id, a wrong or duplicated base URL (two capabilities of the
same type, first one wins), the gateway truncating a colliding model id, or an
account out of quota. Read the provider's message rather than its status code:
the same 403 covers "free quota exhausted for this model family" and "this
account has no balance", and a 503 can carry `model_not_found`. Probe the
provider directly with the same key, model and body before touching config, and
use at least 16 `max_tokens`, because some providers reject less and that
manufactures a failure that is not there.

**A payment-shaped error is a claim about the request, not the account.** Every
provider configured here offers something free or is already paid for, so
"add credits" is the last conclusion to reach and the only one that costs money
to act on. Two things make it look like the first. `scripts/`-style sweeps read
`upstream.attempt.outcome`, which is CCR's own attempt after the gateway child
has chosen a protocol and rewritten the model id, so a 402 there can be either
of those two faults surfacing as the provider's own error. And the configured model
is often the paid one while the provider's catalogue lists free siblings that
answer 200 on the same key with no balance.

`node scripts/provider-sweep.mjs` is the instrument. It judges each provider on
its own chain attempt rather than on what the client finally received, and it
separates a reading that says nothing yet from the provider's own answer: 429,
502, 503, 504, a transport error, a cooled-down skip and a lost log row are
retried over widening passes, while any other status is terminal on the first
reading. Six providers here were called dead on a single pass that passed again
minutes later, so a one-pass number is not worth quoting. The retryable split is
taken from the awesome-free-byok-models verifier (`scripts/verify.py` there),
which had solved it already.

A sweep tries a provider's first configured model and nothing else, so one
moved, withdrawn or quota-spent lead model reads as the whole provider being
down. Probe the entire configured list one model at a time before concluding:
four providers here were failing on their lead alone while the rest of their
models answered on the same credential. Quota is often per model family rather
than per account, so the exhausted tier and the working tier sit side by side
in one provider. The reading that separates an account gate from a moved model
is whether *every* model returns the same error.

A provider that fronts several upstreams bills per upstream, so the prefix on
the model id chooses the pool and the same model is free under one and charged
under another. Measured on Requesty: `google/gemma-4-31b-it` answers while
`deepinfra/google/gemma-4-31B-it` returns a balance error, and
`nvidia/nemotron-3-ultra-550b-a55b` answers while the `nebius/` copy does not.
Test each prefix rather than the model.

Establish both before writing a sentence about someone's balance: `GET
{base}/v1/models` with the provider's key to see what it calls free, then POST
directly to `{base}/chat/completions` with that model. Only the direct call may
be quoted about an account. Note also that a provider's "free tier" is often a
monthly credit allowance rather than zero-cost models, which exhausts and then
resets without anyone owing anything.

## Local agent OAuth providers

`Claude Code API` and `Codex API` authenticate with the OAuth token belonging to
the locally installed agent, and their `api_key` is a `ccr-local-agent-*` handle
rather than a secret. A direct probe using that handle as a bearer token returns
401 and says nothing about the account, so these two are measurable only through
CCR.

**An Anthropic OAuth token scoped `user:sessions:claude_code` is refused on
/v1/messages unless the first system block identifies the request as Claude
Code.** The refusal is `429 rate_limit_error` with an empty message, which reads
as an exhausted plan and is not one: the same token answers 200 in the same
second once the block is present, while `/api/oauth/usage` reports every limit
at severity `normal`. `local-plugins/gateway-claude-code-oauth-identity.mjs`
restores the block on any request carrying the `oauth-2025-04-20` beta, and
leaves a request that already identifies itself untouched. Before reading a 429
from this provider as a quota, read `getProviderAccountSnapshots`, which calls
the usage endpoint and reports the real figure.

Both providers store a token snapshot in `providerPlugins`, and neither is stuck
with it, for different reasons. Claude Code, Grok and Kimi are handled by
`local-agent-auth-provider-hook.ts`, which re-reads the agent's credential file
on every request and falls back to the snapshot. Codex is not handled there:
`withCodexOauthRuntimeDefaults` in the config compiler substitutes the current
`accessToken`, `refreshToken` and `accountId` from `~/.codex/auth.json` over
whatever the plugin stored, every time the gateway configuration is compiled,
and the vendored runtime then refreshes on its own when the access token parses
as expired or an upstream 401 comes back.

What neither does is notice a rotation **while the gateway is running**. The
Codex CLI rotates the refresh token as well as the access token, so once it has
refreshed, the running gateway holds a refresh token that can no longer be
exchanged, and it falls back to an access token that has expired. The symptom is
401 from a provider whose CLI beside it works. A gateway restart or any real
config change recompiles and fixes it; `importLocalAgentProvider` does the same
for the stored copy. Editing the credential by hand is not the supported path
and the sandbox refuses it.

Read a 429 from `Codex API` with `getProviderAccountSnapshots` before calling it
a credential fault, and a 401 as the rotation above rather than a signed-out
account.

Anthropic publishes the contract this sits on, at
`https://code.claude.com/docs/en/llm-gateway-protocol`, under "system prompt
attribution block", and it says a gateway should not be doing what this one
does. Claude Code prepends an attribution block as the first system block;
`api.anthropic.com` strips it before processing, but positionally, only when it
arrives unchanged and first. The document is explicit that prepending another
system block, reordering the array, or converting it to a single string defeats
the strip, and that a merged block beginning with the attribution header is
treated as attribution in its entirety, so everything merged into it is
dropped, including the rest of the system prompt.

That is a mechanism for the empty 429: a system array flattened into one string
behind the attribution header loses the whole prompt at the endpoint, the
request no longer identifies as Claude Code, and an OAuth token scoped to
Claude Code sessions is refused. It also means the identity block the plugin
prepends sits ahead of the attribution block and defeats the strip, so the
attribution line reaches the model and the prompt cache key. The remedy the
document names for a gateway that must reshape system content is
`CLAUDE_CODE_ATTRIBUTION_HEADER=0` at the client, not repair in the gateway.

Read that section before treating the identity injection as the fix to offer
upstream. Forwarding the `system` array unchanged is what the contract asks
for; the injection restores the 200 without restoring the contract.

`local-plugins/gateway-claude-code-oauth-identity.mjs` predates the core fix and
does the same thing from the plugin host, which needs no rebuild. Both are
idempotent. Note that the plugin host loads plugin modules when the gateway
child starts, so editing the file changes nothing until the child restarts, and
a `saveConfig` whose content is unchanged does not restart it: use
`restartGateway`. DEFER(once the installed dist is rebuilt from this tree):
drop the local plugin and let `withClaudeCodeIdentity` carry it alone.

## Read the provider's own documentation before probing it

Before sending a single request to an endpoint this repository has not used
before, find the provider's API documentation and read it. Every provider here
publishes it, and it names the route group, the credential class and the header
the credential belongs in. Guessing those costs requests against someone's
account and produces traffic that is shaped exactly like enumeration: a
credential tried against six header forms on three hosts is what an attacker
does, and the account being probed belongs to the person this work is for.

Measured 2026-09-19 on Tokenrouter. Six header shapes and two endpoint families
were tried against `/api/user/self` and `/api/usage/token/` on the assumption
that the deployment was vanilla new-api, and every one was refused. The account
API is a separate route group, `/api/management/*`, taking the Management Key
as a bearer token, documented at
`https://www.tokenrouter.com/docs/management-api-documentation`. The first call
made after reading that page returned the wallet.

A refusal is not a reason to vary the header and try again. It is a reason to
go and read what the header should have been.

## Usage tracking

A provider reports usage only when its config carries an `account` block; a
preset supplies one for a minority of providers. Where none exists, an
`http-json` connector can be written by hand against the provider's own
response, with `mapping.meters[]` naming JSONPath expressions for `limit`,
`used` and `remaining` (arithmetic over them is allowed, so
`"$.limits.daily_tokens - $.usage.daily.tokens"` works). Thirteen providers
report here; the recipe and the discovery sweep are in project memory.

Do not wire a provider whose endpoint carries no consumption figures. A
connector over key metadata or a raw request list reports "ok" while showing
nothing, which reads as working tracking and is worse than none.

Relays built on new-api are the common case here and CCR already knows them.
`providers/new-api.ts` ships both endpoint shapes, and the UI can generate the
second: `/api/usage/token/` reads the inference key and reports that key's
allowance, while `/api/user/self` reads the console Manage Key and reports the
account balance. Read the key endpoint before reaching for the
account one, because on these deployments it carries the figure the console
displays: Tokenreply reported 487023 of 500000 remaining, and its console read
"$0.97 of $1.00 remaining, 97% left" in the same hour.

`unlimited_quota` on the key is not a reason to discard those numbers, and
treating it as one cost this repository a working connector. The flag means the
key itself imposes no cap, not that nothing was granted; a deployment can set
it while still tracking an allowance. `newApiKeyUsageMeter` now discards only
when `total_granted` is also zero, which is the case the flag was meant to
cover. The installed build predates that: asked to resolve Tokenreply with
`parser: "new-api-key-usage"` it returns no meters and the message "API key has
no dedicated quota limit", so a connector wired against these providers writes
its `mapping.meters` out rather than naming the preset parser. The mapping also
does not evaluate arithmetic against a literal, so
`"$.data.total_granted / 500000"` yields nothing while the bare path works.
`testProviderAccountConnector` answers both questions before anything is
saved.

The account endpoint is still the one that reports the balance gating a
request, and its cost is one value CCR cannot discover: most builds reject `/api/user/self`
unless a `New-Api-User` header carries the caller's numeric console user id,
and no endpoint reachable with the token returns that id. The response contains
it once the call succeeds, which is no help beforehand. Builds differ: some do not
enforce the header at all, and some refuse the console token on every account
path with a message that does not change with the credential, which says only
that the token is the wrong class for that path. Probe with the token alone
first and read which the deployment is.

## Config drift

A config save replaces the whole stored blob and nothing checks it against the
revision its author read, so any client holding a stale copy reverts every
change made since. The management UI holds exactly such a copy for as long as
its page is open.

`loadAppConfig` issues a `configRevision` identifying the stored config, and the
management RPC refuses a `saveConfig` whose revision is no longer current. The
field is stripped before writing, so it never becomes part of what it
identifies, and a save that omits it is accepted as before. The check lives at
that boundary rather than inside `saveAppConfig` on purpose: internal flows
(theme, profiles, credential rotation) legitimately load a config and save it
moments later, and guarding those breaks flows that were never the problem.

Two things also make a revert visible rather than silent. Every write logs the
top-level keys it moved (`[config] write changed: ...` in `ccr-service.log`),
and `node scripts/config-audit.mjs` diffs the behaviour-deciding parts of the
config against a saved baseline, naming the exact value that moved. Take the
baseline with `--save` once the config is known good. Credentials are reduced to
their length, so the baseline holds no secret.

## Chain attempt numbering

Two different counts describe a fallback chain and they are not interchangeable:

- The chain **position** of an attempt (`index + 1`, published as
  `x-ccr-route-attempt` on the upstream request and `x-ccr-final-route-attempt`
  on the response) counts every entry the loop walked, including entries skipped
  because the target was cooling down.
- The **failure count** (`failedAttempts.length + 1`, published as
  `x-ccr-fallback-attempts`) counts only attempts that were sent and failed. A
  skipped entry never enters `failedAttempts`.

The two diverge by one for every skip. `request_log_store` matches raw trace
bundles to a request by chain position, so it reads the position header;
reading the failure count instead admits a failed attempt's bundle as the final
one, and the stored status, provider, model and body then describe an attempt
the client never received. `x-ccr-fallback-attempts` cannot be repurposed for
position, because `x-ccr-fallback-failures` is parsed positionally against it.

`failedAttempts.length` also feeds the retry backoff, so it is not free to
redefine either.

## Routing rules match the request body verbatim

A rule condition compares against `request.body.model` exactly as the agent
sent it, not against a provider display name. The value that actually arrives
is in the request log's `requested_model` column; read it before writing or
trusting a condition. A condition that names a provider label rather than the
sent string never fires, which leaves its rewrite and its whole fallback chain
unreachable while the request still succeeds by going directly to the model it
named. The symptom is silence, not an error.

## Tool routing for this repository

These questions have an instrument that answers them better than grep, and this
session repeatedly reached for grep instead. The cost was real: the Electron
save boundary was missed until the code graph pointed at `AppConfig` as a hub
and the symbol route produced the caller set.

| Question | Instrument |
|---|---|
| Who calls X, what implements X, does this already exist | Serena (`find_symbol`, `find_referencing_symbols`), not grep |
| Which symbols are central, where do I start reading | `graphify update . --no-cluster --force && graphify god-nodes`, rebuilt in the same breath, verified by node count and graph mtime |
| Does this compiled artifact match the runtime | `re_verify_claim` against the binary, with a deliberately false control claim |
| What does the memory graph look like | `python3 ~/.claude/memory_graph.py --check` |
| Proving a negative | `command grep`; a plain search honours ignore files and under-reports |

Two traps this repository has already sprung. A Serena reference query that
returns nothing has not proven absence, and its cross-package index does not
always resolve references here, so confirm a negative by a second route.
Degree in the god-node ranking conflates fan-in with fan-out, so take the
caller set from the symbol index rather than reading the ranking as importance.

## What actually runs is an installed build, not this tree

`ccr` resolves to a global npm install
(`~/.nvm/versions/node/*/lib/node_modules/@musistudio/claude-code-router`),
built from a tarball at some past moment. A commit merged to `main` changes
nothing about the running gateway until that package is rebuilt and installed,
and both report the same `version`, so the version number cannot tell them
apart.

Deciding whether a fix is live has one reliable check and one trap. The trap is
grepping the installed bundle for an identifier: the bundle is minified, so an
internal name is renamed and reads as absent while the code is present
(`targetCooldown` greps zero in a bundle that contains `target-cooling-down`).
What survives minification is a string literal and a property name crossing an
RPC boundary. The check that no bundler can defeat is the clock: compare the
bundle's mtime against `git log -1 --format=%cd <commit>`, and anything
committed later cannot be in it.

This is also why `local-plugins/` matters more than it looks. A plugin is loaded
by absolute path from the user's config, so it runs against the installed
build immediately, while the equivalent core change waits for a reinstall.

## Test baseline

`origin/main` does not pass its own core suite. Before attributing a core test failure to local work, reproduce it against pure upstream in a throwaway worktree (`git worktree add --detach <dir> origin/main`, symlink the root `node_modules`, then `node build/test.mjs core && node build/run-tests.mjs core`) and compare failure names. Attribute only the difference.

## Generated files

- `packages/core/models.json` is generated by `scripts/generate-models-json.mjs` from litellm, models.dev, and OpenRouter catalogs; it is copied into every dist. Never hand-edit; run `npm run models:update`.
- Renderer HTML in `dist/` is derived from `packages/ui/src/pages/*/index.html` via `copyRendererPageHtml` - edit the source page, not dist.

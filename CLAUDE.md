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

# Single test file: compile the whole project first, then run node --test on one compiled file
node build/test.mjs core
node --test .test-dist/core/test/unit/gateway/gateway-status.test.js

npm run test:e2e            # Playwright, needs build:assets first; tests/e2e/
npm run test:e2e:install    # one-time: playwright install chromium
npm run test:system         # Docker smoke test (alias: test:docker)
npm run docker:build        # also docker:compose:build, docker:compose:up, docker:run
npm run models:update       # regenerate packages/core/models.json from litellm/models.dev/openrouter
npm run rebuild:sqlite3     # electron-rebuild better-sqlite3 after Electron version bumps
```

The `docs/` directory is a separate Astro site with its own `package.json` (own `npm install`, not part of the workspaces).

## Test harness mechanics (read before touching tests)

There is no test framework dependency. `build/test.mjs` esbuild-bundles each project's `test/` tree plus a list of runtime entry points into `.test-dist/<project>/test/` as CJS; `build/run-tests.mjs` runs the compiled files with Node's built-in runner (`node --test`). Each workspace's `npm test` just invokes both scripts with the workspace name. `--scope unit|integration|component` selects a subdirectory of `test/`.

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

## Test baseline

`origin/main` does not pass its own core suite. Before attributing a core test failure to local work, reproduce it against pure upstream in a throwaway worktree (`git worktree add --detach <dir> origin/main`, symlink the root `node_modules`, then `node build/test.mjs core && node build/run-tests.mjs core`) and compare failure names. Attribute only the difference.

## Generated files

- `packages/core/models.json` is generated by `scripts/generate-models-json.mjs` from litellm, models.dev, and OpenRouter catalogs; it is copied into every dist. Never hand-edit; run `npm run models:update`.
- Renderer HTML in `dist/` is derived from `packages/ui/src/pages/*/index.html` via `copyRendererPageHtml` - edit the source page, not dist.

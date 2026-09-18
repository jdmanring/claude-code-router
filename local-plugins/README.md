# Fork-local CCR plugins

Plugins loaded by absolute path from this checkout, not published and not part of
any workspace build.

They live in their own top-level directory on purpose. CCR's plugin system is an
extension point that takes a module path, so nothing here requires editing a file
upstream also ships, and an ingest merge has nothing to reconcile. A new
directory is the cheapest form of divergence there is.

For the same reason these tests are not wired into the root `npm test`, which
would mean editing a tracked upstream file. Run them directly:

```sh
node --test local-plugins/process-supervisor.test.mjs
node --test local-plugins/gateway-codex-reasoning-content.test.mjs
```

Two different plugin hosts load files from here, and they are not
interchangeable. `process-supervisor.mjs` is a **CCR** plugin: CCR imports it in
its own process and calls `setup`/`onStop`.
`gateway-codex-reasoning-content.mjs` is a **vendored gateway** plugin: it is
named by `coreGateway.plugins[].modulePath` on a CCR plugin config entry, and
the compiled config carries it into the `@the-next-ai/ai-gateway` child process,
which imports it there. A CCR plugin cannot see an upstream request body that
the gateway builds, and a gateway plugin has none of CCR's lifecycle hooks.

## process-supervisor

Runs external processes for as long as CCR runs, and stops them when it stops.
Configured entirely from its own `config` key in the plugin config; see the
header comment in `process-supervisor.mjs` for the shape and for what each
setting does.

Two behaviours worth knowing before relying on it:

- **It refuses to SIGKILL by default.** A process that ignores SIGTERM is
  reported and left alive, because the processes this exists to run include a
  datastore and killing one mid-write trades a slow shutdown for a corrupt
  store. Set `"force": true` per process where losing in-flight work is fine.
- **It will not start a second copy** of anything already answering its
  `readyUrl`. An orphan from a CCR that was killed rather than stopped still
  holds its port, and a second copy of a single-writer store is worse than none.

It cannot help when CCR itself is killed rather than stopped, since `onStop`
never runs. The started pids are logged for that case.

## gateway-codex-reasoning-content

Empties the `content` array on every `reasoning` item in an OpenAI Responses
request body. The API rejects a reasoning item whose `content` is non-empty
(`Invalid 'input[N].content': array too long`), so replaying a conversation that
already contains reasoning fails every time and burns that chain entry.

It has to run here and nowhere else. CCR's own request transforms see the body
while it is still Anthropic-shaped; the Responses `input[]` is assembled later,
inside the gateway child. A provider hook is the first point at which the field
being removed exists. Measured: a CCR-level transform registered against the
same traffic logged zero hits in four minutes of live Codex 400s.

The hook is deliberately not matched to a provider. The constraint belongs to
the Responses request shape rather than to one account, and a body with no
reasoning item carrying content is returned as the same object, so anything else
is untouched.

It logs once on load and once per request that it changes. Both lines matter: a
plugin that never matched and a plugin that never loaded are otherwise
indistinguishable in the log, which is how an earlier attempt at this fix was
mistaken for a working one.

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
```

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

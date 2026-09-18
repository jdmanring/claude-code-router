import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";

// This test writes configs, so it isolates itself rather than relying on the
// runner. See the harness note in CLAUDE.md.
const root = path.join(os.tmpdir(), `ccr-stale-save-${process.pid}-${randomUUID().slice(0, 8)}`);
process.env.HOME = path.join(root, "home");
process.env.CCR_INTERNAL_HOME_DIR = path.join(root, "home");
process.env.CCR_INTERNAL_APP_DATA_DIR = path.join(root, "app-data");
process.env.CCR_INTERNAL_USER_DATA_DIR = path.join(root, "user-data");
mkdirSync(process.env.HOME, { recursive: true });

let configApi;
before(async () => {
  configApi = await import("@ccr/core/config/config.ts");
});

// The guard runs where a client writes through, so the tests call it the way
// the management RPC does rather than relying on saveAppConfig to enforce it.
const saveAsClient = async (config) => {
  await configApi.assertAppConfigRevisionIsCurrent(config.configRevision);
  return configApi.saveAppConfig(config);
};

test("the throwaway home is in effect before anything is written", () => {
  assert.ok(os.homedir().startsWith(root), `refusing to run against ${os.homedir()}`);
});

test("a loaded config carries a revision, and it changes when the config changes", async () => {
  const first = await configApi.loadAppConfig();
  assert.ok(first.configRevision, "load must issue a revision");

  const saved = await saveAsClient({ ...first, preferredProvider: "one" });
  assert.ok(saved.configRevision, "a save must return the new revision");
  assert.notEqual(saved.configRevision, first.configRevision, "changing the config must change its revision");

  const reloaded = await configApi.loadAppConfig();
  assert.equal(reloaded.configRevision, saved.configRevision, "load and save must agree on the current revision");
});

// The defect this prevents: a client reads the config, something else writes,
// and the client's later save silently reverts that write.
test("a save based on a superseded config is refused", async () => {
  const stale = await configApi.loadAppConfig();
  await saveAsClient({ ...stale, preferredProvider: "written-by-someone-else" });

  await assert.rejects(
    () => saveAsClient({ ...stale, autoStart: !stale.autoStart }),
    (error) => error.name === "StaleAppConfigError",
    "the stale save must be refused"
  );

  const current = await configApi.loadAppConfig();
  assert.equal(current.preferredProvider, "written-by-someone-else",
    "the write that happened in between must survive");
});

test("the refusal names the recovery rather than just failing", async () => {
  const stale = await configApi.loadAppConfig();
  await saveAsClient({ ...stale, preferredProvider: "moved-again" });
  await assert.rejects(
    () => saveAsClient({ ...stale, autoStart: !stale.autoStart }),
    (error) => /reload/i.test(error.message)
  );
});

// Electron, the CLI and scripts build a config rather than editing a loaded
// one. Those callers must keep working exactly as before.
test("a save without a revision is still accepted", async () => {
  const current = await configApi.loadAppConfig();
  const { configRevision: _dropped, ...withoutRevision } = current;
  const saved = await saveAsClient({ ...withoutRevision, preferredProvider: "no-token-caller" });
  assert.equal(saved.preferredProvider, "no-token-caller");
});

test("the revision is never written into the stored config", async () => {
  const loaded = await configApi.loadAppConfig();
  await saveAsClient({ ...loaded, preferredProvider: "check-storage" });
  const repo = await import("@ccr/core/config/config-repository.ts");
  const stored = await repo.loadPersistedAppConfig();
  assert.equal(Object.hasOwn(stored, "configRevision"), false,
    "storing the revision inside the blob would change what it identifies on every write");
});

// Saving twice in a row from one client is ordinary. It must not trip the
// check, because a save hands back the revision its result now carries.
test("consecutive saves from one caller are accepted", async () => {
  let config = await configApi.loadAppConfig();
  for (const value of ["first", "second", "third"]) {
    config = await saveAsClient({ ...config, preferredProvider: value });
    assert.equal(config.preferredProvider, value);
  }
});

// Internal flows load a config and save it moments later. They must not be
// caught by a guard aimed at a client holding a page open for an hour.
test("an internal save is not subject to the client guard", async () => {
  const loaded = await configApi.loadAppConfig();
  await configApi.saveAppConfig({ ...loaded, preferredProvider: "changed-elsewhere" });

  const saved = await configApi.saveAppConfig({ ...loaded, autoStart: !loaded.autoStart });
  assert.equal(saved.autoStart, !loaded.autoStart, "saveAppConfig itself must stay permissive");
});

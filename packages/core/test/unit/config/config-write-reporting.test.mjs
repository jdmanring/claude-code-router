import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test, { before, beforeEach } from "node:test";

const root = path.join(process.env.CCR_INTERNAL_HOME_DIR || os.tmpdir(), `config-write-reporting-${process.pid}`);
process.env.CCR_INTERNAL_HOME_DIR = path.join(root, "home");
process.env.CCR_INTERNAL_APP_DATA_DIR = path.join(root, "app-data");
process.env.CCR_INTERNAL_USER_DATA_DIR = path.join(root, "user-data");

let configApi;
before(async () => {
  configApi = await import("@ccr/core/config/config.ts");
});

let warnings;
const originalWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (message) => {
    warnings.push(String(message));
    return undefined;
  };
});
test.after(() => {
  console.warn = originalWarn;
});

const configWrites = () => warnings.filter((line) => line.startsWith("[config] write changed:"));

test("a write that moves a key names it", async () => {
  const current = await configApi.loadAppConfig();
  await configApi.saveAppConfig({ ...current, autoStart: !current.autoStart });

  const reported = configWrites();
  assert.equal(reported.length, 1, warnings.join("\n"));
  assert.match(reported[0], /autoStart/);
});

test("rewriting the same config reports nothing", async () => {
  const current = await configApi.loadAppConfig();
  await configApi.saveAppConfig(current);

  assert.deepEqual(configWrites(), [], "an unchanged write must not be reported as a change");
});

// The defect this exists to surface: a caller saves a config it read earlier,
// silently reverting every key changed since. The report has to name the key
// the stale author never touched, which is the only visible trace of it.
test("a stale save names the key it reverts", async () => {
  const stale = await configApi.loadAppConfig();
  await configApi.saveAppConfig({ ...stale, preferredProvider: "written-by-someone-else" });

  warnings = [];
  await configApi.saveAppConfig({ ...stale, autoStart: !stale.autoStart });

  const reported = configWrites();
  assert.equal(reported.length, 1, warnings.join("\n"));
  assert.match(reported[0], /preferredProvider/, "the reverted key must be named, not just the intended one");
  assert.equal(
    (await configApi.loadAppConfig()).preferredProvider,
    stale.preferredProvider,
    "the revert itself still happens; this reports it rather than preventing it"
  );
});

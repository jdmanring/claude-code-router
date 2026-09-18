import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";

const root = path.join(process.env.CCR_INTERNAL_HOME_DIR || os.tmpdir(), `config-router-diff-${process.pid}`);
process.env.CCR_INTERNAL_HOME_DIR = path.join(root, "home");
process.env.CCR_INTERNAL_APP_DATA_DIR = path.join(root, "app-data");
process.env.CCR_INTERNAL_USER_DATA_DIR = path.join(root, "user-data");

let configApi;
let repo;
before(async () => {
  configApi = await import("@ccr/core/config/config.ts");
  repo = await import("@ccr/core/config/config-repository.ts");
});

test("a deliberately disabled detectStreamErrors survives repeated saves", async () => {
  const current = await configApi.loadAppConfig();
  await configApi.saveAppConfig({
    ...current,
    Router: { ...current.Router, fallback: { ...current.Router.fallback, detectStreamErrors: false } }
  });

  const afterFirst = await configApi.loadAppConfig();
  console.log("after first save :", JSON.stringify(afterFirst.Router.fallback));
  console.log("persisted        :", JSON.stringify((await repo.loadPersistedAppConfig())?.Router?.fallback));

  await configApi.saveAppConfig(afterFirst);
  const afterSecond = await configApi.loadAppConfig();
  console.log("after second save:", JSON.stringify(afterSecond.Router.fallback));
  console.log("persisted        :", JSON.stringify((await repo.loadPersistedAppConfig())?.Router?.fallback));

  assert.equal(afterFirst.Router.fallback.detectStreamErrors, false, "the setting must persist through one save");
  assert.equal(afterSecond.Router.fallback.detectStreamErrors, false, "a second save must not silently re-enable it");
});

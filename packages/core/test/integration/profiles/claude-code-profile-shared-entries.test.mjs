import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";

// Isolation is set here rather than relied on from the runner. build/run-tests.mjs
// points HOME and CCR_INTERNAL_* at a throwaway directory, but the documented
// way to run one file is `node --test` on the compiled output, which applies
// none of that. This test writes a whole config, so without its own isolation
// running it directly replaces the real one. The env has to be set before the
// modules that read it are loaded, hence the dynamic imports below.
const root = path.join(os.tmpdir(), `ccr-profile-shared-entries-${process.pid}-${randomUUID().slice(0, 8)}`);
process.env.HOME = path.join(root, "home");
process.env.CCR_INTERNAL_HOME_DIR = path.join(root, "home");
process.env.CCR_INTERNAL_APP_DATA_DIR = path.join(root, "app-data");
process.env.CCR_INTERNAL_USER_DATA_DIR = path.join(root, "user-data");
mkdirSync(process.env.HOME, { recursive: true });

let createDefaultAppConfig;
let replacePersistedAppConfig;
let applyProfileConfig;
let CONFIGDIR;
before(async () => {
  ({ createDefaultAppConfig } = await import("@ccr/core/config/default-config.ts"));
  ({ replacePersistedAppConfig } = await import("@ccr/core/config/config-repository.ts"));
  ({ applyProfileConfig } = await import("@ccr/core/profiles/service.ts"));
  ({ CONFIGDIR } = await import("@ccr/core/config/constants.ts"));
});

// resolveUserPath reads os.homedir(), which follows HOME on POSIX, so this is
// the throwaway home rather than the real one.
const userClaudeDir = () => path.join(os.homedir(), ".claude");

// The temp home persists between runs of the same file, so a fixed profile id
// would let a previous run's links satisfy the assertions and hide a regression.
const runId = randomUUID().slice(0, 8);

function profileFor(name) {
  const id = `${name}-${runId}`;
  return {
    agent: "claude-code",
    enabled: true,
    env: {},
    id,
    model: "Provider/model",
    name: id,
    scope: "ccr",
    smallFastModel: "",
    surface: "cli"
  };
}

async function applyWith(profile) {
  const config = createDefaultAppConfig();
  config.Providers = [{
    api_base_url: "https://example.test/v1",
    api_key: "provider-key",
    models: ["model"],
    name: "Provider"
  }];
  config.profile.profiles = [profile];
  await replacePersistedAppConfig(config);
  await applyProfileConfig(config);
  return path.join(CONFIGDIR, "profiles", profile.id, "claude");
}

test("the throwaway home is in effect before anything is written", () => {
  assert.ok(os.homedir().startsWith(root), `refusing to run against ${os.homedir()}`);
  assert.ok(CONFIGDIR.startsWith(root), `refusing to write config under ${CONFIGDIR}`);
});

test("a generated Claude Code profile links the user's own content into its config dir", async () => {
  for (const entry of ["agents", "commands", "sessions", "skills"]) {
    mkdirSync(path.join(userClaudeDir(), entry), { recursive: true });
  }
  writeFileSync(path.join(userClaudeDir(), "skills", "marker.md"), "skill marker\n");

  const profileHome = await applyWith(profileFor("shared-entries"));

  for (const entry of ["agents", "commands", "sessions", "skills"]) {
    const linked = path.join(profileHome, entry);
    assert.ok(existsSync(linked), `${entry} must exist in the profile config dir`);
    assert.ok(lstatSync(linked).isSymbolicLink(), `${entry} must be a link, not a private copy`);
    assert.equal(readlinkSync(linked), path.join(userClaudeDir(), entry));
  }

  // The point of the sessions link: a profile session registers where every
  // other session can discover it, instead of in a directory of its own.
  assert.ok(existsSync(path.join(profileHome, "skills", "marker.md")),
    "content added to the user's skills must be visible through the link");
});

test("a plugin directory is not adopted on the user's behalf", async () => {
  mkdirSync(path.join(userClaudeDir(), "plugins"), { recursive: true });
  const profileHome = await applyWith(profileFor("no-plugin-link"));

  // Unlike the entries that are linked, the plugin directory is mutable state
  // with its own cache of marketplace revisions per config directory. Linking
  // it would not consolidate the two, it would change which revision every
  // session in the profile loads; see linkClaudeCodeProfileSharedEntries.
  assert.equal(existsSync(path.join(profileHome, "plugins")), false,
    "plugins must not be linked into a profile config dir");
});

test("an existing real directory in the profile dir is left alone", async () => {
  const profile = profileFor("keeps-existing");
  const profileHome = path.join(CONFIGDIR, "profiles", profile.id, "claude");
  mkdirSync(path.join(profileHome, "skills"), { recursive: true });
  writeFileSync(path.join(profileHome, "skills", "local.md"), "profile-local\n");

  await applyWith(profile);

  const linked = path.join(profileHome, "skills");
  assert.equal(lstatSync(linked).isSymbolicLink(), false,
    "a directory the profile already owns must not be replaced by a link");
  assert.ok(existsSync(path.join(linked, "local.md")), "its contents must survive");
});

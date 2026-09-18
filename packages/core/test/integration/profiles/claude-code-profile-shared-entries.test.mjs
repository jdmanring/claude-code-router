import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createDefaultAppConfig } from "@ccr/core/config/default-config.ts";
import { replacePersistedAppConfig } from "@ccr/core/config/config-repository.ts";
import { CONFIGDIR } from "@ccr/core/config/constants.ts";
import { applyProfileConfig } from "@ccr/core/profiles/service.ts";

// The harness points HOME at a throwaway directory, and resolveUserPath reads
// os.homedir(), so "~/.claude" here is the temp home rather than the real one.
const userClaudeDir = path.join(os.homedir(), ".claude");

const runId = randomUUID().slice(0, 8);

function profileFor(id) {
  id = `${id}-${runId}`;
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

test("a generated Claude Code profile links the user's own content into its config dir", async () => {
  for (const entry of ["agents", "commands", "sessions", "skills"]) {
    mkdirSync(path.join(userClaudeDir, entry), { recursive: true });
  }
  writeFileSync(path.join(userClaudeDir, "skills", "marker.md"), "skill marker\n");

  const profileHome = await applyWith(profileFor("shared-entries"));

  for (const entry of ["agents", "commands", "sessions", "skills"]) {
    const linked = path.join(profileHome, entry);
    assert.ok(existsSync(linked), `${entry} must exist in the profile config dir`);
    assert.ok(lstatSync(linked).isSymbolicLink(), `${entry} must be a link, not a private copy`);
    assert.equal(readlinkSync(linked), path.join(userClaudeDir, entry));
  }

  // The point of the sessions link: a profile session registers where every
  // other session can discover it, instead of in a directory of its own.
  assert.ok(existsSync(path.join(profileHome, "skills", "marker.md")),
    "content added to the user's skills must be visible through the link");
});

test("a plugin directory is not adopted on the user's behalf", async () => {
  mkdirSync(path.join(userClaudeDir, "plugins"), { recursive: true });
  const profileHome = await applyWith(profileFor("no-plugin-link"));

  // A plugin can register blocking hooks and MCP servers, so adopting one is a
  // permissions decision. Linking it silently would make that decision for the
  // user; see the note on linkClaudeCodeProfileSharedEntries.
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

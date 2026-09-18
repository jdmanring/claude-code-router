import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const cliRuntime = path.join(process.cwd(), ".test-dist", "cli", "runtime", "cli.js");

// The harness points HOME and the CCR_INTERNAL_* dirs at a throwaway directory,
// so this starts a service of its own rather than touching a real one. The port
// is high and the gateway is off so it cannot collide with a running instance.
const PORT = "39917";

function runCli(args) {
  return spawnSync(process.execPath, [cliRuntime, ...args], { encoding: "utf8" });
}

function serviceLogPath() {
  // resolveRuntimeConfigDir(): <home>/.claude-code-router, with the home taken
  // from CCR_INTERNAL_HOME_DIR when the harness isolates it.
  const home = process.env.CCR_INTERNAL_HOME_DIR ?? process.env.HOME ?? "";
  return path.join(home, ".claude-code-router", "ccr-service.log");
}

test("the detached service writes its output to a log instead of discarding it", () => {
  const started = runCli(["start", "--port", PORT, "--no-gateway", "--no-open"]);
  try {
    assert.equal(started.status, 0, started.stderr || started.stdout);

    const logFile = serviceLogPath();
    assert.ok(existsSync(logFile), `no service log at ${logFile}`);

    // Non-empty is the point: an empty file would mean the output is still being
    // thrown away, just into a different sink.
    const contents = readFileSync(logFile, "utf8");
    assert.ok(
      contents.trim().length > 0,
      "the service log exists but is empty, so the child's output is still discarded"
    );
  } finally {
    runCli(["stop"]);
  }
});

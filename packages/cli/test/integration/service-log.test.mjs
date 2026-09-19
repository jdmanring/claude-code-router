import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

test("starting again keeps the previous run's log instead of overwriting it", () => {
  // The log is opened with "w" so it cannot grow without bound. On its own that
  // erases the start that just failed, which is the one worth reading.
  const logFile = serviceLogPath();
  const previous = `${logFile}.1`;
  const marker = "[test] output from the run before this one\n";

  const first = runCli(["start", "--port", PORT, "--no-gateway", "--no-open"]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  runCli(["stop"]);

  writeFileSync(logFile, marker);
  const second = runCli(["start", "--port", PORT, "--no-gateway", "--no-open"]);
  try {
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.ok(existsSync(previous), `no rotated log at ${previous}`);
    assert.equal(readFileSync(previous, "utf8"), marker, "the previous run's output was not kept verbatim");
    assert.ok(!readFileSync(logFile, "utf8").includes(marker), "the new run reused the old file instead of starting clean");
  } finally {
    runCli(["stop"]);
  }
});

test("both generations of the service log are readable only by their owner", () => {
  // The daemon's first line names the management URL, which carries the web
  // auth token. That token authorises the RPC that returns the whole config,
  // every provider credential included, and a route-script test that writes
  // files. `service.json` holds the same value at 0o600; a log at the default
  // 0644 hands it to any reader of the home directory.
  //
  // The rotated generation is asserted separately because a rename carries the
  // old mode with it, so creating the new file correctly is not enough.
  const logFile = serviceLogPath();
  const previous = `${logFile}.1`;
  const mode = (file) => statSync(file).mode & 0o777;

  const first = runCli(["start", "--port", PORT, "--no-gateway", "--no-open"]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  runCli(["stop"]);
  assert.equal(mode(logFile), 0o600, `service log is ${mode(logFile).toString(8)}, expected 600`);

  const second = runCli(["start", "--port", PORT, "--no-gateway", "--no-open"]);
  try {
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(mode(logFile), 0o600, "the new log is not owner-only");
    assert.ok(existsSync(previous), `no rotated log at ${previous}`);
    assert.equal(mode(previous), 0o600, `rotated log is ${mode(previous).toString(8)}, expected 600`);
  } finally {
    runCli(["stop"]);
  }
});

test("the daemon's log names the management address without its auth token", () => {
  // Under `ccr start` this stream is the log. The token authorises the RPC
  // that returns the whole configuration, provider credentials included, so a
  // log line carrying it is a working credential for every provider key.
  // service.json keeps the tokenised address and is written 0o600.
  const logFile = serviceLogPath();
  const started = runCli(["start", "--port", PORT, "--no-gateway", "--no-open"]);
  try {
    assert.equal(started.status, 0, started.stderr || started.stdout);
    const contents = readFileSync(logFile, "utf8");
    assert.match(contents, /CCR web management is running at http/, "the address is not announced at all");
    assert.ok(!contents.includes("ccr_web_token="), "the auth token reached the service log");
  } finally {
    runCli(["stop"]);
  }
});

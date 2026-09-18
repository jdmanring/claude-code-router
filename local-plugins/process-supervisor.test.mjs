import assert from "node:assert/strict";
import test, { after } from "node:test";
import { setup } from "./process-supervisor.mjs";

const NODE = process.execPath;

/**
 * Mirrors how CCR builds the plugin context. The host passes the plugin entry's
 * `config` value through as `pluginConfig`, so a test that nests `config` again
 * encodes the wrong contract: it passes while the real plugin reads one level
 * too deep and starts nothing. See `pluginConfig: pluginConfig.config` in
 * `packages/core/src/plugins/service.ts`.
 */
function hostContext(logger, entry) {
  return { logger, pluginConfig: entry.config };
}

/** Ask the OS, not the code under test. Signal 0 throws ESRCH once a pid is gone. */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Anything a test starts is force-killed at the end, including what the plugin
 *  deliberately refuses to kill, so a failing run cannot leak daemons. */
const spawnedPids = new Set();
after(() => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
});

function recorder() {
  const lines = [];
  const record = (message) => {
    lines.push(String(message));
    const match = /\(pid (\d+)\)/.exec(String(message));
    if (match) spawnedPids.add(Number(match[1]));
  };
  return { lines, info: record, warn: record, error: record };
}

const pidsFrom = (logger) =>
  logger.lines
    .map((line) => /\(pid (\d+)\)/.exec(line))
    .filter(Boolean)
    .map((match) => Number(match[1]));

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
const forever = (extra = "") => ({
  command: NODE,
  args: ["-e", `${extra}setInterval(() => {}, 1000)`]
});
const entry = (processes) => ({ config: { processes } });

test("a started process really runs, and onStop really ends it", async () => {
  const logger = recorder();
  const registration = await setup(hostContext(logger, entry([{ name: "sleeper", ...forever() }])));
  const [pid] = pidsFrom(logger);
  assert.ok(pid, "the plugin reported no pid, so liveness cannot be checked");
  assert.equal(isAlive(pid), true, "the process was not running after setup");

  await registration.onStop({ reason: "stop" });
  await settle(200);
  assert.equal(isAlive(pid), false, "onStop returned but the process is still running");
});

test("processes start in declaration order and stop in reverse", async () => {
  const logger = recorder();
  const registration = await setup(
    hostContext(logger, entry([{ name: "first", ...forever() }, { name: "second", ...forever() }]))
  );
  const started = logger.lines.filter((line) => line.includes("started "));
  assert.match(started[0], /first/);
  assert.match(started[1], /second/);

  await registration.onStop({ reason: "stop" });
  const stopped = logger.lines.filter((line) => line.includes(" stopped"));
  assert.match(stopped[0], /second/, "shutdown must unwind in reverse, dependants before dependencies");
  assert.match(stopped[1], /first/);
});

test("a readiness failure stops what already started instead of leaking it", async () => {
  const logger = recorder();
  await assert.rejects(
    setup(
      hostContext(
        logger,
        entry([
          { name: "healthy", ...forever() },
          {
            name: "never-ready",
            ...forever(),
            readyUrl: "http://127.0.0.1:59999/healthz",
            readyTimeoutMs: 700
          }
        ])
      )
    ),
    /did not answer/
  );
  await settle(300);
  const pids = pidsFrom(logger);
  assert.equal(pids.length, 2, "expected both processes to have been started");
  for (const pid of pids) {
    assert.equal(isAlive(pid), false, `a process was left running after setup failed: ${pid}`);
  }
});

test("a process that exits early is reported as exiting, not as a readiness timeout", async () => {
  const logger = recorder();
  await assert.rejects(
    setup(
      hostContext(
        logger,
        entry([
          {
            name: "instant-exit",
            command: NODE,
            args: ["-e", "process.exit(3)"],
            readyUrl: "http://127.0.0.1:59999/healthz",
            readyTimeoutMs: 8000
          }
        ])
      )
    ),
    /exited with code 3 before it became ready/
  );
});

test("a process ignoring SIGTERM survives when force is unset, and is reported", async () => {
  const logger = recorder();
  const registration = await setup(
    hostContext(
      logger,
      entry([
        { name: "stubborn", ...forever("process.on('SIGTERM', () => {});"), stopTimeoutMs: 400 }
      ])
    )
  );
  const [pid] = pidsFrom(logger);
  // The child installs its handler asynchronously; signalling first means the
  // default action kills it and the test proves nothing.
  await settle(400);
  await registration.onStop({ reason: "stop" });

  assert.equal(isAlive(pid), true, "a datastore that ignores SIGTERM must not be killed by default");
  assert.ok(
    logger.lines.some((line) => line.includes("still running")),
    "surviving the stop must be reported, not silent"
  );
});

test("force ends a process that ignores SIGTERM", async () => {
  const logger = recorder();
  const registration = await setup(
    hostContext(
      logger,
      entry([
        {
          name: "stubborn-forced",
          ...forever("process.on('SIGTERM', () => {});"),
          stopTimeoutMs: 400,
          force: true
        }
      ])
    )
  );
  const [pid] = pidsFrom(logger);
  await settle(400);
  await registration.onStop({ reason: "stop" });
  await settle(200);
  assert.equal(isAlive(pid), false, "force was set but the process survived");
});

test("an entry already answering its readiness url is not started again", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const logger = recorder();
  try {
    const registration = await setup(
      hostContext(
        logger,
        entry([
          {
            name: "already-up",
            // Would exit 3 immediately and fail setup if it were ever spawned.
            command: NODE,
            args: ["-e", "process.exit(3)"],
            readyUrl: `http://127.0.0.1:${port}/`
          }
        ])
      )
    );
    assert.equal(pidsFrom(logger).length, 0, "it spawned a duplicate of a process already serving");
    await registration.onStop({ reason: "stop" });
  } finally {
    server.close();
  }
});

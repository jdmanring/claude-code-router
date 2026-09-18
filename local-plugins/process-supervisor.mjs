/**
 * Runs external processes for as long as CCR runs.
 *
 * CCR supervises exactly one child of its own, the vendored gateway, and its MCP
 * children are MCP servers rather than arbitrary processes. Nothing here owned a
 * plain daemon, so a vector store or a memory server had to be started by hand
 * and was still running after `ccr stop`.
 *
 * This is a plugin rather than a patch to the gateway because the plugin
 * lifecycle already draws the distinction that matters: `onStop` is told whether
 * CCR is stopping, reloading its config, or disabling the plugin, and a
 * hand-rolled list bolted onto shutdown would have got the reload case wrong.
 *
 * Settings live under the plugin's own `config` key:
 *
 *   {
 *     "id": "process-supervisor",
 *     "module": "/home/you/Projects/claude-code-router/local-plugins/process-supervisor.mjs",
 *     "permissions": ["trusted-code"],
 *     "config": {
 *       "processes": [
 *         {
 *           "name": "qdrant",
 *           "command": "/home/you/.local/bin/qdrant",
 *           "args": [],
 *           "env": { "QDRANT__SERVICE__HOST": "127.0.0.1" },
 *           "cwd": "/home/you/.local/share/qdrant",
 *           "readyUrl": "http://127.0.0.1:6333/healthz",
 *           "readyTimeoutMs": 30000,
 *           "stopTimeoutMs": 20000,
 *           "force": false
 *         }
 *       ]
 *     }
 *   }
 *
 * Processes start in order and each waits for its own `readyUrl` before the next
 * begins, because a memory server that starts before its store logs a connection
 * failure and then serves nothing.
 */

import { spawn } from "node:child_process";

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 20_000;
const READY_POLL_INTERVAL_MS = 250;

/**
 * A process CCR did not start is left alone. An orphan from a previous CCR that
 * was killed rather than stopped still holds the port, and starting a second
 * copy would either fail to bind or, worse for a single-writer store, corrupt
 * what the first one is doing.
 */
async function alreadyServing(readyUrl) {
  if (!readyUrl) {
    return false;
  }
  try {
    const response = await fetch(readyUrl, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(spec, child, logger) {
  if (!spec.readyUrl) {
    return;
  }
  const deadline = Date.now() + (spec.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `${spec.name} exited with code ${child.exitCode ?? child.signalCode} before it became ready`
      );
    }
    if (await alreadyServing(spec.readyUrl)) {
      logger?.info?.(`[process-supervisor] ${spec.name} is ready`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`${spec.name} did not answer ${spec.readyUrl} within its readiness timeout`);
}

function startProcess(spec, logger) {
  const child = spawn(spec.command, spec.args ?? [], {
    cwd: spec.cwd,
    env: { ...process.env, ...(spec.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  // Without this the daemon's own diagnostics vanish, and the first sign of
  // trouble becomes a readiness timeout that says nothing about the cause.
  child.stdout?.on("data", (chunk) => logger?.info?.(`[${spec.name}] ${String(chunk).trimEnd()}`));
  child.stderr?.on("data", (chunk) => logger?.warn?.(`[${spec.name}] ${String(chunk).trimEnd()}`));
  child.on("error", (error) => logger?.error?.(`[${spec.name}] failed to spawn: ${error.message}`));
  return child;
}

/**
 * SIGTERM, then wait. Escalation to SIGKILL is opt-in per process, because the
 * processes this exists to run include a datastore, and killing one mid-write
 * trades a slow shutdown for a corrupt store. A process that will not leave is
 * reported rather than shot.
 */
async function stopProcess(entry, logger) {
  const { spec, child } = entry;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");

  const timeoutMs = spec.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const outcome = await Promise.race([exited.then(() => "exited"), timedOut]);
  clearTimeout(timer);

  if (outcome === "exited") {
    logger?.info?.(`[process-supervisor] ${spec.name} stopped`);
    return;
  }
  if (spec.force) {
    logger?.warn?.(`[process-supervisor] ${spec.name} ignored SIGTERM for ${timeoutMs}ms; sending SIGKILL`);
    child.kill("SIGKILL");
    await exited;
    return;
  }
  logger?.error?.(
    `[process-supervisor] ${spec.name} ignored SIGTERM for ${timeoutMs}ms and is still running. ` +
      `It was not killed, because "force" is not set for it. Stop it by hand, or set "force": true ` +
      `if losing its in-flight work is acceptable.`
  );
}

export async function setup(context) {
  // `context.pluginConfig` is already the plugin's own `config` value, not the
  // whole plugin entry: the host passes `pluginConfig.config` through. Reading
  // `.config` off it again finds nothing and starts nothing, silently.
  const settings = context?.pluginConfig ?? {};
  const specs = Array.isArray(settings.processes) ? settings.processes : [];
  const logger = context?.logger;
  const started = [];

  for (const spec of specs) {
    if (spec.enabled === false) {
      continue;
    }
    if (!spec.name || !spec.command) {
      logger?.warn?.(`[process-supervisor] skipping an entry with no name or command`);
      continue;
    }
    if (await alreadyServing(spec.readyUrl)) {
      logger?.info?.(
        `[process-supervisor] ${spec.name} is already answering ${spec.readyUrl}; leaving it alone`
      );
      continue;
    }

    const child = startProcess(spec, logger);
    // The pid is logged because a process this plugin declines to kill, and any
    // orphan left by a CCR that was killed rather than stopped, has to be found
    // by hand afterwards.
    logger?.info?.(`[process-supervisor] started ${spec.name} (pid ${child.pid})`);
    started.push({ spec, child });
    try {
      await waitUntilReady(spec, child, logger);
    } catch (error) {
      // Everything started so far is stopped, rather than left running behind a
      // failed startup where nothing owns it.
      logger?.error?.(`[process-supervisor] ${error.message}`);
      for (const entry of [...started].reverse()) {
        await stopProcess(entry, logger);
      }
      throw error;
    }
  }

  return {
    onStop: async (event) => {
      logger?.info?.(
        `[process-supervisor] stopping ${started.length} process(es) (reason: ${event?.reason ?? "stop"})`
      );
      for (const entry of [...started].reverse()) {
        await stopProcess(entry, logger);
      }
      started.length = 0;
    }
  };
}

export default setup;

import electron from "electron";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const testsOutDir = path.join(projectRoot, ".test-dist");
const testProjects = {
  architecture: { runtime: "node" },
  cli: { runtime: "node" },
  core: { runtime: "node-with-electron-fallback" },
  electron: { runtime: "electron" },
  ui: { runtime: "node" }
};
const requestedProjects = process.argv.slice(2);
const projects = requestedProjects.length === 0 ? Object.keys(testProjects) : requestedProjects;

for (const project of projects) {
  if (!testProjects[project]) {
    throw new Error(`Unknown test project: ${project}`);
  }
}

for (const project of projects) {
  await runProject(project);
}

async function runProject(project) {
  const testFiles = findCompiledTests(path.join(testsOutDir, project, "test"));
  if (testFiles.length === 0) {
    console.log(`No ${project} tests found.`);
    return;
  }

  const testHome = mkdtempSync(path.join(os.tmpdir(), `ccr-${project}-test-home-`));
  const runtime = resolveRuntime(testProjects[project].runtime);
  const executable = runtime === "electron" ? electron : process.execPath;
  console.log(`\nRunning ${project} tests with ${runtime}...`);

  try {
    await new Promise((resolve, reject) => {
      const childEnv = {
        ...process.env,
        CCR_INTERNAL_APP_DATA_DIR: path.join(testHome, "app-data"),
        CCR_INTERNAL_HOME_DIR: testHome,
        CCR_INTERNAL_USER_DATA_DIR: path.join(testHome, "user-data"),
        HOME: testHome,
        ...(runtime === "electron" ? { ELECTRON_RUN_AS_NODE: "1" } : {})
      };
      // Variables that point at real stores or paths override any home-derived
      // location, so inheriting them lets a test reach the live profile (a
      // credential read) or emit paths outside the throwaway home (argv
      // assertions). Delete rather than set undefined: spawn does not reliably
      // skip an undefined value.
      for (const name of [
        "CLAUDE_CONFIG_DIR",
        "CLAUDE_SECURESTORAGE_CONFIG_DIR",
        "CLAUDE_CODE_CUSTOM_OAUTH_URL",
        "CCR_CLAUDE_CODE_MCP_CONFIG",
        "CODEXL_CLAUDE_CODE_MCP_CONFIG"
      ]) {
        delete childEnv[name];
      }
      const child = spawn(executable, ["--test", ...testFiles], {
        cwd: projectRoot,
        env: childEnv,
        stdio: "inherit"
      });

      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (signal) {
          reject(new Error(`${project} tests exited from signal ${signal}`));
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${project} tests exited with code ${code ?? 1}`));
      });
    });
  } finally {
    rmSync(testHome, { force: true, recursive: true });
  }
}

function resolveRuntime(runtime) {
  if (runtime !== "node-with-electron-fallback") {
    return runtime;
  }
  const abi = nativeModuleAbi("better-sqlite3");
  if (abi !== undefined) {
    const current = Number(process.versions.modules);
    if (abi === current) {
      return "node";
    }
    console.warn(`[tests] better-sqlite3 is built for Node ABI ${abi} and this Node is ${current}; running under Electron.`);
    return "electron";
  }

  // The module could not be read, so fall back to loading it. Keep stderr: a
  // missing or broken install is not an ABI mismatch and should say so rather
  // than quietly redirecting the whole suite to another runtime.
  const probe = spawnSync(process.execPath, [
    "-e",
    "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();"
  ], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  if (probe.status !== 0) {
    const reason = (probe.stderr ?? "").trim().split("\n")[0];
    console.warn(`[tests] better-sqlite3 could not be loaded under Node, running under Electron. ${reason}`);
  }
  return probe.status === 0 ? "node" : "electron";
}

/**
 * The Node ABI a compiled addon was built for, or undefined when it cannot be
 * read. Every addon exports `node_register_module_v<abi>`, so the number can be
 * taken from the file without loading it, which is the very thing we are trying
 * to establish is safe. A scan rather than a symbol-table parse, so one code
 * path covers ELF, Mach-O and PE.
 */
function nativeModuleAbi(moduleName) {
  let modulePath;
  try {
    modulePath = createRequire(import.meta.url).resolve(moduleName);
  } catch {
    return undefined;
  }
  const binary = path.join(path.dirname(modulePath), "build", "Release", `${moduleName.replace(/[^a-z0-9]+/gi, "_")}.node`);
  const candidates = [binary, path.join(path.dirname(modulePath), "..", "build", "Release", "better_sqlite3.node")];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      const found = /node_register_module_v(\d+)/.exec(readFileSync(candidate).toString("latin1"));
      if (found) {
        return Number(found[1]);
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function findCompiledTests(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return findCompiledTests(file);
    }
    return entry.isFile() && entry.name.endsWith(".test.js") ? [file] : [];
  }).sort();
}

// Snapshot the parts of the CCR config that decide behaviour, and report what
// moved since the last snapshot.
//
// A config write replaces the whole stored blob, so a caller holding a stale
// copy reverts every change made since it read. The service log now names the
// top-level key each write moves, but a key is coarse: "Providers changed" does
// not say which provider lost which capability. This says exactly that.
//
//   node scripts/config-audit.mjs            diff against the saved baseline
//   node scripts/config-audit.mjs --save     accept the current config as correct
//   node scripts/config-audit.mjs --show     print the snapshot without diffing
//
// Exits non-zero when the config has drifted, so it can gate a restart or run
// from a timer. Secrets are reduced to their length and never stored.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const configDir = process.env.CCR_INTERNAL_HOME_DIR ?? path.join(homedir(), ".claude-code-router");
const configFile = process.env.CCR_CONFIG_DB ?? path.join(configDir, "config.sqlite");
const baselineFile = process.env.CCR_CONFIG_BASELINE ?? path.join(configDir, "config-baseline.json");

if (!existsSync(configFile)) {
  console.error(`No config database at ${configFile}`);
  process.exit(2);
}

const db = new DatabaseSync(configFile, { readOnly: true });
const row = db.prepare("SELECT value_json FROM app_config WHERE key = 'default'").get();
if (!row) {
  console.error("No 'default' config row.");
  process.exit(2);
}
const config = JSON.parse(row.value_json);

// A credential's value never enters the snapshot. Its length is enough to catch
// a key being cleared or replaced, which is the failure that matters here.
const secretLength = (value) => (typeof value === "string" && value ? `len:${value.length}` : "absent");

function snapshot(source) {
  const providers = {};
  for (const provider of source.Providers ?? []) {
    providers[provider.name] = {
      apiKey: secretLength(provider.api_key ?? provider.apiKey),
      capabilities: (provider.capabilities ?? [])
        .map((capability) => (typeof capability === "string" ? capability : capability.type))
        .sort(),
      enabled: provider.enabled !== false,
      modelCount: (provider.models ?? []).length,
      protocolDetectionMode: provider.protocolDetectionMode ?? "(unset)"
    };
  }

  const rules = {};
  for (const profile of source.profile?.profiles ?? []) {
    for (const rule of profile.routing?.rules ?? []) {
      rules[`${profile.name ?? profile.id}/${rule.id}`] = {
        chain: rule.fallback?.models ?? [],
        condition: rule.condition ?? null,
        enabled: rule.enabled !== false,
        rewrite: rule.rewrite?.value ?? null
      };
    }
  }

  const agentModels = {};
  for (const profile of source.profile?.profiles ?? []) {
    agentModels[profile.name ?? profile.id] = {
      fable: profile.fableModel ?? null,
      haiku: profile.haikuModel ?? null,
      model: profile.model ?? null,
      opus: profile.opusModel ?? null,
      smallFast: profile.smallFastModel ?? null,
      sonnet: profile.sonnetModel ?? null
    };
  }
  // The legacy global block is not editable in the current UI, which renders
  // profile.profiles only. Its stale model set is harmless while it is
  // disabled, so its state is recorded with that flag rather than alongside
  // the models that are actually in use.
  agentModels["(legacy claudeCode block)"] = {
    ENABLED: source.profile?.claudeCode?.enabled === true,
    fable: source.profile?.claudeCode?.fableModel ?? null,
    haiku: source.profile?.claudeCode?.haikuModel ?? null,
    opus: source.profile?.claudeCode?.opusModel ?? null,
    sonnet: source.profile?.claudeCode?.sonnetModel ?? null
  };

  return {
    agentModels,
    defaultFallback: source.Router?.fallback ?? null,
    plugins: Object.fromEntries((source.plugins ?? []).map((plugin) => [plugin.id, {
      coreGateway: (plugin.coreGateway?.plugins ?? []).map((entry) => `${entry.key}:${entry.enabled !== false}`),
      enabled: plugin.enabled !== false,
      module: plugin.module ?? null
    }])),
    providers,
    rules
  };
}

// Compared as sorted JSON so that key order, which no consumer depends on, is
// never reported as drift.
function flatten(value, prefix, into) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) flatten(value[key], prefix ? `${prefix}.${key}` : key, into);
    return into;
  }
  into.set(prefix, JSON.stringify(value));
  return into;
}

const current = snapshot(config);

if (process.argv.includes("--show")) {
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

if (process.argv.includes("--save")) {
  mkdirSync(path.dirname(baselineFile), { recursive: true });
  writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Baseline saved to ${baselineFile}`);
  process.exit(0);
}

if (!existsSync(baselineFile)) {
  console.error(`No baseline at ${baselineFile}. Run with --save once the config is correct.`);
  process.exit(2);
}

const baseline = flatten(JSON.parse(readFileSync(baselineFile, "utf8")), "", new Map());
const now = flatten(current, "", new Map());
const drift = [];
for (const key of new Set([...baseline.keys(), ...now.keys()])) {
  const was = baseline.get(key);
  const is = now.get(key);
  if (was !== is) drift.push({ is: is ?? "(removed)", key, was: was ?? "(added)" });
}

if (drift.length === 0) {
  console.log(`Config matches the baseline (${now.size} values checked).`);
  process.exit(0);
}

console.log(`${drift.length} value(s) drifted from the baseline:\n`);
for (const entry of drift.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`  ${entry.key}`);
  console.log(`    baseline: ${entry.was}`);
  console.log(`    now     : ${entry.is}`);
}
process.exit(1);

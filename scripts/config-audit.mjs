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
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const configDir = process.env.CCR_INTERNAL_HOME_DIR ?? path.join(homedir(), ".claude-code-router");
const configFile = process.env.CCR_CONFIG_DB ?? path.join(configDir, "config.sqlite");
const baselineFile = process.env.CCR_CONFIG_BASELINE ?? path.join(configDir, "config-baseline.json");

function loadConfig() {
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
  return JSON.parse(row.value_json);
}

// A credential's value never enters the snapshot. Its length is enough to catch
// a key being cleared or replaced, which is the failure that matters here.
export const secretLength = (value) => (typeof value === "string" && value ? `len:${value.length}` : "absent");

export function snapshot(source) {
  const providers = {};
  for (const provider of source.Providers ?? []) {
    providers[provider.name] = {
      apiKey: secretLength(provider.api_key ?? provider.apiKey),
      // The provider-level base url decides where a request goes when no
      // capability overrides it, and a malformed one is answered by the host
      // before any credential is read, so it has to be watched separately.
      baseUrl: provider.api_base_url ?? provider.apiBaseUrl ?? "(unset)",
      // Type and base URL together. A capability pointed at the wrong URL is
      // still the right type, so recording the type alone reports no drift
      // while the provider is unreachable.
      capabilities: (provider.capabilities ?? [])
        .map((capability) => (typeof capability === "string"
          ? capability
          : `${capability.type}@${capability.baseUrl ?? "(no base url)"}`))
        .sort(),
      enabled: provider.enabled !== false,
      modelCount: (provider.models ?? []).length,
      // Usage tracking is config like any other and silently reverts with it.
      // Record the endpoints rather than a count, so a connector repointed at a
      // path carrying no consumption reports drift instead of looking unchanged.
      usageConnectors: provider.account?.enabled === true
        ? (provider.account.connectors ?? [])
          .map((connector) => connector.endpoint ?? connector.type ?? "(unnamed)")
          .sort()
        : [],
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
export function flatten(value, prefix, into) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) flatten(value[key], prefix ? `${prefix}.${key}` : key, into);
    return into;
  }
  into.set(prefix, JSON.stringify(value));
  return into;
}

// Importing this file must not read the config or exit the process: the test
// imports it for snapshot and flatten, which are pure.
/**
 * Chain entries that can never answer, because the provider or the model they
 * name is not in the configuration.
 *
 * Drift against a baseline cannot see this. Removing a provider is a
 * deliberate change that the baseline is re-taken for, while the chain entries
 * pointing at it stay behind and read as ordinary entries. The same is true of
 * a model withdrawn from a provider's list. Both spend a chain position on a
 * request that cannot succeed.
 *
 * An entry is `Provider name/model id`, and a provider name may itself contain
 * a slash, so the provider is matched by longest configured prefix rather than
 * by splitting on the first separator.
 */
export function danglingChainEntries(source) {
  const models = new Map((source.Providers ?? [])
    .filter((provider) => provider.enabled !== false)
    .map((provider) => [provider.name, new Set(provider.models ?? [])]));
  const names = [...models.keys()].sort((a, b) => b.length - a.length);
  const dangling = [];
  for (const profile of source.profile?.profiles ?? []) {
    for (const rule of profile.routing?.rules ?? []) {
      for (const entry of rule.fallback?.models ?? []) {
        const text = String(entry);
        const provider = names.find((name) => text.startsWith(`${name}/`));
        if (!provider) dangling.push({ entry: text, reason: "no such provider", rule: rule.id });
        else if (!models.get(provider).has(text.slice(provider.length + 1))) {
          dangling.push({ entry: text, reason: "provider does not carry this model", rule: rule.id });
        }
      }
    }
  }
  return dangling;
}

function main() {
  const config = loadConfig();
    const current = snapshot(config);

  if (process.argv.includes("--show")) {
    console.log(JSON.stringify(current, null, 2));
    process.exit(0);
  }

  if (process.argv.includes("--save")) {
    mkdirSync(path.dirname(baselineFile), { recursive: true });
    // Owner-only, beside a config database that is already 0600. The baseline
    // holds no credential, because every secret is reduced to its length, but
    // it does name every provider, base url, capability endpoint, usage
    // connector and plugin module path.
    writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    // The mode argument applies on creation only, so a baseline written before
    // this existed keeps whatever it had. Setting it every time is what makes
    // the guarantee true rather than true for new installs.
    chmodSync(baselineFile, 0o600);
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

  // Reported whether or not anything drifted: a dangling entry is wrong on its
  // own terms, and re-taking the baseline after a deliberate removal would
  // otherwise bless it permanently.
  const dangling = danglingChainEntries(config);
  for (const entry of dangling) console.log(`DANGLING   ${entry.rule}: ${entry.entry} (${entry.reason})`);

  if (drift.length === 0) {
    console.log(`Config matches the baseline (${now.size} values checked)`
      + `, ${dangling.length} chain entry(ies) naming a provider or model that is not configured.`);
    process.exit(dangling.length > 0 ? 1 : 0);
  }

  console.log(`${drift.length} value(s) drifted from the baseline:\n`);
  for (const entry of drift.sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`  ${entry.key}`);
    console.log(`    baseline: ${entry.was}`);
    console.log(`    now     : ${entry.is}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}

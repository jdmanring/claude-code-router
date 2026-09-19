#!/usr/bin/env node
// How much of each provider's allowance is left?
//
// Reads the account snapshots CCR already builds, so it evaluates the usage
// connectors the same way the UI does rather than reimplementing them. It
// spends no inference quota: every call is to a provider's usage endpoint.
//
// This is the reading to take BEFORE a sweep. A provider whose quota reports
// spent will answer 429 to every probe, and the probe costs a request to learn
// what the meter says for nothing.
//
//   node scripts/provider-allowance.mjs [provider name ...]
//     --json PATH   write the full result
//
// The snapshot logic lives in core, which uses path aliases only the build
// resolves, so this bundles one re-export on first use into node_modules/.cache
// and reuses it after. Set CCR_ACCOUNT_API to point at an existing bundle
// instead.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function accountApiBundle() {
  const configured = process.env.CCR_ACCOUNT_API;
  if (configured) return path.resolve(configured);
  const cache = path.join(repoRoot, "node_modules", ".cache");
  const bundle = path.join(cache, "ccr-account-api.cjs");
  const source = path.join(repoRoot, "packages", "core", "src", "providers", "account-service.ts");
  // Rebuilt whenever the source is newer, so a stale bundle cannot answer for
  // a changed implementation.
  if (fs.existsSync(bundle) && fs.statSync(bundle).mtimeMs >= fs.statSync(source).mtimeMs) return bundle;
  fs.mkdirSync(cache, { recursive: true });
  const entry = path.join(cache, "ccr-account-entry.ts");
  fs.writeFileSync(entry, 'export { getProviderAccountSnapshots } from "@ccr/core/providers/account-service";\n');
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "esbuild"), [
    entry, "--bundle", "--platform=node", "--format=cjs", `--outfile=${bundle}`,
    "--external:better-sqlite3", "--external:electron", "--log-level=error",
    `--alias:@ccr/core=${path.join(repoRoot, "packages", "core", "src")}`
  ], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
  return bundle;
}

/**
 * What a meter says about the allowance behind it.
 *
 * The distinction that matters is between spent and unreadable, because both
 * present as zero. A connector wired to an endpoint carrying no consumption
 * figure reports remaining 0 and used 0 and looks exhausted; an account that
 * really is exhausted has spent something. Treating the first as spent would
 * retire a working provider, so it reads as "no reading" instead.
 */
export function meterHealth(meter) {
  const remaining = Number(meter?.remaining);
  const limit = Number(meter?.limit);
  const used = Number(meter?.used);
  if (!Number.isFinite(remaining)) return "no reading";
  if (Number.isFinite(limit) && limit > 0) {
    const left = remaining / limit;
    if (left <= 0) return "spent";
    return left < 0.1 ? "low" : "ok";
  }
  if (remaining > 0) return "ok";
  // Zero or negative with no limit to scale it against.
  return Number.isFinite(used) && used > 0 ? "spent" : "no reading";
}

// "no reading" sorts last on purpose. A provider reporting one unreadable
// meter beside a good one is not unknown, it is fine: OpenRouter publishes a
// credits meter that resolves to undefined alongside a balance meter holding
// 19.79 of 20, and ranking the unreadable one first reported the account as
// unknown while it had almost all of its allowance.
const RANK = { spent: 0, low: 1, ok: 2, "no reading": 3 };

/**
 * The meter that decides the provider: the most constraining one it reports
 * that can be read at all, and an unreadable one only when nothing else is.
 */
export function bindingMeter(meters) {
  if (!Array.isArray(meters) || meters.length === 0) return undefined;
  return [...meters].sort((a, b) => RANK[meterHealth(a)] - RANK[meterHealth(b)])[0];
}

export function formatMeter(meter) {
  if (!meter) return "no meter";
  const unit = meter.unit && meter.unit !== "-" ? ` ${meter.unit}` : "";
  const limit = Number.isFinite(Number(meter.limit)) ? ` of ${meter.limit}` : "";
  return `${meter.label ?? meter.kind}: ${meter.remaining}${limit}${unit} left`;
}

async function main() {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf("--json");
  const out = outIndex === -1 ? undefined : argv[outIndex + 1];
  const only = argv.filter((value, index) => !value.startsWith("--") && argv[index - 1] !== "--json");

  const { getProviderAccountSnapshots } = await import(accountApiBundle());
  const snapshots = (await getProviderAccountSnapshots())
    .filter((snapshot) => only.length === 0 || only.includes(snapshot.provider));

  const rows = snapshots.map((snapshot) => {
    const meter = bindingMeter(snapshot.meters);
    return { health: meter ? meterHealth(meter) : "no meter", meter, snapshot };
  }).sort((a, b) => (RANK[a.health] ?? 9) - (RANK[b.health] ?? 9) || a.snapshot.provider.localeCompare(b.snapshot.provider));

  for (const row of rows) {
    console.log(`${row.health.padEnd(11)} ${row.snapshot.provider.padEnd(32)} ${formatMeter(row.meter)}`
      + (row.snapshot.status !== "ok" ? `  [${row.snapshot.status}]` : ""));
  }

  const count = (health) => rows.filter((row) => row.health === health).length;
  console.log(`\n${rows.length} provider(s) report usage: ${count("spent")} spent, ${count("low")} under a tenth left, `
    + `${count("ok")} with room, ${count("no reading") + count("no meter")} whose meter says nothing usable.`);
  console.log("A provider reporting spent will answer 429 to a probe. Read this before a sweep, not after.");
  if (out) fs.writeFileSync(out, JSON.stringify(rows.map((r) => ({ health: r.health, ...r.snapshot })), null, 1));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

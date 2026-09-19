#!/usr/bin/env node
// Which configured model ids does each provider still publish?
//
// A withdrawn model is invisible until something routes to it, and then it
// reads as the provider being down: one 404 on a lead model sinks a whole
// chain. This asks each provider for its own catalogue and diffs the
// configured ids against it. One GET per provider, no inference, no quota
// spent, so it is safe to run when a sweep is not.
//
//   node scripts/model-catalog-audit.mjs [provider name ...]
//     --json PATH   write the full result
//
// Two readings this tool does NOT make. A provider whose catalogue cannot be
// read is unknown, not failing. And an id the catalogue omits is "not listed",
// not "withdrawn": Z.ai serves `glm-4.7-flash` with a 200 while publishing
// neither that id nor any alias of it, so an omission is a lead to check, not
// a licence to delete a working model.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const OUT = flag("--json");
const only = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--json");

const configPath = path.join(os.homedir(), ".claude-code-router", "config.sqlite");
const config = JSON.parse(new DatabaseSync(configPath, { readOnly: true })
  .prepare("select value_json from app_config where key='default'").get().value_json);

// Providers name their catalogue differently; these are the two shapes seen
// across this install. Anything else reads as unknown.
export function catalogueIds(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
    : Array.isArray(payload) ? payload
    : undefined;
  if (!rows) return undefined;
  const ids = rows
    .map((row) => (typeof row === "string" ? row : row?.id ?? row?.name ?? row?.model))
    .filter((id) => typeof id === "string" && id.length > 0);
  return ids.length > 0 ? ids : undefined;
}

// The gateway drops a leading segment that repeats the protocol family, and
// some providers list an id the configured form abbreviates. Compare on the
// last segment too rather than reporting a naming difference as a withdrawal.
export function isPublished(configured, published) {
  if (published.has(configured)) return true;
  const tail = configured.split("/").pop();
  return published.has(tail) || [...published].some((id) => id.split("/").pop() === tail);
}

async function catalogue(provider) {
  const base = String(provider.api_base_url ?? "").replace(/\/+$/, "");
  if (!base) return { error: "no base url" };
  const key = String(provider.api_key ?? "");
  const headers = { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
  try {
    const r = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    if (!r.ok) return { error: `HTTP ${r.status}` };
    let payload;
    try { payload = JSON.parse(text); } catch { return { error: "not json" }; }
    const ids = catalogueIds(payload);
    return ids ? { ids } : { error: "no model list in body" };
  } catch (e) { return { error: String(e?.message ?? e).slice(0, 40) }; }
}

// Importing this file must not query every provider; the test imports it for
// the two pure helpers.
async function main() {
  const providers = (config.Providers ?? [])
    .filter((p) => p.enabled !== false && (p.models ?? []).length > 0)
    .filter((p) => only.length === 0 || only.includes(p.name));

  const results = [];
  for (const provider of providers) {
    const read = await catalogue(provider);
    if (read.error) {
      results.push({ name: provider.name, status: "unknown", detail: read.error, missing: [] });
      console.log(`?    ${provider.name.padEnd(34)} catalogue unreadable: ${read.error}`);
      continue;
    }
    const published = new Set(read.ids);
    const missing = (provider.models ?? []).filter((m) => !isPublished(m, published));
    results.push({ name: provider.name, status: missing.length === 0 ? "ok" : "stale",
      catalogueSize: read.ids.length, configured: (provider.models ?? []).length, missing });
    const label = missing.length === 0 ? "OK  " : "STALE";
    console.log(`${label} ${provider.name.padEnd(34)} ${String((provider.models ?? []).length).padStart(3)} configured, `
      + `${String(read.ids.length).padStart(4)} published`
      + (missing.length > 0 ? `, not listed: ${missing.join(" ")}` : ""));
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const stale = results.filter((r) => r.status === "stale");
  const unknown = results.filter((r) => r.status === "unknown");
  console.log(`\n${results.length} providers: ${results.length - stale.length - unknown.length} clean, `
    + `${stale.length} carrying unlisted ids, ${unknown.length} whose catalogue could not be read`);
  if (stale.length > 0) console.log(`unlisted ids total (check each before removing it): ${stale.reduce((n, r) => n + r.missing.length, 0)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

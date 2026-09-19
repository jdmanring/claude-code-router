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
function catalogueArray(payload) {
  return Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
    : Array.isArray(payload) ? payload
    : undefined;
}

export function catalogueIds(payload) {
  const rows = catalogueArray(payload);
  if (!rows) return undefined;
  const ids = rows
    .map((row) => (typeof row === "string" ? row : row?.id ?? row?.name ?? row?.model))
    .filter((id) => typeof id === "string" && id.length > 0);
  return ids.length > 0 ? ids : undefined;
}

/**
 * The same rows, kept as objects, so the catalogue's own type information
 * survives. `catalogueIds` reduces them to strings and loses it.
 */
export function catalogueRows(payload) {
  const rows = catalogueArray(payload);
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : undefined;
}

/**
 * Whether a catalogue entry says the model can answer a chat completion.
 *
 * Returns "not-text" ONLY when the catalogue declares it, never by inference
 * from the id. A model wrongly called non-chat gets deleted from a working
 * configuration, so an entry that says nothing must read "unknown" and stay
 * silent. An embedding, rerank, moderation, transcription or image model
 * configured as a chat model can only ever error, which is how SEA-LION came
 * to carry `BAAI/bge-m3`: it sits in the same `/models` response as the chat
 * models, and whoever configured the provider took the list.
 */
export function chatCapability(row) {
  const outputs = row?.architecture?.output_modalities;
  if (Array.isArray(outputs) && outputs.length > 0) {
    return outputs.some((mode) => String(mode).toLowerCase() === "text") ? "text" : "not-text";
  }
  const modality = row?.architecture?.modality;
  if (typeof modality === "string" && modality.includes("->")) {
    const produced = modality.split("->").pop();
    return produced.toLowerCase().split("+").includes("text") ? "text" : "not-text";
  }
  // Several catalogues carry a bare type instead. Only the families that
  // cannot produce a chat completion at all are named.
  const declared = String(row?.type ?? row?.object ?? row?.task ?? "").toLowerCase();
  if (/^(embedding|embeddings|rerank|reranker|moderation|image|video|audio|speech|tts|transcription)$/.test(declared)) {
    return "not-text";
  }
  return "unknown";
}

// The gateway drops a leading segment that repeats the protocol family, and
// some providers list an id the configured form abbreviates. Compare on the
// last segment too rather than reporting a naming difference as a withdrawal.
function publishedTails(published) {
  return new Set([...published].map((id) => id.split("/").pop()));
}

export function isPublished(configured, published, tails = publishedTails(published)) {
  if (published.has(configured)) return true;
  return tails.has(configured.split("/").pop());
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
    return ids ? { ids, rows: catalogueRows(payload) ?? [] } : { error: "no model list in body" };
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
    const tails = publishedTails(published);
    const missing = (provider.models ?? []).filter((m) => !isPublished(m, published, tails));
    const byId = new Map();
    for (const row of read.rows ?? []) {
      const id = row?.id ?? row?.name ?? row?.model;
      if (typeof id === "string") byId.set(id, row);
    }
    const nonChat = (provider.models ?? []).filter((m) => {
      const row = byId.get(m) ?? [...byId.values()].find((r) => String(r.id ?? "").split("/").pop() === m.split("/").pop());
      return row !== undefined && chatCapability(row) === "not-text";
    });
    results.push({ name: provider.name, status: missing.length === 0 ? "ok" : "stale",
      catalogueSize: read.ids.length, configured: (provider.models ?? []).length, missing, nonChat });
    for (const id of nonChat) console.log(`NOT CHAT ${provider.name.padEnd(30)} ${id} cannot produce a chat completion`);
    const label = missing.length === 0 ? "OK  " : "STALE";
    console.log(`${label} ${provider.name.padEnd(34)} ${String((provider.models ?? []).length).padStart(3)} configured, `
      + `${String(read.ids.length).padStart(4)} published`
      + (missing.length > 0 ? `, not listed: ${missing.join(" ")}` : ""));
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const stale = results.filter((r) => r.status === "stale");
  const unknown = results.filter((r) => r.status === "unknown");
  const nonChatTotal = results.reduce((n, r) => n + (r.nonChat?.length ?? 0), 0);
  console.log(`\n${results.length} providers: ${results.length - stale.length - unknown.length} clean, `
    + `${stale.length} carrying unlisted ids, ${unknown.length} whose catalogue could not be read, `
    + `${nonChatTotal} configured model(s) the catalogue says cannot answer a chat completion`);
  if (nonChatTotal > 0) process.exitCode = 1;
  if (stale.length > 0) console.log(`unlisted ids total (check each before removing it): ${stale.reduce((n, r) => n + r.missing.length, 0)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

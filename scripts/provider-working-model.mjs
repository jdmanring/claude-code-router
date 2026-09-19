#!/usr/bin/env node
// Does each provider have at least one configured model that actually answers?
//
// The sweep judges a provider on models[0] through CCR, and the catalogue audit
// only asks what the provider publishes. Neither answers the question that
// decides whether a provider is usable at all: is there ANY configured model
// that returns real output. This calls each one directly, provider by provider,
// and stops at the first that works.
//
//   node scripts/provider-working-model.mjs [provider name ...]
//     --all         keep going after the first working model
//     --json PATH   write the full result
//
// It spends inference, so it is the one instrument here that must not run
// beside a sweep.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const OUT = flag("--json");
const ALL = argv.includes("--all");
const only = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--json");

/**
 * A 2xx is not enough: a provider can decline inside one by answering with a
 * message and no output, which is how an unfunded relay refuses. Real output is
 * the only thing that proves a model is usable.
 */
export function readsAsWorking(status, payload) {
  if (!(status >= 200 && status < 300)) return false;
  const usage = payload?.usage ?? {};
  const out = usage.completion_tokens ?? usage.output_tokens;
  if (typeof out === "number") return out > 0;
  // No usage block: fall back to whether any text came back.
  const text = payload?.choices?.[0]?.message?.content ?? payload?.content?.[0]?.text;
  return typeof text === "string" && text.trim().length > 0;
}

export function refusalReason(status, payload, body) {
  const error = payload?.error;
  const message = (typeof error === "string" ? error : error?.message)
    ?? payload?.message
    ?? (typeof body === "string" ? body.slice(0, 120) : "");
  return `${status} ${String(message).replace(/\s+/g, " ").slice(0, 96)}`.trim();
}

async function callModel(provider, model) {
  const base = String(provider.api_base_url ?? "").replace(/\/+$/, "");
  const key = String(provider.api_key ?? "");
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      // At least 16: some providers reject a smaller budget and that
      // manufactures a failure that is not there.
      body: JSON.stringify({ max_tokens: 16, messages: [{ content: "hi", role: "user" }], model }),
      signal: AbortSignal.timeout(60_000)
    });
    const body = await r.text();
    let payload;
    try { payload = JSON.parse(body); } catch { payload = undefined; }
    return { ok: readsAsWorking(r.status, payload), reason: refusalReason(r.status, payload, body), status: r.status };
  } catch (e) {
    return { ok: false, reason: `transport ${String(e?.message ?? e).slice(0, 60)}`, status: undefined };
  }
}

async function main() {
  const configPath = path.join(os.homedir(), ".claude-code-router", "config.sqlite");
  const config = JSON.parse(new DatabaseSync(configPath, { readOnly: true })
    .prepare("select value_json from app_config where key='default'").get().value_json);
  const providers = (config.Providers ?? [])
    .filter((p) => p.enabled !== false && (p.models ?? []).length > 0)
    .filter((p) => only.length === 0 || only.includes(p.name));

  const results = [];
  for (const provider of providers) {
    const tried = [];
    let working;
    for (const model of provider.models ?? []) {
      const attempt = await callModel(provider, model);
      tried.push({ model, ...attempt });
      if (attempt.ok) { working = model; if (!ALL) break; }
    }
    results.push({ name: provider.name, working, tried });
    if (working) {
      const position = (provider.models ?? []).indexOf(working);
      console.log(`OK    ${provider.name.padEnd(30)} ${working}${position > 0 ? `  (position ${position + 1}, not the lead)` : ""}`);
    } else {
      console.log(`NONE  ${provider.name.padEnd(30)} ${tried.length} model(s), none answered`);
      for (const t of tried.slice(0, 4)) console.log(`        ${t.model.slice(0, 40).padEnd(42)} ${t.reason}`);
    }
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const none = results.filter((r) => !r.working);
  const misordered = results.filter((r) => r.working && r.tried.findIndex((t) => t.model === r.working) > 0);
  console.log(`\n${results.length} providers: ${results.length - none.length} have a working model, ${none.length} have none`);
  if (misordered.length > 0) {
    console.log(`lead model does not work but a later one does: ${misordered.map((r) => r.name).join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

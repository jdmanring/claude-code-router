#!/usr/bin/env node
// Which configured providers does CCR actually reach, and why not.
//
// Judges each provider on its OWN chain attempt rather than on what the client
// finally received, because the chain hides a failure by succeeding elsewhere.
//
// A single failing pass is not evidence about a provider. 429, 502, 503, 504 and
// a transport error are retried with a widening delay; any other status is
// terminal and reported on the first reading. That separation is borrowed from
// the awesome-free-byok-models verifier, which is the thing this repository kept
// re-deriving by hand and getting wrong: six providers were called dead here on
// a reading that passed minutes later.
//
//   node scripts/provider-sweep.mjs [provider name ...]
//     --passes N   retry passes over retryable failures (default 3)
//     --json PATH  write the full result

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const MAX_PASSES = Number(flag("--passes", 3));
const OUT = flag("--json", undefined);
const only = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--passes" && argv[i - 1] !== "--json");

const home = process.env.CCR_INTERNAL_HOME_DIR ?? os.homedir();
const configPath = path.join(home, ".claude-code-router", "config.sqlite");
const logPath = path.join(home, ".claude-code-router", "app-data", "request-logs.sqlite");

const config = JSON.parse(new DatabaseSync(configPath, { readOnly: true })
  .prepare("select value_json from app_config where key='default'").get().value_json);
const key = String(new DatabaseSync(configPath, { readOnly: true })
  .prepare("select encrypted_key from api_keys where id='local-gateway'").get().encrypted_key);

const targets = (config.Providers ?? [])
  .filter((p) => p.enabled !== false && (p.models ?? []).length > 0)
  .filter((p) => only.length === 0 || only.includes(p.name))
  .map((p) => ({ model: p.models[0], name: p.name }));

const maxLogId = () => new DatabaseSync(logPath, { readOnly: true })
  .prepare("select max(id) m from request_logs").get().m;

// Retryable means the reading says nothing about the provider yet. Everything
// else is the provider's own answer and does not improve by asking again.
const RETRYABLE = new Set([429, 502, 503, 504]);

// True when the answer carries a reply but billed no output, which is how a
// relay declines without spending a status code on it. Unparseable or absent
// usage is not evidence either way and reads as output.
export function producedNoOutput(body) {
  try {
    const usage = JSON.parse(body)?.usage;
    return typeof usage?.output_tokens === "number" && usage.output_tokens === 0;
  } catch {
    return false;
  }
}

async function attempt(target) {
  const before = maxLogId();
  const started = Date.now();
  let client;
  let clientBody = "";
  try {
    const r = await fetch("http://127.0.0.1:3456/v1/messages", {
      method: "POST",
      headers: { "anthropic-version": "2023-06-01", "content-type": "application/json", "x-api-key": key },
      // At least 16: some providers reject a smaller budget outright, which
      // manufactures a failure that is not there.
      body: JSON.stringify({ max_tokens: 32, messages: [{ content: "hi", role: "user" }], model: `${target.name}/${target.model}` }),
      signal: AbortSignal.timeout(90_000)
    });
    client = `HTTP ${r.status}`;
    // A provider can decline inside a 200 by answering with a message and no
    // output tokens, which a status-only reading counts as working. AIHubMix
    // does exactly that to an unfunded account. Keep the body to tell them
    // apart.
    clientBody = await r.text();
  } catch (e) {
    return { client: `client-error`, ms: Date.now() - started, ok: false, retryable: true, status: String(e.message).slice(0, 40) };
  }
  await new Promise((r) => setTimeout(r, 1200));

  const row = new DatabaseSync(logPath, { readOnly: true }).prepare(
    `select t.trace_json from request_logs l
       left join request_route_traces t on t.request_log_id = l.id
      where l.id > ? order by l.id desc limit 1`).get(before);
  if (!row?.trace_json) {
    // Competing traffic took the newest-row slot; that is a measurement miss.
    return { client, ms: Date.now() - started, ok: false, retryable: true, status: "no log row" };
  }
  const first = (JSON.parse(row.trace_json).hops ?? [])
    .find((h) => h.name === "upstream.attempt.outcome" || h.name === "upstream.attempt.skipped");
  if (!first) return { client, ms: Date.now() - started, ok: false, retryable: true, status: "no attempt" };
  if (first.name === "upstream.attempt.skipped") {
    return { client, ms: Date.now() - started, ok: false, retryable: true, status: "skipped(cooling)" };
  }
  const code = first.outcome?.statusCode;
  let ok = code !== undefined && code >= 200 && code < 300;
  let status = code === undefined ? String(first.outcome?.fallbackReason ?? "?").slice(0, 34) : String(code);
  if (ok && producedNoOutput(clientBody)) {
    ok = false;
    status = "200 no output";
  }
  return {
    client, ms: Date.now() - started, ok,
    retryable: !ok && status !== "200 no output" && (code === undefined || RETRYABLE.has(code)),
    status
  };
}

// Importing this file must not run a sweep. The test imports it for
// producedNoOutput alone, and a module body that sends 56 requests on import
// is a trap for anything that reads it.
async function main() {
  const results = new Map();
  let queue = targets;
  for (let pass = 0; pass <= MAX_PASSES && queue.length > 0; pass++) {
    if (pass > 0) {
      const wait = Math.round(2000 * 1.5 ** pass);
      console.log(`\n  retry pass ${pass}: ${queue.length} provider(s), settling ${wait}ms first`);
      await new Promise((r) => setTimeout(r, wait));
    }
    const next = [];
    for (const target of queue) {
      const r = await attempt(target);
      results.set(target.name, { ...target, ...r, passes: pass + 1 });
      if (!r.ok && r.retryable && pass < MAX_PASSES) {
        next.push(target);
        if (pass === 0) console.log(`RETRY ${target.name.padEnd(34)} ${r.status}`);
        continue;
      }
      console.log(`${r.ok ? "OK   " : "FAIL "} ${target.name.padEnd(34)} ${String(r.status).padEnd(18)} ${target.model.slice(0, 40)}`);
    }
    queue = next;
  }

  const all = [...results.values()];
  const ok = all.filter((r) => r.ok);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  console.log(`\nreachable: ${ok.length}/${all.length}`);
  const recovered = all.filter((r) => r.ok && r.passes > 1);
  if (recovered.length > 0) {
    console.log(`recovered on retry (a single pass would have called these dead): ${recovered.map((r) => r.name).join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

// Summarize CCR request logs: which providers answer, which fail, and what the
// fallback chain actually did. Reads the SQLite log read-only.
//
//   node scripts/ccr-log.mjs                 last 50 requests
//   node scripts/ccr-log.mjs --since 6516    everything after a log id
//   node scripts/ccr-log.mjs --limit 200
//   node scripts/ccr-log.mjs --trace 6512    per-attempt trace for one request
//   node scripts/ccr-log.mjs --errors        distinct upstream error bodies
//   node scripts/ccr-log.mjs --agent-only    drop connectivity-check traffic
import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const dbPath = process.env.CCR_LOG_DB ?? path.join(
  process.env.CCR_INTERNAL_APP_DATA_DIR ?? path.join(homedir(), ".claude-code-router", "app-data"),
  "request-logs.sqlite"
);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name) => process.argv.includes(name);

if (!existsSync(dbPath)) {
  console.error(`No request log at ${dbPath}. Set CCR_LOG_DB to point at one.`);
  process.exit(1);
}
const db = new DatabaseSync(dbPath, { readOnly: true });

const agentOnly = has("--agent-only");
const since = arg("--since");
const limit = Number(arg("--limit", "50"));
const where = [];
if (since) where.push(`l.id > ${Number(since)}`);
if (agentOnly) where.push(`l.client NOT LIKE '%connectivity%'`);
const whereSql = where.length ? `where ${where.join(" and ")}` : "";

// Route hops are not always persisted to request_route_hops; trace_json always has them.
function attemptsOf(traceJson) {
  if (!traceJson) return [];
  let parsed;
  try { parsed = JSON.parse(traceJson); } catch { return []; }
  return (parsed.hops ?? [])
    .filter((hop) => hop.name === "upstream.attempt.outcome")
    .map((hop) => ({
      delayMs: hop.outcome?.retryDelayMs ?? 0,
      error: hop.outcome?.error,
      model: hop.target?.model ?? "?",
      provider: hop.target?.provider ?? "?",
      status: hop.outcome?.statusCode
    }));
}

const rows = db.prepare(`
  select l.id, l.created_at, l.client, l.provider, l.requested_model, l.resolved_model,
         l.status_code, l.ok, l.duration_ms, l.response_body_text, t.trace_json
  from request_logs l left join request_route_traces t on t.request_log_id = l.id
  ${whereSql} order by l.id desc limit ${Number.isFinite(limit) ? limit : 50}
`).all().reverse();

if (rows.length === 0) { console.log("No matching requests."); process.exit(0); }

const traceId = arg("--trace");
if (traceId) {
  const row = rows.find((r) => String(r.id) === String(traceId))
    ?? db.prepare(`select l.id,l.status_code,l.duration_ms,l.response_body_text,t.trace_json
                   from request_logs l left join request_route_traces t on t.request_log_id=l.id
                   where l.id=?`).get(Number(traceId));
  if (!row) { console.error(`Request ${traceId} not found.`); process.exit(1); }
  console.log(`request ${row.id}  status ${row.status_code}  ${row.duration_ms}ms`);
  for (const [i, a] of attemptsOf(row.trace_json).entries()) {
    const wait = a.delayMs > 0 ? `  waited ${a.delayMs}ms` : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${String(a.status ?? "-").padEnd(4)} ${a.provider} / ${a.model}${wait}${a.error ? `  ${a.error}` : ""}`);
  }
  if (row.response_body_text) console.log(`\n  body: ${row.response_body_text.slice(0, 500)}`);
  process.exit(0);
}

if (has("--errors")) {
  const seen = new Map();
  for (const row of rows) {
    if (row.ok || !row.response_body_text) continue;
    const key = row.response_body_text.slice(0, 200);
    if (!seen.has(key)) seen.set(key, { count: 0, id: row.id, provider: row.provider, status: row.status_code });
    seen.get(key).count += 1;
  }
  console.log(`distinct upstream errors across ${rows.length} requests:\n`);
  for (const [body, meta] of [...seen.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  x${meta.count}  ${meta.status}  ${meta.provider}  (e.g. id ${meta.id})`);
    console.log(`        ${body.replace(/\s+/g, " ").slice(0, 160)}\n`);
  }
  process.exit(0);
}

const answered = new Map(); const failed = new Map();
let attemptTotal = 0; let waited = 0; let okCount = 0;
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

for (const row of rows) {
  if (row.ok) okCount += 1;
  for (const a of attemptsOf(row.trace_json)) {
    attemptTotal += 1;
    waited += a.delayMs ?? 0;
    bump(a.status === 200 ? answered : failed, `${a.provider} (${a.status ?? "error"})`);
  }
}

const pad = (n) => String(n).padStart(4);
console.log(`${rows.length} requests (ids ${rows[0].id}-${rows.at(-1).id}), ${okCount} ok, ${rows.length - okCount} failed`);
console.log(`${attemptTotal} upstream attempts, ${(attemptTotal / rows.length).toFixed(1)} per request`);
console.log(`${waited}ms spent in fallback backoff\n`);

const show = (title, map) => {
  if (map.size === 0) return;
  console.log(title);
  for (const [k, v] of [...map.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(v)}  ${k}`);
  console.log();
};
show("answered:", answered);
show("failed attempts:", failed);

const slow = rows.filter((r) => r.duration_ms > 10_000).sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 5);
if (slow.length) {
  console.log("slowest:");
  for (const r of slow) console.log(`  ${pad(r.duration_ms)}ms  id ${r.id}  ${r.provider}  status ${r.status_code}`);
}

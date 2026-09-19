// Summarize CCR request logs: which providers answer, which fail, and what the
// fallback chain actually did. Reads the SQLite log read-only.
//
//   node scripts/ccr-log.mjs                 last 50 requests
//   node scripts/ccr-log.mjs --since 6516    everything after a log id
//   node scripts/ccr-log.mjs --limit 200
//   node scripts/ccr-log.mjs --trace 6512    per-attempt trace for one request
//   node scripts/ccr-log.mjs --errors        distinct upstream error bodies
//   node scripts/ccr-log.mjs --usage [--days 7]
//                                            per-provider outcomes from
//                                            usage.sqlite, which is not pruned
//                                            and so outlives the request log
import path from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";


// The field-shape logic lives in core, which uses path aliases only the build
// resolves, so one re-export is bundled on first use and reused after. Same
// arrangement as provider-allowance.mjs, and for the same reason: a second
// copy here would drift from the one that writes the column.
function fieldShapeBundle() {
  const configured = process.env.CCR_FIELD_SHAPE_API;
  if (configured) return path.resolve(configured);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cache = path.join(repoRoot, "node_modules", ".cache");
  const bundle = path.join(cache, "ccr-field-shape.cjs");
  const source = path.join(repoRoot, "packages", "core", "src", "observability", "request-field-shape.ts");
  if (!existsSync(source)) return undefined;
  if (existsSync(bundle) && statSync(bundle).mtimeMs >= statSync(source).mtimeMs) return bundle;
  mkdirSync(cache, { recursive: true });
  const entry = path.join(cache, "ccr-field-shape-entry.ts");
  writeFileSync(entry, 'export { decodeFieldPaths, droppedFieldPaths, jsonFieldPaths } from "@ccr/core/observability/request-field-shape";\n');
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "esbuild"), [
    entry, "--bundle", "--platform=node", "--format=cjs", `--outfile=${bundle}`,
    "--log-level=error", `--alias:@ccr/core=${path.join(repoRoot, "packages", "core", "src")}`
  ], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
  return bundle;
}


/**
 * Fields the client sent that did not reach the provider.
 *
 * The stored body is the one sent upstream, so this is the only way to see a
 * field the gateway dropped. Silence here means the two shapes agree or one of
 * them was not recorded, never that the client sent nothing: rows written
 * before the column existed carry no inbound shape, and a body capture that is
 * off leaves no upstream side to compare.
 */
function reportDroppedFields(row) {
  const bundle = fieldShapeBundle();
  if (!bundle) return;
  let api;
  // The bundle is CJS, so it is required rather than imported: this reporter
  // runs inside a synchronous path and making that path async to load it would
  // reshape the caller for no gain.
  try { api = createRequire(import.meta.url)(bundle); } catch { return; }
  const inbound = api.decodeFieldPaths(row.ingress_field_paths);
  if (inbound.length === 0) {
    // Distinguish a log that cannot carry the reading from a request that
    // happened not to produce one, because the two look identical here.
    console.log(row.ingress_field_paths === undefined
      ? "\n  inbound shape: this log predates the column, so nothing was recorded"
      : "\n  inbound shape: not recorded for this request");
    return;
  }
  // The preview column elides the middle and is not JSON, so the full body is
  // read from the body store when there is a ref for it.
  let upstreamText = row.request_body_text ?? "";
  const ref = String(row.request_body_ref ?? "");
  if (/^[0-9a-f-]{8,}$/i.test(ref)) {
    const file = path.join(path.dirname(dbPath), "request-log-bodies", ref.slice(0, 2), ref);
    if (existsSync(file)) upstreamText = readFileSync(file, "utf8");
  }
  const upstream = api.jsonFieldPaths(upstreamText);
  if (upstream.length === 0) {
    console.log("\n  upstream shape: not readable, so nothing can be compared");
    return;
  }
  const dropped = api.droppedFieldPaths(inbound, upstream);
  console.log(`\n  inbound carried ${inbound.length} field path(s); ${dropped.length} did not reach the provider`);
  for (const field of dropped.slice(0, 20)) console.log(`    dropped: ${field}`);
  if (dropped.length > 20) console.log(`    ... and ${dropped.length - 20} more`);
}

const dbPath = process.env.CCR_LOG_DB ?? path.join(
  process.env.CCR_INTERNAL_APP_DATA_DIR ?? path.join(homedir(), ".claude-code-router", "app-data"),
  "request-logs.sqlite"
);

/**
 * One provider, written two ways.
 *
 * A final outcome records the display name from the config; a row recovered
 * from a raw trace records the routing selector, `provider::protocol`, whose
 * provider half is the display name lowercased with bracketing punctuation
 * dropped and spaces hyphenated, keeping dots. Grouping without this reports
 * most providers twice, once as an always-failing identity, because the
 * selector rows are overwhelmingly the failures.
 *
 * Derived from the data rather than assumed: the rule resolves 35 of the 38
 * selector prefixes present, and the three it does not are providers deleted
 * from the configuration plus one test sink. Those keep their raw name, since
 * inventing a display name for a provider that no longer exists would hide
 * that the history predates its removal.
 */
/**
 * The share of a provider's prompt it served from cache.
 *
 * `input_tokens` counts what was actually read; `cache_read_tokens` counts what
 * was served from a stored prefix, and the two do not overlap, so the prompt is
 * their sum. Measured 2026-09-19 against a 46K-token classifier request:
 * gemini-3.5-flash-lite reported 16,811 input and 29,570 cache read.
 *
 * Returns undefined rather than 0 when nothing was read at all. A provider with
 * no token accounting and one that cached nothing both present as zero, and
 * calling the first a cache miss invents a reading: the same trap the allowance
 * meter has, where a spent account and an unreadable connector both read zero.
 */
export function cacheHitShare(inputTokens, cacheReadTokens) {
  const read = Number(inputTokens) || 0;
  const cached = Number(cacheReadTokens) || 0;
  const prompt = read + cached;
  return prompt > 0 ? cached / prompt : undefined;
}

export function usageProviderKey(provider, displayBySlug) {
  const raw = String(provider ?? "").trim();
  // "unknown" is written literally by the recorder when it cannot attribute a
  // request, so it is an absence rather than a provider and must not sort
  // among them as one.
  if (raw === "" || raw.toLowerCase() === "unknown") return { key: "(unattributed)", known: false };
  const separator = raw.indexOf("::");
  if (separator === -1) return { key: raw, known: true };
  const slug = raw.slice(0, separator);
  const display = displayBySlug.get(slug);
  return display ? { key: display, known: true } : { key: slug, known: false };
}

export function providerSlug(name) {
  return String(name).toLowerCase().replace(/[()]/g, "").replace(/\s/g, "-");
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name) => process.argv.includes(name);

/** Provider display names from the running config, for the selector mapping. */
function configProviders() {
  const configFile = path.join(path.dirname(path.dirname(dbPath)), "config.sqlite");
  if (!existsSync(configFile)) return [];
  const row = new DatabaseSync(configFile, { readOnly: true })
    .prepare("select value_json from app_config where key='default'").get();
  return JSON.parse(row.value_json).Providers?.map((provider) => provider.name) ?? [];
}

function main() {
  if (!existsSync(dbPath)) {
    console.error(`No request log at ${dbPath}. Set CCR_LOG_DB to point at one.`);
    process.exit(1);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const since = arg("--since");
  const limit = Number(arg("--limit", "50"));
  const where = [];
  if (since) where.push(`l.id > ${Number(since)}`);
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  // Route hops are not always persisted to request_route_hops; trace_json always has them.
  function attemptsOf(traceJson) {
    if (!traceJson) return [];
    let parsed;
    try { parsed = JSON.parse(traceJson); } catch { return []; }
    return (parsed.hops ?? [])
      .filter((hop) => hop.name === "upstream.attempt.outcome" || hop.name === "upstream.attempt.skipped")
      .map((hop) => ({
        delayMs: hop.outcome?.retryDelayMs ?? 0,
        error: hop.outcome?.error,
        model: hop.target?.model ?? "?",
        provider: hop.target?.provider ?? "?",
        skippedForMs: hop.name === "upstream.attempt.skipped" ? hop.outcome?.cooldownRemainingMs ?? 0 : undefined,
        status: hop.outcome?.statusCode
      }));
  }

  // Answered before the listing query, and by id alone. Running the window
  // first let an empty window exit 0 with "No matching requests." while the
  // requested trace existed, which reads as an answer and is not one.

  if (has("--usage")) {
    // usage.sqlite is not pruned, so it is the only record of what a provider
    // did before today. It holds final outcomes rather than per-attempt
    // detail: measured, a four-entry chain leaves at most two rows, so the
    // middle entries are absent and these counts are per request, not per
    // attempt.
    const usageDb = new DatabaseSync(
      process.env.CCR_USAGE_DB ?? path.join(path.dirname(dbPath), "usage.sqlite"),
      { readOnly: true }
    );
    const days = Number(arg("--days", "7"));
    const since = new Date(Date.now() - (Number.isFinite(days) ? days : 7) * 86_400_000).toISOString();
    const config = configProviders();
    const bySlug = new Map(config.map((name) => [providerSlug(name), name]));
    const tally = new Map();
    for (const row of usageDb.prepare(
      `select provider, status_code, coalesce(input_tokens, 0) as input_tokens,
              coalesce(cache_read_tokens, 0) as cache_read_tokens
       from usage_events where created_at >= ?`
    ).all(since)) {
      const { key, known } = usageProviderKey(row.provider, bySlug);
      const seen = tally.get(key) ?? { cached: 0, known, ok: 0, read: 0, total: 0 };
      seen.total += 1;
      seen.read += Number(row.input_tokens) || 0;
      seen.cached += Number(row.cache_read_tokens) || 0;
      if (Number(row.status_code) >= 200 && Number(row.status_code) < 300) seen.ok += 1;
      tally.set(key, seen);
    }
    const rowsOut = [...tally.entries()].sort((a, b) => a[1].ok / a[1].total - b[1].ok / b[1].total || b[1].total - a[1].total);
    console.log(`outcomes over the last ${days} day(s), by provider, from usage.sqlite`);
    // Where a chain's requests carry a large invariant prefix, what a provider
    // caches decides both its latency and how fast its allowance is spent, so
    // it belongs beside the success rate rather than in a separate report.
    console.log(`cache is the share of the prompt served from a stored prefix; "-" means no token accounting\n`);
    for (const [name, seen] of rowsOut) {
      const share = ((seen.ok / seen.total) * 100).toFixed(0);
      const note = seen.known ? "" : name === "(unattributed)" ? "  no provider recorded" : "  not in the current config";
      const hit = cacheHitShare(seen.read, seen.cached);
      const cache = hit === undefined ? "    -" : `${String(Math.round(hit * 100)).padStart(3)}%`;
      console.log(`  ${String(share).padStart(3)}%  ${String(seen.ok).padStart(5)}/${String(seen.total).padEnd(6)} cache ${cache}  ${name}${note}`);
    }
    const dead = rowsOut.filter(([, s]) => s.ok === 0 && s.total >= 10);
    console.log(dead.length > 0
      ? `\n${dead.length} provider(s) answered nothing over this window: ${dead.map(([n]) => n).join(", ")}`
      : "\nevery provider with traffic answered at least once.");
    process.exit(0);
  }

  const traceId = arg("--trace");
  if (traceId) {
    // A log written by an older build carries fewer columns, and naming one it
    // does not have fails the whole query rather than the one field. The
    // optional columns are selected only where the schema carries them, so the
    // trace still prints against any log this script may be pointed at.
    const present = new Set(db.prepare("PRAGMA table_info(request_logs)").all().map((c) => c.name));
    const optional = ["ingress_field_paths", "request_body_ref", "request_body_text"]
      .filter((name) => present.has(name))
      .map((name) => `l.${name},`)
      .join("");
    const row = db.prepare(`select l.id,l.status_code,l.duration_ms,l.response_body_text,${optional}
                            t.trace_json
                            from request_logs l left join request_route_traces t on t.request_log_id=l.id
                            where l.id=?`).get(Number(traceId));
    if (!row) { console.error(`Request ${traceId} not found.`); process.exit(1); }
    console.log(`request ${row.id}  status ${row.status_code}  ${row.duration_ms}ms`);
    for (const [i, a] of attemptsOf(row.trace_json).entries()) {
      const label = a.skippedForMs === undefined
        ? `${String(a.status ?? "-").padEnd(4)} ${a.provider} / ${a.model}`
        : `skip ${a.model}  cooling for another ${a.skippedForMs}ms`;
      const wait = a.delayMs > 0 ? `  waited ${a.delayMs}ms` : "";
      console.log(`  ${String(i + 1).padStart(2)}. ${label}${wait}${a.error ? `  ${a.error}` : ""}`);
    }
    reportDroppedFields(row);
    if (row.response_body_text) console.log(`\n  body: ${row.response_body_text.slice(0, 500)}`);
    process.exit(0);
  }

  // Every listing says what it covers. Rows older than local midnight are
  // deleted on the first write after it, so an empty or short answer is usually
  // the retention window rather than a quiet system, and without this line the
  // two read identically.
  const window = db.prepare("select min(id) lo, max(id) hi, count(*) n, min(created_at) from_at, max(created_at) to_at from request_logs").get();
  console.log(window.n > 0
    ? `log holds ${window.n} request(s), ids ${window.lo} to ${window.hi}, ${String(window.from_at).slice(0, 19)} to ${String(window.to_at).slice(0, 19)}.`
      + "\nrows older than local midnight are pruned, so this is today unless the service has not written since."
    : "the request log is empty. Rows older than local midnight are pruned on the first write after it.");

  const rows = db.prepare(`
    select l.id, l.provider, l.status_code, l.ok, l.duration_ms,
           l.response_body_text, t.trace_json
    from request_logs l left join request_route_traces t on t.request_log_id = l.id
    ${whereSql} order by l.id desc limit ${Number.isFinite(limit) ? limit : 50}
  `).all().reverse();

  if (rows.length === 0) { console.log("\nNo requests in the window asked for."); process.exit(0); }

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

  const answered = new Map(); const failed = new Map(); const skipped = new Map();
  let attemptTotal = 0; let waited = 0; let okCount = 0;
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const row of rows) {
    if (row.ok) okCount += 1;
    for (const a of attemptsOf(row.trace_json)) {
      if (a.skippedForMs !== undefined) {
        // The skip is recorded before the provider name is resolved, and the
        // cooldown is keyed by model, so the model is the meaningful label.
        bump(skipped, a.model);
        continue;
      }
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
  show("skipped while cooling down:", skipped);

}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}

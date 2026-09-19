// node --test scripts/ccr-log.test.mjs
//
// This script prints rather than exporting, so it is driven as a subprocess
// against a throwaway log. CLAUDE.md recorded it as deliberately untested on
// the grounds that "a wrong reading is visible immediately". That reasoning
// was wrong: asking for a trace outside the listing window printed "No
// matching requests." and exited 0, which reads exactly like a right answer.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { providerSlug, usageProviderKey } from "./ccr-log.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "ccr-log-test-"));
const dbPath = path.join(dir, "request-logs.sqlite");
const script = path.join(import.meta.dirname, "ccr-log.mjs");
after(() => rmSync(dir, { force: true, recursive: true }));

{
  const db = new DatabaseSync(dbPath);
  db.exec(`create table request_logs (id integer primary key, provider text, status_code integer,
             ok integer, duration_ms integer, response_body_text text, created_at text);
           create table request_route_traces (request_log_id integer, trace_json text);`);
  db.prepare("insert into request_logs values (?,?,?,?,?,?,?)")
    .run(7, "Tokenreply", 200, 1, 1899, "hello", "2026-09-19T07:11:02.000Z");
  db.prepare("insert into request_route_traces values (?,?)").run(7, JSON.stringify({
    hops: [
      { name: "upstream.attempt.outcome", outcome: { error: "bad gateway", statusCode: 502 },
        target: { model: "m-a", provider: "Tokenreply" } },
      { name: "upstream.attempt.skipped", outcome: { cooldownRemainingMs: 42000 },
        target: { model: "m-b", provider: "OVH" } },
      { name: "upstream.attempt.outcome", outcome: { statusCode: 200 },
        target: { model: "m-c", provider: "OpenRouter" } }
    ]
  }));
  db.close();
}

const run = (...args) => spawnSync(process.execPath, [script, ...args], {
  encoding: "utf8", env: { ...process.env, CCR_LOG_DB: dbPath }
});

test("a trace is found by id even when the listing window excludes it", () => {
  // The defect: the window query ran first and exited 0 on an empty result,
  // so a valid id was unreachable and the output looked like an answer.
  const result = run("--since", "999999999", "--trace", "7");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /request 7 {2}status 200/);
  assert.doesNotMatch(result.stdout, /No matching requests/);
});

test("a trace names every attempt, including one skipped for cooling", () => {
  // A skipped entry occupies a chain position and is the thing hardest to see
  // from the outside, so it has to appear.
  const result = run("--trace", "7");
  assert.match(result.stdout, /502 {2}Tokenreply \/ m-a/);
  assert.match(result.stdout, /skip m-b {2}cooling for another 42000ms/);
  assert.match(result.stdout, /200 {2}OpenRouter \/ m-c/);
});

test("an id that does not exist is an error, not an empty answer", () => {
  const result = run("--trace", "999999");
  assert.equal(result.status, 1, "a missing request must not exit 0");
  assert.match(result.stderr, /Request 999999 not found/);
});

test("an empty window reports what the log holds, not just that it found nothing", () => {
  // Rows older than local midnight are pruned, so an empty answer is usually
  // the retention window. Without the coverage line it reads as a quiet
  // system, which is the wrong conclusion and the expensive one.
  const result = run("--since", "999999999");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /log holds 1 request\(s\), ids 7 to 7/);
  assert.match(result.stdout, /pruned/);
  assert.match(result.stdout, /No requests in the window asked for/);
});

test("a missing database is refused rather than reported as empty", () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8", env: { ...process.env, CCR_LOG_DB: path.join(dir, "absent.sqlite") }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No request log at/);
});

test("one provider written two ways is counted once", () => {
  // A final outcome records the display name; a row recovered from a raw
  // trace records the routing selector. Grouping without this reports most
  // providers twice, once as an always-failing identity, because the selector
  // rows are overwhelmingly the failures.
  const bySlug = new Map([["ovh", "OVH"], ["google-gemini", "Google Gemini"]]);
  assert.equal(usageProviderKey("OVH", bySlug).key, "OVH");
  assert.equal(usageProviderKey("ovh::openai_chat_completions", bySlug).key, "OVH");
  assert.equal(usageProviderKey("google-gemini::gemini_generate_content", bySlug).key, "Google Gemini");
});

test("a selector for a provider no longer configured keeps its raw name", () => {
  // Inventing a display name for a deleted provider would hide that the
  // history predates its removal. Measured: meta and venice are exactly this.
  const result = usageProviderKey("venice::openai_chat_completions", new Map());
  assert.equal(result.key, "venice");
  assert.equal(result.known, false, "it must be marked as absent from the config");
});

test("an unattributed row is not counted as a provider", () => {
  // The recorder writes the literal "unknown" when it cannot attribute a
  // request. Sorting that among real providers reports a phantom with a
  // failure rate.
  for (const value of ["", "   ", "unknown", "UNKNOWN", undefined, null]) {
    const result = usageProviderKey(value, new Map());
    assert.equal(result.key, "(unattributed)", `${JSON.stringify(value)} should be unattributed`);
    assert.equal(result.known, false);
  }
});

test("the slug rule matches the selector this install actually writes", () => {
  // Derived from the data, not assumed: the dot survives and the bracketing
  // punctuation does not, which a naive slug would get wrong in both places.
  assert.equal(providerSlug("Z.ai (Global) - General Endpoint"), "z.ai-global---general-endpoint");
  assert.equal(providerSlug("Google Gemini"), "google-gemini");
  assert.equal(providerSlug("Codex API"), "codex-api");
  assert.equal(providerSlug("OVH"), "ovh");
});

// The cache share is pure judgment and is exported, so it is tested directly
// rather than through a subprocess.
const { cacheHitShare } = await import("./ccr-log.mjs");

test("the cache share is taken against the whole prompt, not the uncached part", () => {
  // Measured 2026-09-19 on a 46K-token classifier request: gemini-3.5-flash-lite
  // reported 16,811 input and 29,570 cache read. The two do not overlap, so the
  // prompt is their sum and the share is 64 per cent, not 176 per cent.
  assert.equal(Math.round(cacheHitShare(16811, 29570) * 100), 64);
});

test("a provider with no token accounting is no reading, not a cache miss", () => {
  // A provider that reports nothing and one that cached nothing both present
  // as zero. Calling the first a miss invents a reading, which is the trap the
  // allowance meter already has with spent accounts and unreadable connectors.
  assert.equal(cacheHitShare(0, 0), undefined);
  assert.equal(cacheHitShare(null, null), undefined);
  assert.equal(cacheHitShare(undefined, undefined), undefined);
});

test("a real miss is zero, and is distinguishable from no reading", () => {
  // The control for the test above: MegaNova answered 109 of 109 while caching
  // nothing, which is what its zero has to mean.
  assert.equal(cacheHitShare(28370, 0), 0);
  assert.notEqual(cacheHitShare(28370, 0), undefined);
});

test("a fully cached prompt is one, and junk values do not throw", () => {
  assert.equal(cacheHitShare(0, 1000), 1);
  assert.equal(cacheHitShare("16811", "29570"), cacheHitShare(16811, 29570));
  assert.equal(cacheHitShare("nonsense", "nonsense"), undefined);
});

// A second throwaway log, this one carrying the inbound-shape column, so the
// dropped-field report can be driven end to end. Kept separate from the log
// above, which deliberately predates the column and pins that path.
const shapeDbPath = path.join(dir, "request-logs-shape.sqlite");
{
  const db = new DatabaseSync(shapeDbPath);
  db.exec(`create table request_logs (id integer primary key, provider text, status_code integer,
             ok integer, duration_ms integer, response_body_text text, created_at text,
             ingress_field_paths text, request_body_ref text, request_body_text text);
           create table request_route_traces (request_log_id integer, trace_json text);`);
  // The client sent a cache marker; the body that reached the provider has no
  // trace of it. That is the exact shape of the question this column exists
  // to answer.
  const inbound = ["messages", "messages[].role", "model", "system", "system[].cache_control",
    "system[].cache_control.type", "system[].text", "system[].type"].join("\n");
  const upstream = JSON.stringify({
    messages: [{ role: "user" }],
    model: "m",
    system: [{ text: "t", type: "text" }]
  });
  db.prepare("insert into request_logs values (?,?,?,?,?,?,?,?,?,?)")
    .run(11, "Kilo", 200, 1, 100, "ok", "2026-09-19T07:11:02.000Z", inbound, "", upstream);
  // A second row whose inbound shape was never recorded, to pin the quiet path.
  db.prepare("insert into request_logs values (?,?,?,?,?,?,?,?,?,?)")
    .run(12, "Kilo", 200, 1, 100, "ok", "2026-09-19T07:11:03.000Z", "", "", upstream);
  db.close();
}

const runShape = (...args) => spawnSync(process.execPath, [script, ...args], {
  encoding: "utf8", env: { ...process.env, CCR_LOG_DB: shapeDbPath }
});

test("a field the client sent that never reached the provider is named", () => {
  const result = runShape("--trace", "11");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dropped: system\[\]\.cache_control\.type/);
  assert.match(result.stdout, /2 did not reach the provider/);
});

test("a field that did survive is not reported as dropped", () => {
  // The control. Without it a reporter that named every inbound path would
  // pass the test above.
  const result = runShape("--trace", "11");
  assert.doesNotMatch(result.stdout, /dropped: model/);
  assert.doesNotMatch(result.stdout, /dropped: system\[\]\.text/);
});

test("a request with no recorded inbound shape says so instead of reporting a loss", () => {
  const result = runShape("--trace", "12");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not recorded for this request/);
  assert.doesNotMatch(result.stdout, /dropped:/);
});

test("a log predating the column is distinguished from a request without a reading", () => {
  // These look identical at the call site and mean different things: one is a
  // log that cannot carry the reading, the other a request that produced none.
  const result = run("--trace", "7");
  assert.match(result.stdout, /predates the column/);
});

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

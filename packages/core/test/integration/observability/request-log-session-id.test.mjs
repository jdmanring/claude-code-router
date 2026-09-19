// The session id is computed on every routed request and was discarded before
// storage, so a request could not be attributed to the conversation that
// produced it. Per-session cost was therefore unanswerable from stored data,
// which is what a session spend cap would need.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RequestLogStore } from "@ccr/core/observability/request-log-store.ts";

const dir = mkdtempSync(path.join(tmpdir(), "ccr-session-id-"));
after(() => rmSync(dir, { force: true, recursive: true }));

const baseInput = (extra) => ({
  client: "Profile: claude",
  requestBody: Buffer.alloc(0),
  requestHeaders: {},
  responseBody: Buffer.alloc(0),
  responseHeaders: {},
  completedAt: new Date().toISOString(),
  durationMs: 12,
  method: "POST",
  path: "/v1/messages",
  requestId: `req-${Math.random().toString(36).slice(2)}`,
  startedAt: new Date().toISOString(),
  statusCode: 200,
  url: "http://127.0.0.1:3456/v1/messages",
  ...extra
});

test("the schema carries a session id column", async () => {
  const file = path.join(dir, "schema.sqlite");
  await new RequestLogStore(file).initialize();
  const db = new DatabaseSync(file, { readOnly: true });
  const columns = db.prepare("PRAGMA table_info(request_logs)").all().map((row) => row.name);
  db.close();
  assert.ok(columns.includes("session_id"), "request_logs has no session_id column");
});

test("a recorded request stores the session it belonged to", async () => {
  const file = path.join(dir, "record.sqlite");
  const store = new RequestLogStore(file);
  await store.initialize();
  await store.record(baseInput({ sessionId: "session-alpha" }));
  await store.checkpoint?.();

  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("SELECT session_id FROM request_logs").all();
  db.close();
  assert.equal(rows.length, 1, "the request was not recorded");
  assert.equal(rows[0].session_id, "session-alpha");
});

test("requests group by session, which is what a spend cap needs", async () => {
  // The cap has to ask "what has this conversation cost", and that question is
  // only answerable if the column discriminates.
  const file = path.join(dir, "group.sqlite");
  const store = new RequestLogStore(file);
  await store.initialize();
  for (const id of ["alpha", "alpha", "beta"]) {
    await store.record(baseInput({ sessionId: `session-${id}` }));
  }
  await store.checkpoint?.();

  const db = new DatabaseSync(file, { readOnly: true });
  const grouped = db.prepare(
    "SELECT session_id, COUNT(*) AS n FROM request_logs GROUP BY session_id ORDER BY session_id"
  ).all().map((row) => ({ n: row.n, session_id: row.session_id }));
  db.close();
  assert.deepEqual(grouped, [
    { n: 2, session_id: "session-alpha" },
    { n: 1, session_id: "session-beta" }
  ]);
});

test("a request with no session records an empty string, not null", async () => {
  // The column is NOT NULL with a default, so an unrouted or probe request
  // must not fail to insert.
  const file = path.join(dir, "absent.sqlite");
  const store = new RequestLogStore(file);
  await store.initialize();
  await store.record(baseInput({}));
  await store.checkpoint?.();

  const db = new DatabaseSync(file, { readOnly: true });
  const row = db.prepare("SELECT session_id FROM request_logs").get();
  db.close();
  assert.equal(row.session_id, "");
});

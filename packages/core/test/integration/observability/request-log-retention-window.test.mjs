// The unit tests for the retention window pin the arithmetic. They pass with
// the prune still hard-coded to local midnight, so this pins the wiring: rows
// older than the window are deleted and rows inside it survive.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RequestLogStore } from "@ccr/core/observability/request-log-store.ts";

const dir = mkdtempSync(path.join(tmpdir(), "ccr-retention-"));
after(() => rmSync(dir, { force: true, recursive: true }));

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

/** Opens a store so its schema exists, then seeds rows of known ages. */
async function seed(file) {
  // initialize() is what opens the database and creates the schema.
  await new RequestLogStore(file).initialize();
  const db = new DatabaseSync(file);
  db.prepare("DELETE FROM request_logs").run();
  const insert = db.prepare(
    "INSERT INTO request_logs (id, created_at, method, path, source_usage_id) VALUES (?, ?, 'POST', '/v1/messages', NULL)"
  );
  for (const [id, age] of [[1, 0], [2, 3], [3, 10]]) insert.run(id, daysAgo(age));
  const seeded = db.prepare("SELECT COUNT(*) AS c FROM request_logs").get().c;
  db.close();
  assert.equal(seeded, 3, "the fixture did not seed");
}

async function survivingIds(file) {
  // A fresh store prunes when it opens, because the day-key guard is per
  // instance.
  await new RequestLogStore(file).initialize();
  const db = new DatabaseSync(file, { readOnly: true });
  const ids = db.prepare("SELECT id FROM request_logs ORDER BY id").all().map((r) => r.id);
  db.close();
  return ids;
}

test("the default window keeps a week, so a three-day-old request survives", async () => {
  const file = path.join(dir, "default.sqlite");
  delete process.env.CCR_REQUEST_LOG_RETENTION_DAYS;
  await seed(file);
  assert.deepEqual(await survivingIds(file), [1, 2], "the ten-day-old row should go and the three-day-old should stay");
});

test("a window of one day reproduces the previous behavior", async () => {
  // Anyone relying on today-only has to keep it, or the change takes something
  // away silently.
  const file = path.join(dir, "oneday.sqlite");
  process.env.CCR_REQUEST_LOG_RETENTION_DAYS = "1";
  try {
    await seed(file);
    assert.deepEqual(await survivingIds(file), [1], "only today should survive a one-day window");
  } finally {
    delete process.env.CCR_REQUEST_LOG_RETENTION_DAYS;
  }
});

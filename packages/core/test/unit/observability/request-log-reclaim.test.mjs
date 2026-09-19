// Retention deletes rows; SQLite keeps the freed pages in the file forever
// because the database has no auto_vacuum. Measured on one install before this
// existed: 345.6 MB on disk, 344.5 MB of it freelist, 1.1 MB of data, 28 rows.

import assert from "node:assert/strict";
import test from "node:test";

import { shouldReclaimRequestLogPages } from "@ccr/core/observability/request-log-store.ts";

const pageSize = 4096;
const mb = (bytes) => Math.ceil((bytes * 1024 * 1024) / pageSize);

test("the measured case reclaims", () => {
  assert.equal(shouldReclaimRequestLogPages(88199, 88475, pageSize), true);
});

test("a large file that is mostly live data is left alone", () => {
  // The lock is not worth taking to recover a fraction of a busy database.
  assert.equal(shouldReclaimRequestLogPages(mb(100), mb(1000), pageSize), false);
});

test("a small file that is mostly free is left alone", () => {
  // Proportionally wasteful, but rewriting it recovers almost nothing.
  assert.equal(shouldReclaimRequestLogPages(mb(8), mb(9), pageSize), false);
});

test("both thresholds must hold, not either", () => {
  assert.equal(shouldReclaimRequestLogPages(mb(65), mb(130), pageSize), true);
  assert.equal(shouldReclaimRequestLogPages(mb(63), mb(100), pageSize), false, "under the byte floor");
  assert.equal(shouldReclaimRequestLogPages(mb(100), mb(250), pageSize), false, "under the ratio floor");
});

test("an empty, fresh or unreadable database never triggers a rewrite", () => {
  // A pragma that returns nothing reads as 0 here, and must not be treated as
  // "entirely free" and vacuumed on every retention pass.
  assert.equal(shouldReclaimRequestLogPages(0, 0, pageSize), false);
  assert.equal(shouldReclaimRequestLogPages(0, mb(500), pageSize), false);
  assert.equal(shouldReclaimRequestLogPages(mb(100), 0, pageSize), false);
  assert.equal(shouldReclaimRequestLogPages(mb(100), mb(200), 0), false);
  assert.equal(shouldReclaimRequestLogPages(Number.NaN, mb(200), pageSize), false);
  assert.equal(shouldReclaimRequestLogPages(mb(100), Number.POSITIVE_INFINITY, pageSize), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { reportPeriod } from "../../lib/accounting/report-period.ts";

test("calendar year compares with entire preceding year", () => {
  assert.deepEqual(reportPeriod("2026-09", "yearly"), { startDate: "2026-01-01", endDate: "2026-12-31", priorStartDate: "2025-01-01", priorEndDate: "2025-12-31" });
});
test("six months crosses year boundary with equal length comparison", () => {
  assert.deepEqual(reportPeriod("2026-03", "six-months"), { startDate: "2025-10-01", endDate: "2026-03-31", priorStartDate: "2025-04-01", priorEndDate: "2025-09-30" });
});
test("custom comparison respects leap years", () => {
  assert.deepEqual(reportPeriod("2024-09", "custom", "2024-01", "2024-02", "last-year"), { startDate: "2024-01-01", endDate: "2024-02-29", priorStartDate: "2023-01-01", priorEndDate: "2023-02-28" });
});
test("invalid and reversed ranges are rejected", () => {
  assert.throws(() => reportPeriod("2026-09", "custom", "2026-10", "2026-01"));
  assert.throws(() => reportPeriod("2026-09", "custom", "2026-13", "2026-01"));
});

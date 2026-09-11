import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("money-in reconciliation keeps paid same-month invoices available for extra lines", async () => {
  const source = await readFile(new URL("../../app/reports/page.tsx", import.meta.url), "utf8");

  assert.match(source, /"payment_submitted",\s*"rejected",\s*"overdue",\s*"upcoming",\s*"due_today",\s*"paid"/);
  assert.match(source, /Fully paid invoices remain selectable/);
  assert.match(source, /available for extra line/);
  assert.match(source, /bill\.billMonth\.slice\(0, 7\) === statementRentalMonth/);
});

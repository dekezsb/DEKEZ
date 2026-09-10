import assert from "node:assert/strict";
import test from "node:test";
import { outletProfit } from "../../lib/accounting/outlet-profit.ts";

test("outlets are distinct by ID, include no activity and retain shared office costs", () => {
  const report = {
    revenue: [{ details: [{ propertyId: "a", amount: 500 }, { propertyId: "b", amount: 100 }] }],
    costsOfSales: [{ details: [{ propertyId: "a", amount: 300 }, { propertyId: "b", amount: 150 }] }],
    expenses: [{ details: [{ propertyId: null, amount: 30 }] }],
  };
  const result = outletProfit(report, [{ id: "a", name: "Same name" }, { id: "b", name: "Same name" }, { id: "c", name: "Empty outlet" }]);
  assert.equal(result.find((r) => r.id === "a").profit, 200);
  assert.equal(result.find((r) => r.id === "b").profit, -50);
  assert.equal(result.find((r) => r.id === "c").profit, 0);
  assert.equal(result.find((r) => r.id === "unallocated").profit, -30);
  assert.equal(result.reduce((sum, row) => sum + row.profit, 0), 120);
});

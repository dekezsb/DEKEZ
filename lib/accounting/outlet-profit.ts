import type { ProfitLossReport } from "./report-data";

export function outletProfit(report: ProfitLossReport, outlets: { id: string; name: string }[]) {
  const empty = (id: string, name: string) => ({ id, name, income: 0, costs: 0, expenses: 0, profit: 0 });
  const rows = new Map(outlets.map((outlet) => [outlet.id, empty(outlet.id, outlet.name)]));
  for (const [accounts, field] of [[report.revenue, "income"], [report.costsOfSales, "costs"], [report.expenses, "expenses"]] as const) {
    for (const account of accounts) for (const detail of account.details) {
      const id = detail.propertyId || "unallocated";
      if (!rows.has(id)) rows.set(id, empty(id, detail.propertyId ? detail.propertyName : "Office / unallocated"));
      rows.get(id)![field] += detail.amount;
    }
  }
  return [...rows.values()].map((row) => ({ ...row, profit: row.income - row.costs - row.expenses }))
    .sort((a, b) => a.id === "unallocated" ? 1 : b.id === "unallocated" ? -1 : a.name.localeCompare(b.name));
}

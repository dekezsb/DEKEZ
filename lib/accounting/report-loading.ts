import type { ProfitLossReport } from "./report-data";

// These reports are only rendered in these tabs. Balance Sheet / Trial Balance
// still load their original YTD sources independently; never substitute a page
// of list rows for an accounting total.
export function reportLoadPlan(tab: string) {
  return {
    profitComparison: tab === "overview" || tab === "profit-loss",
    bankCandidates: tab === "bank" || tab === "bank-history",
  };
}

export async function loadProfitComparison(
  enabled: boolean,
  load: () => Promise<ProfitLossReport>,
): Promise<ProfitLossReport> {
  if (enabled) return load();
  // Unused presentation data only. Never rendered/exported as a real report.
  return {revenue: [], costsOfSales: [], expenses: [], totalRevenue: 0,
    totalCostOfSales: 0, grossProfit: 0, totalExpenses: 0, netProfit: 0,
    invoiceCount: 0, expenseCount: 0};
}

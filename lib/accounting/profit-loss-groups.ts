import type { ProfitLossReport, ProfitLossRow } from "./report-data";

// Presentation only: classify the existing account/category, never bank memo or
// receipt description. No account mapping, posting or property is changed.
export function isUtilityExpense(row: Pick<ProfitLossRow, "key" | "label">): boolean {
  if (/^utility_|^utilities_expense$/.test(row.key ?? "")) return true;
  const label = (row.label ?? "").toLowerCase();
  if (/\b(repair|repairs|maintenance|equipment|installation|supplies)\b/.test(label)) return false;
  return /\b(utilities|utility|electricity|water|internet|telecom|telecommunications|telephone|broadband)\b/.test(label);
}

export function profitLossGroups(report: ProfitLossReport) {
  const utilities = new Map<string, ProfitLossRow>();
  const operating = new Map<string, ProfitLossRow>();
  for (const row of [...report.costsOfSales, ...report.expenses]) {
    const target = isUtilityExpense(row) ? utilities : operating;
    const previous = target.get(row.key);
    target.set(row.key, { ...row, amount: (previous?.amount ?? 0) + row.amount,
      details: [...(previous?.details ?? []), ...row.details] });
  }
  const sum = (rows: Map<string, ProfitLossRow>) => [...rows.values()].reduce((total, row) => total + row.amount, 0);
  return {
    utilities: [...utilities.values()], operating: [...operating.values()],
    totalUtilities: sum(utilities), totalOperating: sum(operating),
    // Include former direct costs. Regrouping must never omit a cost or change profit.
    totalExpenses: report.totalCostOfSales + report.totalExpenses,
  };
}

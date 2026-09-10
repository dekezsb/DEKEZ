import type { ProfitLossReport } from "./report-data";

export function profitTrend(report: ProfitLossReport, startDate: string, endDate: string) {
  const months = new Map<string, { month: string; income: number; costs: number; expenses: number; profit: number }>();
  const cursor = new Date(`${startDate}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= endDate) {
    const month = cursor.toISOString().slice(0, 7);
    months.set(month, { month, income: 0, costs: 0, expenses: 0, profit: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  for (const [rows, field] of [[report.revenue, "income"], [report.costsOfSales, "costs"], [report.expenses, "expenses"]] as const) {
    for (const row of rows) for (const detail of row.details) {
      const month = months.get(detail.date.slice(0, 7));
      if (month) month[field] += detail.amount;
    }
  }
  return Array.from(months.values()).map((row) => ({ ...row, profit: row.income - row.costs - row.expenses }));
}

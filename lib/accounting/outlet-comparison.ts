import type { ProfitLossReport, ProfitLossRow } from "./report-data";
import { outletProfit } from "./outlet-profit";

export const outletComparisonColumns = ["Outlet / Property", "Revenue", "Rent Expenses", "Electricity", "Water", "Telephone & Internet Expenses", "Operating Expenses", "Total Expenses", "Net Profit / Loss"];
// Presentation only: existing account/category, never transaction memo or a new posting.
function bucket(row: ProfitLossRow): "rent" | "electricity" | "water" | "telecom" | "operating" {
  const label = row.label ?? "";
  if (/\b(repairs?|maintenance|equipment|installation|supplies)\b/i.test(label)) return "operating";
  if (row.key === "property_rental_cost" || /^(property rental cost|rent expenses?|rental expenses?)$/i.test(label)) return "rent";
  if (row.key === "utility_electricity" || /^(electricity|electric)( fees?| bills?| expenses?| utilities)?$/i.test(label)) return "electricity";
  if (row.key === "utility_water" || /^water( fees?| bills?| expenses?| utilities)?$/i.test(label)) return "water";
  if (/^utility_(internet|telephone|telecom|broadband)$/.test(row.key ?? "") || /\b(telephone|internet|telecom|telecommunications|broadband)\b/i.test(label)) return "telecom";
  return "operating";
}
export function outletComparison(report: ProfitLossReport, outlets: {id: string; name: string}[]) {
  const rows = outletProfit(report, outlets).map(row => ({...row, rent: 0, electricity: 0, water: 0, telecom: 0, operating: 0}));
  const byId = new Map(rows.map(row => [row.id, row]));
  const warnings: string[] = [];
  for (const account of [...report.costsOfSales, ...report.expenses]) {
    const field = bucket(account);
    if (field === "operating" && /^(utilities?|other utilities)$/i.test(account.label ?? "") && Math.abs(account.amount) > .005)
      warnings.push(`"${account.label}" is not split by utility type in the existing report. Included once in Operating Expenses pending category review; no split has been guessed.`);
    for (const detail of account.details) byId.get(detail.propertyId || "unallocated")![field] += detail.amount;
  }
  const totals = {income: report.totalRevenue, rent: 0, electricity: 0, water: 0, telecom: 0, operating: 0,
    totalExpenses: report.totalCostOfSales + report.totalExpenses, profit: report.netProfit};
  for (const row of rows) for (const field of ["rent", "electricity", "water", "telecom", "operating"] as const) totals[field] += row[field];
  if (Math.abs(rows.reduce((sum, row) => sum + row.income, 0) - totals.income) > .005
    || Math.abs(totals.rent + totals.electricity + totals.water + totals.telecom + totals.operating - totals.totalExpenses) > .005
    || Math.abs(rows.reduce((sum, row) => sum + row.profit, 0) - totals.profit) > .005)
    warnings.push("Outlet detail does not reconcile to company P&L. Review source coverage; company totals have not been adjusted.");
  return {rows, totals, warnings};
}
export const comparisonAmounts = (row: {income: number; rent: number; electricity: number; water: number; telecom: number; operating: number; totalExpenses: number; profit: number}) =>
  [row.income, row.rent, row.electricity, row.water, row.telecom, row.operating, row.totalExpenses, row.profit];

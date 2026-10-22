import type { ProfitLossReport, ProfitLossRow } from "./report-data";
import { profitLossGroups } from "./profit-loss-groups";
import { outletProfit } from "./outlet-profit";

// Presentation snapshots only. No database client, posting, or alternative
// accounting calculation belongs in this module.
export type ReportCompany = { name: string; registration: string; address: string };
export type ReportPrintRow = { cells: string[]; kind?: "section" | "total" | "final" };
export type FinancialReportExport = {
  company: ReportCompany;
  title: string;
  period: string;
  scope: string;
  filename: string;
  columns: string[];
  widths: number[];
  rows: ReportPrintRow[];
  notes: string[];
  warnings: string[];
};
export type ReportAccount = { id: string; code: string; system_key: string | null; report_group: string };

export function reportCompany(company: { name: string; registration_number: string | null }): ReportCompany {
  const isDekez = company.name.replace(/[^a-z]/gi, "").toLowerCase() === "dekezsdnbhd";
  return {
    name: isDekez ? "DEKEZ SDN BHD" : company.name,
    registration: company.registration_number || (isDekez ? "202501054747 (1656153-U)" : ""),
    // Existing approved company address used on DEKEZ invoices.
    address: isDekez ? "Lot 30, Kian Yap Industrial Estate, Lorong Durian 3, Kota Kinabalu, Sabah, Malaysia" : "",
  };
}

export function reportMoney(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Report contains an invalid amount. Refresh the report before exporting.");
  return `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function reportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("Invalid report date");
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function section(label: string): ReportPrintRow { return { kind: "section", cells: [label] }; }
function amountRow(label: string, amount: number, kind: "total" | "final" = "total"): ReportPrintRow {
  return { kind, cells: ["", label, reportMoney(amount)] };
}

export function profitLossExport(input: {
  company: ReportCompany; report: ProfitLossReport; accounts: ReportAccount[];
  startDate: string; endDate: string; scope: string;
}): FinancialReportExport {
  const { company, report, accounts, startDate, endDate, scope } = input;
  const accountFor = (row: ProfitLossRow) => accounts.find((account) =>
    (account.system_key && account.system_key === row.key) || `account_${account.id}` === row.key);
  const rowFor = (row: ProfitLossRow): ReportPrintRow => ({
    cells: [accountFor(row)?.code ?? "-", row.label, reportMoney(row.amount)],
  });
  const otherIncome = report.revenue.filter((row) => accountFor(row)?.report_group === "other_income");
  const revenue = report.revenue.filter((row) => !otherIncome.includes(row));
  const groups = profitLossGroups(report);
  // Section subtotals sum the very same displayed rows; accounting totals are
  // copied from the report service, not recomputed by the PDF renderer.
  const sum = (rows: ProfitLossRow[]) => rows.reduce((value, row) => value + row.amount, 0);
  const rows: ReportPrintRow[] = [
    section("REVENUE / INCOME"), ...revenue.map(rowFor), amountRow("Subtotal revenue / income", sum(revenue)),
    section("OTHER INCOME"), ...otherIncome.map(rowFor), amountRow("Subtotal other income", sum(otherIncome)),
    amountRow("Total revenue / income", report.totalRevenue),
    section("UTILITIES"), ...groups.utilities.map(rowFor), amountRow("Total Utilities", groups.totalUtilities),
    section("OPERATING EXPENSES"), ...groups.operating.map(rowFor), amountRow("Total Operating Expenses", groups.totalOperating),
    amountRow("Total Expenses", groups.totalExpenses), amountRow("NET PROFIT / (LOSS)", report.netProfit, "final"),
  ];
  return {
    company, title: "PROFIT & LOSS STATEMENT",
    period: `For the period ${reportDate(startDate)} to ${reportDate(endDate)}`, scope,
    filename: `DEKEZ_PnL_${startDate}_to_${endDate}.pdf`,
    columns: ["Account code", "Account name", "Amount (RM)"], widths: [77, 303, 135], rows,
    notes: ["Accrual basis. Refundable tenant deposits are excluded from income.",
      ...(report.revenue.concat(report.costsOfSales, report.expenses).some((row) => !accountFor(row))
        ? ["A dash in Account code denotes a report category without a unique mapped account code; no code has been invented."] : [])],
    warnings: [],
  };
}

export function outletProfitExport(input: {
  company: ReportCompany; report: ProfitLossReport; outlets: { id: string; name: string }[];
  startDate: string; endDate: string;
}): FinancialReportExport {
  const groups = profitLossGroups(input.report);
  return {
    company: input.company, title: "OUTLET / PROPERTY PROFIT & LOSS",
    period: `For the period ${reportDate(input.startDate)} to ${reportDate(input.endDate)}`,
    scope: "All outlets / properties; Office / unallocated shown separately",
    filename: `DEKEZ_Outlet_PnL_${input.startDate}_to_${input.endDate}.pdf`,
    columns: ["", "Report line", "Amount (RM)"], widths: [15, 365, 135],
    rows: [...outletProfit(input.report, input.outlets).flatMap((row) => [
      section(row.name), { cells: ["", "Revenue", reportMoney(row.income)] },
      { cells: ["", "Utilities", reportMoney(row.utilities)] }, { cells: ["", "Operating Expenses", reportMoney(row.operating)] },
      amountRow("Total Expenses", row.totalExpenses), amountRow("Net Profit / (Loss)", row.profit, "final"),
    ]), section("ALL OUTLETS / COMPANY TOTAL"), amountRow("Revenue", input.report.totalRevenue),
    amountRow("Total Utilities", groups.totalUtilities), amountRow("Total Operating Expenses", groups.totalOperating),
    amountRow("Total Expenses", groups.totalExpenses), amountRow("Net Profit / (Loss)", input.report.netProfit, "final")],
    notes: ["Accrual basis. The same property assignments and figures as the on-screen comparison.",
      "Office / unallocated costs are not distributed to properties. Refundable tenant deposits are excluded from income."],
    warnings: [],
  };
}

export const balanceBasisNote = "Historical balances are management reconstructions, not frozen month-end accounts. Invoice and bill balances use current settlement status. Bank balances use the latest available imported statement by each date; shared bank balances remain company-level.";

export function balanceSheetExport(input: {
  company: ReportCompany; date: string; priorDate: string; scope: string;
  rows: { code: string; label: string; section: string; amount: number; priorAmount: number }[];
  totals: { section: string; amount: number; priorAmount: number }[];
  difference: number; priorDifference: number; search: string; showZero: boolean;
}): FinancialReportExport {
  const { company, date, priorDate, scope, totals } = input;
  const rows: ReportPrintRow[] = [];
  for (const total of totals) {
    rows.push(section(total.section.toUpperCase()));
    rows.push(...input.rows.filter((row) => row.section === total.section).map((row) => ({
      cells: [row.code, row.label, reportMoney(row.amount), reportMoney(row.priorAmount)],
    })));
    rows.push({ kind: "total", cells: ["", `Total ${total.section}`, reportMoney(total.amount), reportMoney(total.priorAmount)] });
  }
  const liabilitiesAndEquity = (key: "amount" | "priorAmount") => totals.filter((row) => row.section !== "Assets").reduce((value, row) => value + row[key], 0);
  rows.push({ kind: "final", cells: ["", "TOTAL LIABILITIES + EQUITY", reportMoney(liabilitiesAndEquity("amount")), reportMoney(liabilitiesAndEquity("priorAmount"))] });
  rows.push({ kind: "total", cells: ["", "Assets less liabilities and equity", reportMoney(input.difference), reportMoney(input.priorDifference)] });
  const warnings = [];
  if (Math.abs(input.difference) >= .005) warnings.push(`Current Balance Sheet is not balanced: difference ${reportMoney(input.difference)}. Investigate before treating this report as final.`);
  if (Math.abs(input.priorDifference) >= .005) warnings.push(`Comparison Balance Sheet difference: ${reportMoney(input.priorDifference)}. Review required.`);
  if (input.search) warnings.push("Account search is active. Only matching account rows are shown; totals remain for the full selected scope, as on screen. Clear the search for a complete statement.");
  return {
    company, title: "BALANCE SHEET", period: `As at ${reportDate(date)}; comparison ${reportDate(priorDate)}`, scope,
    filename: `DEKEZ_Balance_Sheet_${date}.pdf`,
    columns: ["Account code", "Account name", date, priorDate], widths: [67, 222, 113, 113],
    rows, notes: [balanceBasisNote, `Account display: ${input.showZero ? "including" : "excluding"} zero-balance rows.${input.search ? ` Search: ${input.search}` : ""}`], warnings,
  };
}

export function trialBalanceExport(input: {
  company: ReportCompany; startDate: string; endDate: string; scope: string;
  rows: { code: string; label: string; debit: number; credit: number }[];
  debit: number; credit: number; conversionDifference: number;
}): FinancialReportExport {
  const warnings = [];
  if (Math.abs(input.conversionDifference) > .005) warnings.push(`Underlying trial balance difference: ${reportMoney(input.conversionDifference)}. The OPENING conversion row is an unposted display control, NOT a journal or a resolved balance. Review opening records before finalising.`);
  if (Math.abs(input.debit - input.credit) >= .005) warnings.push(`Total debit and total credit differ by ${reportMoney(input.debit - input.credit)}. This report must not be treated as final.`);
  return {
    company: input.company, title: "TRIAL BALANCE",
    period: `${reportDate(input.startDate)} to ${reportDate(input.endDate)} (as at ${reportDate(input.endDate)})`,
    scope: input.scope, filename: `DEKEZ_Trial_Balance_${input.endDate}.pdf`,
    columns: ["Account code", "Account name", "Debit (RM)", "Credit (RM)"], widths: [67, 222, 113, 113],
    rows: [...input.rows.map((row) => ({ cells: [row.code, row.label, reportMoney(row.debit), reportMoney(row.credit)] })),
      { kind: "final", cells: ["", "TOTAL DEBIT / TOTAL CREDIT", reportMoney(input.debit), reportMoney(input.credit)] }],
    notes: [balanceBasisNote, "Account ranges and report categories are preserved exactly as displayed; this export does not create or correct ledger postings."],
    warnings,
  };
}

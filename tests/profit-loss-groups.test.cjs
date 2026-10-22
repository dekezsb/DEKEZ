const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = require("./renovation-loader.cjs");
const { profitLossGroups, isUtilityExpense } = load("lib/accounting/profit-loss-groups.ts");
const { outletProfit } = load("lib/accounting/outlet-profit.ts");
const { profitTrend } = load("lib/accounting/profit-trend.ts");
const { profitLossExport, outletProfitExport, reportMoney } = load("lib/accounting/financial-report-export.ts");
const { financialReportPdf } = load("lib/accounting/financial-report-pdf.ts");
const { PDFDocument } = require("pdf-lib");
const detail = (propertyId, amount, sourceType = "journal_entry", date = "2026-07-14") => ({
  id: `${propertyId}-${amount}`, propertyId, propertyName: propertyId || "Office", amount, date, sourceType,
  sourceLabel: "Test source", documentNumber: "TEST", referenceNumber: null, roomName: null,
  partyName: null, description: "Water pump repairs (memo must not decide classification)", debit: amount, credit: 0,
});
const row = (key, label, details) => ({ key, label, details, amount: details.reduce((sum, d) => sum + d.amount, 0) });
const report = {
  revenue: [row("rental_income", "Rental Income", [detail("a", 1000), detail("b", 2000)])],
  costsOfSales: [row("property_rental_cost", "Property Rental Cost", [detail("a", 250), detail("b", 400)])],
  expenses: [
    row("utilities_expense", "Electricity Fee", [detail("a", 80), detail("b", 120), detail("b", -20)]),
    row("account_water", "Water Fee", [detail("a", 10), detail("b", 20)]),
    row("other_operating_expense", "Telephone and Internet Expenses", [detail("b", 50)]),
    row("utility_other", "Other Utilities", [detail("a", 5, "utility_bill")]),
    row("repairs_maintenance", "Water Pump Repairs and Maintenance", [detail("a", 45)]),
    row("staff_costs", "Staff Costs", [detail("b", 100)]),
    row("office_admin", "Office Supplies", [detail(null, 30)]),
    row("utility_water", "Water Utilities", [detail(null, 7, "utility_bill")]),
  ],
  totalRevenue: 3000, totalCostOfSales: 650, grossProfit: 2350, totalExpenses: 447,
  netProfit: 1903, invoiceCount: 2, expenseCount: 8,
};
const outlets = [{ id: "a", name: "Same property name" }, { id: "b", name: "Same property name" }, { id: "c", name: "No activity" }];
const company = { name: "DEKEZ SDN BHD", registration: "TEST ONLY", address: "Fictional test report" };
const input = { company, report, accounts: [], outlets, startDate: "2026-07-01", endDate: "2026-07-31", scope: "All outlets" };

test("two groups preserve all original costs, credits, sources and net profit without mutation", () => {
  const before = JSON.stringify(report);
  const groups = profitLossGroups(report);
  assert.equal(groups.totalUtilities, 272);
  assert.equal(groups.totalOperating, 825);
  assert.equal(groups.totalExpenses, 1097);
  assert.equal(groups.totalUtilities + groups.totalOperating, groups.totalExpenses);
  assert.equal(report.totalRevenue - groups.totalExpenses, report.netProfit);
  assert.equal(JSON.stringify(report), before);
  assert.deepEqual([...groups.utilities, ...groups.operating].flatMap(r => r.details).map(d => d.id).sort(),
    [...report.costsOfSales, ...report.expenses].flatMap(r => r.details).map(d => d.id).sort());
  for (const label of ["Electricity", "Water Fee", "Internet / Telecom", "Other utility bills", "Telephone and Internet Expenses"]) assert.equal(isUtilityExpense({ key: "test", label }), true);
  for (const label of ["Water Pump Repairs", "Electrical Maintenance", "Office Supplies", "Staff Costs"]) assert.equal(isUtilityExpense({ key: "test", label }), false);
});

test("utilities remain on exact property IDs, never distributed from unallocated or merged by name", () => {
  const rows = outletProfit(report, outlets);
  assert.deepEqual(rows.find(r => r.id === "a"), { id: "a", name: "Same property name", income: 1000, costs: 250, expenses: 140, utilities: 95, operating: 295, totalExpenses: 390, profit: 610 });
  assert.equal(rows.find(r => r.id === "b").utilities, 170);
  assert.equal(rows.find(r => r.id === "b").operating, 500);
  assert.equal(rows.find(r => r.id === "unallocated").utilities, 7);
  assert.equal(rows.find(r => r.id === "c").totalExpenses, 0);
  assert.equal(rows.reduce((sum, r) => sum + r.profit, 0), report.netProfit);
});

test("monthly view uses the same groups; mid-month ranges do not skip February", () => {
  const months = profitTrend(report, "2026-01-31", "2026-08-31");
  assert.equal(months.length, 8);
  assert.equal(months[1].month, "2026-02");
  assert.equal(months[6].utilities, 272);
  assert.equal(months[6].operating, 825);
  assert.equal(months[6].profit, report.netProfit);
});

test("screen, main PDF and property PDF use identical two-group presentation and source figures", () => {
  const groups = profitLossGroups(report);
  const spec = profitLossExport(input);
  for (const [label, amount] of [["Total Utilities", groups.totalUtilities], ["Total Operating Expenses", groups.totalOperating], ["Total Expenses", groups.totalExpenses]]) {
    assert.ok(spec.rows.some(r => r.cells[1] === label && r.cells[2] === reportMoney(amount)));
  }
  const outletSpec = outletProfitExport(input);
  const rows = outletProfit(report, outlets);
  rows.forEach((r, i) => assert.deepEqual(outletSpec.rows.slice(i * 6 + 1, i * 6 + 6).map(p => p.cells[2]),
    [r.income, r.utilities, r.operating, r.totalExpenses, r.profit].map(reportMoney)));
  assert.equal(outletSpec.period, spec.period);
});

test("PDF and UI grouping functions are read-only and preserve the original report service", () => {
  for (const file of ["lib/accounting/profit-loss-groups.ts", "lib/accounting/outlet-profit.ts", "lib/accounting/financial-report-export.ts"]) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /createClient|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  }
  for (const file of ["components/accounting/outlet-profit-table.tsx", "components/accounting/profit-loss-statement.tsx"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /profitLossGroups/);
    assert.match(source, /Utilities/);
    assert.match(source, /Total Expenses/);
    assert.doesNotMatch(source, /Direct costs|Cost of sales|Gross profit/);
  }
});

test("generate multipage two-group PDFs for visual review", async () => {
  const output = process.env.FINANCIAL_PDF_OUTPUT;
  for (const spec of [profitLossExport(input), outletProfitExport(input)]) {
    const result = await financialReportPdf(spec, new Date("2026-10-22T04:00:00Z"));
    const document = await PDFDocument.load(result.bytes);
    assert.ok(document.getPageCount() >= 2);
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, spec.filename), result.bytes);
    }
  }
});

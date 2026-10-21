const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = require("./renovation-loader.cjs");
const { PDFDocument } = require("pdf-lib");
const { profitLossExport, balanceSheetExport, trialBalanceExport, reportCompany, reportMoney } = load("lib/accounting/financial-report-export.ts");
const { financialReportPdf } = load("lib/accounting/financial-report-pdf.ts");
const company = reportCompany({ name: "DEKEZ SDN BHD", registration_number: "202501054747 (1656153-U)" });
const account = (id, code, system_key, report_group) => ({ id, code, system_key, report_group });
const row = (key, label, amount) => ({ key, label, amount, details: [] });
const report = {
  revenue: [row("rental_income", "Rental Income", 50000), row("other_income", "Bank Interest", 50)],
  costsOfSales: [row("direct_cost", "Property Direct Costs", 15000)],
  expenses: [row("office", "Office Expenses", 2500), row("other", "Other Expenses", 100)],
  totalRevenue: 50050, totalCostOfSales: 15000, grossProfit: 35050,
  totalExpenses: 2600, netProfit: 32450, invoiceCount: 100, expenseCount: 5,
};
const accounts = [
  account("rental", "4000", "rental_income", "revenue"),
  account("interest", "4900", "other_income", "other_income"),
  account("cost", "5000", "direct_cost", "cost_of_sales"),
  account("office", "5100", "office", "operating_expense"),
  account("other", "5900", "other", "other_expense"),
];
const pnl = () => profitLossExport({ company, report, accounts, startDate: "2026-03-01", endDate: "2026-08-31", scope: "All outlets / company" });
const balanceInput = {
  company, date: "2026-08-31", priorDate: "2026-02-28", scope: "All outlets / company",
  rows: [
    { code: "1011", label: "Bank", section: "Assets", amount: 50000, priorAmount: 10000 },
    { code: "1100", label: "Rental Receivable", section: "Assets", amount: 5000, priorAmount: 2000 },
    { code: "2200", label: "Tenant Security Deposit Liability", section: "Liabilities", amount: 10000, priorAmount: 2000 },
    { code: "3000", label: "Capital", section: "Equity", amount: 12550, priorAmount: 10000 },
    { code: "YTD", label: "Current Profit / Loss", section: "Equity", amount: 32450, priorAmount: 0 },
  ],
  totals: [
    { section: "Assets", amount: 55000, priorAmount: 12000 },
    { section: "Liabilities", amount: 10000, priorAmount: 2000 },
    { section: "Equity", amount: 45000, priorAmount: 10000 },
  ],
  difference: 0, priorDifference: 0, search: "", showZero: true,
};
const trialInput = {
  company, startDate: "2026-01-01", endDate: "2026-08-31", scope: "All outlets / company",
  rows: [
    { code: "1011", label: "Bank", debit: 50000, credit: 0 },
    { code: "1100", label: "Rental Receivable", debit: 5000, credit: 0 },
    { code: "2200", label: "Tenant Security Deposit Liability", debit: 0, credit: 10000 },
    { code: "3000", label: "Capital", debit: 0, credit: 12550 },
    { code: "4xxx", label: "Revenue", debit: 0, credit: 50050 },
    { code: "5xxx", label: "Costs and Expenses", debit: 17600, credit: 0 },
  ],
  debit: 72600, credit: 72600, conversionDifference: 0,
};
test("P&L export copies displayed amounts, dates and scope without mutating source data", () => {
  const before = JSON.stringify(report);
  const spec = pnl();
  assert.equal(JSON.stringify(report), before);
  assert.equal(spec.period, "For the period 1 March 2026 to 31 August 2026");
  assert.equal(spec.filename, "DEKEZ_PnL_2026-03-01_to_2026-08-31.pdf");
  assert.deepEqual(spec.rows.at(-1).cells, ["", "NET PROFIT / (LOSS)", "RM 32,450.00"]);
  for (const r of [...report.revenue, ...report.costsOfSales, ...report.expenses]) {
    assert.ok(spec.rows.some((printed) => printed.cells[1] === r.label && printed.cells[2] === reportMoney(r.amount)));
  }
  assert.ok(spec.rows.some((r) => r.cells[0] === "OTHER INCOME"));
  assert.ok(spec.rows.some((r) => r.cells[0] === "OTHER EXPENSES"));
  const scoped = profitLossExport({ company, report, accounts, startDate: "2026-03-15", endDate: "2026-04-12", scope: "KLB only" });
  assert.equal(scoped.scope, "KLB only");
  assert.match(scoped.period, /15 March 2026 to 12 April 2026/);
});
test("missing account mappings are explicit; company data and monetary errors are not invented", () => {
  const spec = profitLossExport({ company, report, accounts: [], startDate: "2026-03-01", endDate: "2026-03-31", scope: "All" });
  assert.ok(spec.notes.some((n) => /no code has been invented/.test(n)));
  assert.equal(spec.rows[1].cells[0], "-");
  assert.deepEqual(reportCompany({ name: "Another Company", registration_number: null }), { name: "Another Company", registration: "", address: "" });
  assert.throws(() => reportMoney(NaN), /invalid amount/);
  assert.throws(() => reportMoney(Infinity), /invalid amount/);
  assert.equal(reportMoney(-12.25), "RM -12.25");
});
test("Balance Sheet uses the same rows/totals and preserves filters, comparison and basis limitations", () => {
  const before = JSON.stringify(balanceInput);
  const spec = balanceSheetExport(balanceInput);
  assert.equal(JSON.stringify(balanceInput), before);
  assert.equal(spec.warnings.length, 0);
  assert.ok(spec.rows.some((r) => r.cells[1] === "TOTAL LIABILITIES + EQUITY" && r.cells[2] === "RM 55,000.00"));
  assert.ok(spec.notes.some((n) => /not frozen month-end/.test(n)));
  const filtered = balanceSheetExport({ ...balanceInput, rows: balanceInput.rows.slice(0, 1), search: "Bank", showZero: false });
  assert.ok(filtered.warnings.some((n) => /Only matching/.test(n)));
  assert.ok(filtered.rows.some((r) => r.cells[1] === "Total Assets" && r.cells[2] === "RM 55,000.00"));
  const unbalanced = balanceSheetExport({ ...balanceInput, difference: 500, priorDifference: -20 });
  assert.equal(unbalanced.warnings.length, 2);
  assert.equal(unbalanced.rows.at(-1).cells[2], "RM 500.00");
});
test("Trial Balance cannot hide a difference behind the existing conversion display row", () => {
  const normal = trialBalanceExport(trialInput);
  assert.equal(normal.warnings.length, 0);
  assert.deepEqual(normal.rows.at(-1).cells, ["", "TOTAL DEBIT / TOTAL CREDIT", "RM 72,600.00", "RM 72,600.00"]);
  const converted = trialBalanceExport({ ...trialInput, conversionDifference: 100, rows: [...trialInput.rows, { code: "OPENING", label: "Opening / conversion balance still to post", debit: 0, credit: 100 }] });
  assert.ok(converted.warnings.some((n) => /NOT a journal/.test(n)));
  assert.equal(converted.rows.at(-2).cells[0], "OPENING");
  assert.ok(trialBalanceExport({ ...trialInput, credit: 72599 }).warnings.some((n) => /must not be treated as final/.test(n)));
});
test("PDFs are searchable A4 documents with metadata, safe multipage rows and Unicode support", async () => {
  const output = process.env.FINANCIAL_PDF_OUTPUT;
  const unicodeFont = new Uint8Array(fs.readFileSync("public/fonts/NotoSansSC-Regular.ttf"));
  const specs = [pnl(), balanceSheetExport(balanceInput), trialBalanceExport(trialInput)];
  const longSpec = pnl();
  longSpec.rows.splice(1, 0, ...Array.from({ length: 70 }, (_, i) => ({
    cells: [`TEST${i + 1}`, `Fictional layout test account ${i + 1} - a deliberately long description to verify account row wrapping without clipping`, "RM 0.00"],
  })));
  longSpec.filename = "layout-multipage-test.pdf";
  specs.push(longSpec);
  const draft = trialBalanceExport({ ...trialInput, conversionDifference: 100 });
  draft.filename = "trial-draft-test.pdf"; specs.push(draft);
  const unicode = balanceSheetExport({ ...balanceInput, rows: [{ ...balanceInput.rows[0], label: "Bank 银行 / 测试" }, ...balanceInput.rows.slice(1)] });
  unicode.filename = "unicode-test.pdf"; specs.push(unicode);
  if (output) fs.mkdirSync(output, { recursive: true });
  for (const spec of specs) {
    const before = JSON.stringify(spec);
    const result = await financialReportPdf(spec, new Date("2026-10-20T06:00:00Z"), /[^\x20-\x7e]/.test(before) ? unicodeFont : undefined);
    assert.equal(JSON.stringify(spec), before);
    const parsed = await PDFDocument.load(result.bytes);
    assert.equal(parsed.getPageCount(), result.pages);
    assert.ok(parsed.getTitle().startsWith(spec.title));
    assert.equal(parsed.getAuthor(), "DEKEZ SDN BHD");
    for (const page of parsed.getPages()) {
      assert.ok(Math.abs(page.getWidth() - 595.28) < .01);
      assert.ok(Math.abs(page.getHeight() - 841.89) < .01);
    }
    if (spec === longSpec) assert.ok(result.pages >= 3);
    if (spec.warnings.length) assert.match(parsed.getTitle(), /DRAFT/);
    if (output) fs.writeFileSync(path.join(output, spec.filename), result.bytes);
  }
});
test("export entrypoints are presentation only, authenticated screen snapshots, not alternate queries", () => {
  const page = fs.readFileSync("app/reports/page.tsx", "utf8");
  const pnlUi = fs.readFileSync("components/accounting/profit-loss-statement.tsx", "utf8");
  const bsUi = fs.readFileSync("components/accounting/balance-sheet-comparison.tsx", "utf8");
  assert.match(page, /requireRole\(\["super_admin", "owner", "admin"\]/);
  assert.match(pnlUi, /report: currentReport, startDate, endDate, scope: propertyScope/);
  assert.match(bsUi, /scope, rows: visibleRows/);
  assert.match(page, /rows: balancedTrialRows, debit: trialDebit, credit: trialCredit, conversionDifference/);
  for (const file of ["lib/accounting/financial-report-export.ts", "lib/accounting/financial-report-pdf.ts", "components/accounting/financial-pdf-button.tsx"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /createClient|createAdminClient|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  }
  const button = fs.readFileSync("components/accounting/financial-pdf-button.tsx", "utf8");
  assert.match(button, /await import\("@\/lib\/accounting\/financial-report-pdf"\)/);
  assert.match(button, /_DRAFT\.pdf/);
});

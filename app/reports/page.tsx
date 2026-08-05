import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  BookOpen,
  Building2,
  FileBarChart,
  Landmark,
  Link2,
  PlusCircle,
  ReceiptText,
  Scale,
  Sparkles,
  Upload,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBankCandidates } from "@/lib/accounting/bank-candidates";
import { getProfitLossReport, previousPeriod } from "@/lib/accounting/report-data";
import { requireRole } from "@/lib/auth/session";
import { getFirstCompany, getProperties } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";
import {
  autoMatchStatement,
  createBankAccount,
  createBankAdjustment,
  createTenantPaymentFromBankLine,
  finalizeBankReconciliation,
  ignoreBankLine,
  importBankStatement,
  matchBankLine,
  unmatchBankLine,
} from "./actions";

type ReportsPageProps = {
  searchParams: Promise<{
    tab?: string;
    month?: string;
    property?: string;
    statement?: string;
    error?: string;
    [key: string]: string | undefined;
  }>;
};

const moneyFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  minimumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return moneyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function validMonth(value: string | undefined) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

function monthEnd(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function dateLabel(value: string | null | undefined) {
  return value ? dateFormatter.format(new Date(`${value}T00:00:00Z`)) : "-";
}

function tabHref(tab: string, month: string, propertyId: string, statementId?: string) {
  const search = new URLSearchParams({ tab, month });
  if (propertyId) search.set("property", propertyId);
  if (tab === "bank" && statementId) search.set("statement", statementId);
  return `/reports?${search.toString()}`;
}

function bankLineHref(month: string, propertyId: string, statementId: string, lineId?: string) {
  const search = new URLSearchParams({ tab: "bank", month, statement: statementId });
  if (propertyId) search.set("property", propertyId);
  if (lineId) search.set("line", lineId);
  return `/reports?${search.toString()}${lineId ? `#bank-line-${lineId}` : "#bank-transactions"}`;
}

function differenceClass(value: number) {
  if (Math.abs(value) < 0.005) return "text-gray-500";
  return value > 0 ? "text-emerald-700" : "text-red-600";
}

function bankRoomHint(value: string) {
  const match = value.toUpperCase().match(/\b(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*(?:ROOM\s*)?([A-Z]?\d+)\b/);
  return match ? { propertyCode: match[1], roomCode: match[2].replace(/^0+/, "") || "0" } : null;
}

function propertyCode(value: string) {
  return value.trim().toUpperCase().match(/^[A-Z]{3}/)?.[0] ?? "";
}

function roomCode(value: string) {
  return value.toUpperCase().replace(/^ROOM\s*/i, "").replace(/^0+/, "") || "0";
}

const errorMessages: Record<string, string> = {
  accounting_context: "Your accounting company could not be loaded.",
  bank_account_details: "Enter the bank account name, bank name and full account number (6 to 30 digits).",
  bank_account_create: "The bank account could not be created.",
  statement_details: "Choose a bank account, period and CSV statement.",
  statement_csv: "Upload a CSV bank statement of 10 MB or less.",
  statement_format: "The CSV columns could not be recognised. Include date, description and amount/debit/credit.",
  statement_empty: "The statement does not contain any transaction lines.",
  statement_create: "The statement could not be started. Please try again.",
  statement_duplicate: "This exact bank statement was already imported. DEKEZ opened the existing copy instead of duplicating it.",
  statement_upload: "The retained statement file could not be stored.",
  statement_lines: "The bank statement lines could not be imported.",
  statement_closed: "This statement is already reconciled and locked.",
  match_details: "Choose a valid accounting transaction to match.",
  match_direction: "Money-in must match a receipt and money-out must match a payment.",
  match_create: "This bank match could not be saved.",
  tenant_payment_match: "The direct tenant knock-off failed. Rent, deposit and other must equal the unmatched bank amount.",
  adjustment_details: "Choose an accounting category and enter a description.",
  adjustment_property: "Choose the property for a Property Rental Cost entry.",
  ignore_details: "Enter an audit reason before ignoring a statement line.",
  ignore_matched: "Remove existing matches before ignoring this statement line.",
  statement_unmatched: "Match, adjust or explain every bank line before finalising.",
  statement_balance: "Opening balance plus statement movements does not equal the closing balance.",
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  await requireRole(["super_admin", "owner", "admin"], { module: "reports", level: "view" });
  const params = await searchParams;
  const company = await getFirstCompany();
  if (!company) return <p className="text-sm text-gray-600">Set up a company before opening Accounting.</p>;

  const supabase = await createClient();
  const selectedMonth = validMonth(params.month) ?? new Date().toISOString().slice(0, 7);
  const startDate = `${selectedMonth}-01`;
  const endDate = monthEnd(selectedMonth);
  const priorDates = previousPeriod(startDate, endDate);
  const properties = (await getProperties()).filter((property) => property.company_id === company.id);
  const propertyIds = properties.map((property) => property.id);
  const selectedPropertyId = properties.some((property) => property.id === params.property) ? params.property ?? "" : "";
  const tab = ["overview", "profit-loss", "bank", "ledger"].includes(params.tab ?? "") ? params.tab ?? "overview" : "overview";

  const [currentReport, priorReport, bankAccountsResult, statementsResult, accountsResult, candidates, liabilitiesResult] = await Promise.all([
    getProfitLossReport(supabase, { companyId: company.id, startDate, endDate, propertyId: selectedPropertyId || null }),
    getProfitLossReport(supabase, { companyId: company.id, startDate: priorDates.startDate, endDate: priorDates.endDate, propertyId: selectedPropertyId || null }),
    supabase.from("bank_accounts").select("id, name, bank_name, account_number, account_number_last4, opening_balance, opening_balance_date, is_active, accounting_account_id, accounting_accounts(code, name)").eq("company_id", company.id).eq("is_active", true).order("name"),
    supabase.from("bank_statement_imports").select("id, bank_account_id, period_start, period_end, statement_date, opening_balance, closing_balance, status, original_file_name, created_at").eq("company_id", company.id).neq("status", "void").order("period_end", { ascending: false }).limit(24),
    supabase.from("accounting_accounts").select("id, code, name, account_type, report_group, normal_balance, system_key, is_system, is_active").eq("company_id", company.id).eq("is_active", true).order("sort_order").order("code"),
    getBankCandidates(supabase, company.id),
    supabase.from("staff_reimbursement_liabilities").select("amount, status, expense_id").eq("status", "outstanding"),
  ]);

  const bankAccounts = bankAccountsResult.data ?? [];
  const statementImports = statementsResult.data ?? [];
  const accounts = accountsResult.data ?? [];
  const selectedStatementId = statementImports.some((item) => item.id === params.statement) ? params.statement ?? "" : statementImports[0]?.id ?? "";
  const selectedStatement = statementImports.find((item) => item.id === selectedStatementId) ?? null;

  const { data: companyExpenses } = await supabase.from("expenses").select("id").eq("company_id", company.id);
  const companyExpenseIds = new Set((companyExpenses ?? []).map((item) => item.id));
  const staffPayable = (liabilitiesResult.data ?? [])
    .filter((item) => item.expense_id && companyExpenseIds.has(item.expense_id))
    .reduce((total, item) => total + Number(item.amount ?? 0), 0);

  let openBills: Array<Record<string, any>> = [];
  if (propertyIds.length) {
    const result = await supabase
      .from("rent_bills")
      .select("id, tenancy_id, tenant_record_id, tenant_id, property_id, room_id, bill_month, due_date, invoice_number, amount, deposit_amount, paid_amount, status")
      .in("property_id", propertyIds)
      .in("status", ["unpaid", "partially_paid", "payment_submitted"])
      .is("removed_at", null)
      .order("due_date", { ascending: true });
    openBills = result.data ?? [];
  }
  const billIds = openBills.map((bill) => bill.id as string);
  const tenancyIds = Array.from(new Set(openBills.map((bill) => bill.tenancy_id as string).filter(Boolean)));
  const tenantRecordIds = Array.from(new Set(openBills.map((bill) => bill.tenant_record_id as string).filter(Boolean)));
  const roomIds = Array.from(new Set(openBills.map((bill) => bill.room_id as string).filter(Boolean)));
  const [itemsResult, depositsResult, tenantsResult, roomsResult] = await Promise.all([
    billIds.length ? supabase.from("rental_invoice_line_items").select("rent_bill_id, amount").in("rent_bill_id", billIds) : Promise.resolve({ data: [] }),
    tenancyIds.length ? supabase.from("payments").select("tenancy_id, amount").in("tenancy_id", tenancyIds).eq("category", "deposit").eq("status", "confirmed").is("reversed_at", null) : Promise.resolve({ data: [] }),
    tenantRecordIds.length ? supabase.from("tenant_records").select("id, full_name").in("id", tenantRecordIds) : Promise.resolve({ data: [] }),
    roomIds.length ? supabase.from("rooms").select("id, name, room_number").in("id", roomIds) : Promise.resolve({ data: [] }),
  ]);
  const itemTotals = new Map<string, number>();
  for (const item of itemsResult.data ?? []) itemTotals.set(item.rent_bill_id, (itemTotals.get(item.rent_bill_id) ?? 0) + Number(item.amount ?? 0));
  const depositPaid = new Map<string, number>();
  for (const payment of depositsResult.data ?? []) depositPaid.set(payment.tenancy_id, (depositPaid.get(payment.tenancy_id) ?? 0) + Number(payment.amount ?? 0));
  const tenantNames = new Map((tenantsResult.data ?? []).map((item) => [item.id, item.full_name]));
  const roomNames = new Map((roomsResult.data ?? []).map((item) => [item.id, item.name || `Room ${item.room_number}`]));
  const propertyNames = new Map(properties.map((item) => [item.id, item.name]));
  const invoiceOptions = openBills.map((bill) => {
    const rentOutstanding = Math.max(Number(bill.amount ?? 0) + (itemTotals.get(bill.id) ?? 0) - Number(bill.paid_amount ?? 0), 0);
    const depositOutstanding = Math.max(Number(bill.deposit_amount ?? 0) - (depositPaid.get(bill.tenancy_id) ?? 0), 0);
    return {
      id: String(bill.id),
      invoiceNumber: bill.invoice_number as string | null,
      billMonth: String(bill.bill_month),
      tenantName: tenantNames.get(bill.tenant_record_id) || `Tenant ${String(bill.tenant_id ?? "").slice(0, 8)}`,
      propertyName: propertyNames.get(bill.property_id) ?? "Property",
      roomName: roomNames.get(bill.room_id) ?? "Room",
      propertyCode: propertyCode(propertyNames.get(bill.property_id) ?? ""),
      roomCode: roomCode(roomNames.get(bill.room_id) ?? ""),
      rentOutstanding,
      depositOutstanding,
      outstanding: rentOutstanding + depositOutstanding,
    };
  }).filter((bill) => bill.outstanding > 0.005);
  const tenantOutstanding = invoiceOptions.reduce((total, item) => total + item.outstanding, 0);

  const statementLines = selectedStatementId
    ? (await supabase.from("bank_statement_lines").select("id, transaction_date, value_date, description, reference_number, amount, status, ignored_reason").eq("statement_import_id", selectedStatementId).order("transaction_date").order("id")).data ?? []
    : [];
  const lineIds = statementLines.map((line) => line.id);
  const matches = lineIds.length
    ? (await supabase.from("bank_reconciliation_matches").select("id, statement_line_id, source_type, source_id, matched_amount, match_method, created_at, created_by").in("statement_line_id", lineIds)).data ?? []
    : [];
  const matchesByLine = new Map<string, typeof matches>();
  for (const match of matches) {
    const values = matchesByLine.get(match.statement_line_id) ?? [];
    values.push(match);
    matchesByLine.set(match.statement_line_id, values);
  }
  const candidateMap = new Map(candidates.map((item) => [`${item.sourceType}:${item.sourceId}`, item]));
  const consumed = new Map<string, number>();
  for (const match of matches) {
    const key = `${match.source_type}:${match.source_id}`;
    consumed.set(key, (consumed.get(key) ?? 0) + Math.abs(Number(match.matched_amount ?? 0)));
  }
  const statementMovement = statementLines.reduce((total, line) => total + Number(line.amount ?? 0), 0);
  const statementDifference = selectedStatement ? Number(selectedStatement.opening_balance ?? 0) + statementMovement - Number(selectedStatement.closing_balance ?? 0) : 0;
  const unmatchedCount = statementLines.filter((line) => line.status === "unmatched").length;
  const statementAccount = bankAccounts.find((item) => item.id === selectedStatement?.bank_account_id);
  const unreconciledTotal = statementImports.filter((item) => item.status === "in_progress").length;
  const adjustmentAccounts = accounts.filter((account) => account.id !== statementAccount?.accounting_account_id);
  const adjustmentAccountGroups = ["expense", "asset", "liability", "equity", "income"].map((type) => ({
    type,
    accounts: adjustmentAccounts.filter((account) => account.account_type === type),
  })).filter((group) => group.accounts.length);

  const mergedRows = new Map<string, { label: string; current: number; previous: number }>();
  for (const row of [...currentReport.revenue, ...currentReport.costsOfSales, ...currentReport.expenses]) mergedRows.set(row.key, { label: row.label, current: row.amount, previous: 0 });
  for (const row of [...priorReport.revenue, ...priorReport.costsOfSales, ...priorReport.expenses]) {
    const existing = mergedRows.get(row.key);
    mergedRows.set(row.key, { label: row.label, current: existing?.current ?? 0, previous: row.amount });
  }

  const tabs = [
    { key: "overview", label: "Accounting Overview", icon: FileBarChart },
    { key: "profit-loss", label: "Profit & Loss", icon: Scale },
    { key: "bank", label: "Bank Reconciliation", icon: Landmark },
    { key: "ledger", label: "Chart of Accounts", icon: BookOpen },
  ];
  const statusClasses: Record<string, string> = {
    matched: "bg-emerald-100 text-emerald-800",
    adjusted: "bg-blue-100 text-blue-800",
    ignored: "bg-gray-200 text-gray-700",
    unmatched: "bg-amber-100 text-amber-800",
    reconciled: "bg-emerald-100 text-emerald-800",
    in_progress: "bg-amber-100 text-amber-800",
  };

  return (
    <section className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9a6b19]">Double-entry accounting</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-950 sm:text-3xl">Accounts &amp; Reports</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">Bukku-style accrual P&amp;L, invoice control and bank matching using the records already inside DEKEZ.</p>
        </div>
        <form className="grid gap-2 rounded-lg border border-[#d7dde5] bg-white p-3 sm:grid-cols-[170px_230px_auto]" method="get">
          <input name="tab" type="hidden" value={tab} />
          <label className="text-xs font-medium text-gray-600">Reporting month<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3 text-sm" defaultValue={selectedMonth} name="month" type="month" /></label>
          <label className="text-xs font-medium text-gray-600">Property<select className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm" defaultValue={selectedPropertyId} name="property"><option value="">All properties</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
          <Button className="self-end" type="submit">View</Button>
        </form>
      </div>

      {params.error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessages[params.error] ?? "The accounting action could not be completed."}</div> : null}

      <nav className="flex gap-2 overflow-x-auto border-b border-[#d7dde5] pb-3">
        {tabs.map((item) => {
          const Icon = item.icon;
          return <Button asChild className="shrink-0" key={item.key} variant={tab === item.key ? "default" : "outline"}><Link href={tabHref(item.key, selectedMonth, selectedPropertyId, selectedStatementId)}><Icon className="h-4 w-4" />{item.label}</Link></Button>;
        })}
      </nav>

      {tab === "overview" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            {[
              { label: "Accrued revenue", value: currentReport.totalRevenue, icon: ArrowDownLeft, tone: "text-emerald-700", detail: `${currentReport.invoiceCount} issued invoices`, count: false },
              { label: "All costs & expenses", value: currentReport.totalCostOfSales + currentReport.totalExpenses, icon: ArrowUpRight, tone: "text-red-600", detail: `${currentReport.expenseCount} verified bills`, count: false },
              { label: "Net profit", value: currentReport.netProfit, icon: FileBarChart, tone: currentReport.netProfit >= 0 ? "text-emerald-700" : "text-red-600", detail: "Accrual basis", count: false },
              { label: "Tenant outstanding", value: tenantOutstanding, icon: ReceiptText, tone: "text-amber-700", detail: `${invoiceOptions.length} open invoices`, count: false },
              { label: "Owing to staff", value: staffPayable, icon: WalletCards, tone: "text-red-600", detail: "Verified, not paid back", count: false },
              { label: "Bank recon pending", value: unreconciledTotal, icon: Landmark, tone: "text-blue-700", detail: "Statements in progress", count: true },
            ].map((summary) => {
              const Icon = summary.icon;
              return <Card key={summary.label}><CardHeader className="pb-2"><div className="flex items-center justify-between"><CardDescription>{summary.label}</CardDescription><Icon className={`h-5 w-5 ${summary.tone}`} /></div><CardTitle className={`text-2xl ${summary.tone}`}>{summary.count ? summary.value : money(summary.value)}</CardTitle></CardHeader><CardContent><p className="text-xs text-gray-500">{summary.detail}</p></CardContent></Card>;
            })}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.45fr_0.55fr]">
            <Card>
              <CardHeader><CardTitle>Monthly Profit &amp; Loss</CardTitle><CardDescription>Income is recognised when invoiced; verified company expenses use the bill date.</CardDescription></CardHeader>
              <CardContent>
                <Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Current</TableHead><TableHead className="text-right">Previous</TableHead><TableHead className="text-right">Change</TableHead></TableRow></TableHeader><TableBody>
                  {Array.from(mergedRows.values()).slice(0, 8).map((row) => <TableRow key={row.label}><TableCell>{row.label}</TableCell><TableCell className="text-right font-medium">{money(row.current)}</TableCell><TableCell className="text-right">{money(row.previous)}</TableCell><TableCell className={`text-right font-medium ${differenceClass(row.current - row.previous)}`}>{money(row.current - row.previous)}</TableCell></TableRow>)}
                  <TableRow className="bg-gray-50"><TableCell className="font-semibold">Net profit</TableCell><TableCell className="text-right font-semibold">{money(currentReport.netProfit)}</TableCell><TableCell className="text-right font-semibold">{money(priorReport.netProfit)}</TableCell><TableCell className={`text-right font-semibold ${differenceClass(currentReport.netProfit - priorReport.netProfit)}`}>{money(currentReport.netProfit - priorReport.netProfit)}</TableCell></TableRow>
                </TableBody></Table>
                <Button asChild className="mt-4" variant="outline"><Link href={tabHref("profit-loss", selectedMonth, selectedPropertyId)}>Open full P&amp;L</Link></Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Accounting rules in use</CardTitle><CardDescription>These rules prevent duplicated income and expenses.</CardDescription></CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-700">
                {["Rental is income when a valid invoice is issued.", "Tenant deposits are liabilities, not revenue.", "Top-ups and extra charges are separate invoice income.", "Staff reimbursement pays a liability; it does not create a second expense.", "Every bank line must be matched, adjusted or explained.", "Statements, receipts and audit records are retained for seven years."].map((rule) => <div className="flex gap-2" key={rule}><BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span>{rule}</span></div>)}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {tab === "profit-loss" ? (
        <Card>
          <CardHeader><CardTitle>Profit &amp; Loss Statement</CardTitle><CardDescription>{dateLabel(startDate)} to {dateLabel(endDate)} · accrual basis · deposits excluded from income</CardDescription></CardHeader>
          <CardContent>
            <Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Current period</TableHead><TableHead className="text-right">Previous period</TableHead><TableHead className="text-right">Difference</TableHead></TableRow></TableHeader><TableBody>
              <TableRow className="bg-emerald-50"><TableCell className="font-semibold text-emerald-900" colSpan={4}>Revenue</TableCell></TableRow>
              {currentReport.revenue.map((row) => { const previous = priorReport.revenue.find((item) => item.key === row.key)?.amount ?? 0; return <TableRow key={row.key}><TableCell className="pl-8">{row.label}</TableCell><TableCell className="text-right">{money(row.amount)}</TableCell><TableCell className="text-right">{money(previous)}</TableCell><TableCell className={`text-right ${differenceClass(row.amount - previous)}`}>{money(row.amount - previous)}</TableCell></TableRow>; })}
              <TableRow><TableCell className="font-semibold">Total revenue</TableCell><TableCell className="text-right font-semibold">{money(currentReport.totalRevenue)}</TableCell><TableCell className="text-right font-semibold">{money(priorReport.totalRevenue)}</TableCell><TableCell className={`text-right font-semibold ${differenceClass(currentReport.totalRevenue - priorReport.totalRevenue)}`}>{money(currentReport.totalRevenue - priorReport.totalRevenue)}</TableCell></TableRow>
              <TableRow className="bg-amber-50"><TableCell className="font-semibold text-amber-900" colSpan={4}>Cost of sales / direct property costs</TableCell></TableRow>
              {currentReport.costsOfSales.length ? currentReport.costsOfSales.map((row) => { const previous = priorReport.costsOfSales.find((item) => item.key === row.key)?.amount ?? 0; return <TableRow key={row.key}><TableCell className="pl-8">{row.label}</TableCell><TableCell className="text-right">{money(row.amount)}</TableCell><TableCell className="text-right">{money(previous)}</TableCell><TableCell className="text-right">{money(row.amount - previous)}</TableCell></TableRow>; }) : <TableRow><TableCell className="pl-8 text-gray-500" colSpan={4}>No direct property costs recorded for this period.</TableCell></TableRow>}
              <TableRow><TableCell className="font-semibold">Gross profit</TableCell><TableCell className="text-right font-semibold">{money(currentReport.grossProfit)}</TableCell><TableCell className="text-right font-semibold">{money(priorReport.grossProfit)}</TableCell><TableCell className={`text-right font-semibold ${differenceClass(currentReport.grossProfit - priorReport.grossProfit)}`}>{money(currentReport.grossProfit - priorReport.grossProfit)}</TableCell></TableRow>
              <TableRow className="bg-red-50"><TableCell className="font-semibold text-red-900" colSpan={4}>Operating expenses</TableCell></TableRow>
              {currentReport.expenses.map((row) => { const previous = priorReport.expenses.find((item) => item.key === row.key)?.amount ?? 0; return <TableRow key={row.key}><TableCell className="pl-8">{row.label}</TableCell><TableCell className="text-right">{money(row.amount)}</TableCell><TableCell className="text-right">{money(previous)}</TableCell><TableCell className={`text-right ${differenceClass(previous - row.amount)}`}>{money(row.amount - previous)}</TableCell></TableRow>; })}
              <TableRow><TableCell className="font-semibold">Total expenses</TableCell><TableCell className="text-right font-semibold">{money(currentReport.totalExpenses)}</TableCell><TableCell className="text-right font-semibold">{money(priorReport.totalExpenses)}</TableCell><TableCell className="text-right font-semibold">{money(currentReport.totalExpenses - priorReport.totalExpenses)}</TableCell></TableRow>
              <TableRow className="border-t-2 border-gray-900 bg-gray-50"><TableCell className="text-base font-bold">Net profit / (loss)</TableCell><TableCell className="text-right text-base font-bold">{money(currentReport.netProfit)}</TableCell><TableCell className="text-right text-base font-bold">{money(priorReport.netProfit)}</TableCell><TableCell className={`text-right text-base font-bold ${differenceClass(currentReport.netProfit - priorReport.netProfit)}`}>{money(currentReport.netProfit - priorReport.netProfit)}</TableCell></TableRow>
            </TableBody></Table>
          </CardContent>
        </Card>
      ) : null}

      {tab === "bank" ? (
        <div className="space-y-5">
          <details className="rounded-lg border border-[#d7dde5] bg-white">
            <summary className="cursor-pointer list-none px-5 py-4"><span className="font-semibold text-gray-950">How bank reconciliation works</span><span className="ml-2 text-sm text-gray-500">Open only when you need help</span></summary>
          <Card>
            <CardHeader><CardTitle>Bank reconciliation — simple guide</CardTitle><CardDescription>The goal is simple: the DEKEZ bank records and your real bank statement must agree exactly.</CardDescription></CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4"><p className="font-semibold text-blue-950">Knock off</p><p className="mt-1 text-xs leading-5 text-blue-800">Reduce the amount owing on a tenant invoice after a real payment is received.</p></div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"><p className="font-semibold text-emerald-950">Match</p><p className="mt-1 text-xs leading-5 text-emerald-800">Link one bank-statement line to its payment, expense, payout or adjustment in DEKEZ.</p></div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-950">Reconcile</p><p className="mt-1 text-xs leading-5 text-amber-800">Finish the whole statement only when every line is explained and the difference is RM 0.00.</p></div>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {[
                  ["1", "SET UP ONCE", "Add the full bank account number. Enter the actual bank balance and its exact date before importing your first statement."],
                  ["2", "DO EVERY MONTH", "Import the bank CSV, press Auto match, then open and handle every unmatched money-in and money-out line."],
                  ["3", "FINISH THE MONTH", "Check that unmatched lines are zero and Difference is RM 0.00. Then press Finalise to lock the reconciliation."],
                ].map(([step, title, detail]) => <div className="rounded-lg border border-[#d7dde5] p-4" key={step}><div className="mb-2 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#b8892c] text-xs font-bold text-white">{step}</span><p className="text-xs font-bold tracking-wide text-gray-950">{title}</p></div><p className="text-xs leading-5 text-gray-600">{detail}</p></div>)}
              </div>
              <div className="overflow-hidden rounded-lg border border-[#d7dde5]">
                <div className="bg-gray-100 px-4 py-3"><p className="font-semibold text-gray-950">Which action should I use for an unmatched bank line?</p></div>
                <div className="grid gap-px bg-[#d7dde5] sm:grid-cols-[1.2fr_1fr_1.5fr]">
                  {[
                    ["What happened?", "Press this action", "Result"],
                    ["The payment or expense is already in DEKEZ", "Match existing transaction", "Links the bank line only. It does not create a duplicate record."],
                    ["Tenant paid, but did not upload a slip", "Record payment, knock off & match", "Creates one verified payment, reduces the invoice and matches the bank receipt."],
                    ["Bank fee, interest or genuine missing accounting entry", "Create bank adjustment", "Creates the missing income or expense and matches it."],
                    ["Duplicate, transfer between own accounts or not a company transaction", "Ignore with audit reason", "Explains why the line is excluded. A reason is permanently retained."],
                  ].map((row, rowIndex) => row.map((cell, columnIndex) => <div className={`px-4 py-3 text-xs leading-5 ${rowIndex === 0 ? "bg-gray-50 font-semibold text-gray-700" : columnIndex === 1 ? "bg-[#fffaf0] font-semibold text-[#7a5618]" : "bg-white text-gray-700"}`} key={`${rowIndex}-${columnIndex}`}>{cell}</div>))}
                </div>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">Important: if the payment already exists in DEKEZ, use Match existing transaction. Do not record and knock off again, or you will duplicate the payment.</div>
            </CardContent>
          </Card>
          </details>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card><CardHeader><CardTitle>Add a bank account</CardTitle><CardDescription>Each real account links to its own bank ledger.</CardDescription></CardHeader><CardContent>
              <details open={!bankAccounts.length}>
                <summary className="mb-3 cursor-pointer text-sm font-semibold text-[#7a5618]">{bankAccounts.length ? "+ Add another bank account" : "+ Add first bank account"}</summary>
              <form action={createBankAccount} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Account name<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="name" placeholder="Public Bank Current" required /></label>
                <label className="text-sm">Bank name<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="bankName" placeholder="Public Bank" required /></label>
                <label className="text-sm">Full bank account number<input autoComplete="off" className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" inputMode="numeric" maxLength={30} minLength={6} name="accountNumber" pattern="[0-9 -]{6,30}" placeholder="Enter complete account number" required /></label>
                <label className="text-sm">Starting bank balance<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="openingBalance" step="0.01" type="number" /><span className="mt-1 block text-xs text-gray-500">Actual bank balance on the date below.</span></label>
                <label className="text-sm">Balance date<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="openingBalanceDate" type="date" /><span className="mt-1 block text-xs text-gray-500">Use the day before your first statement starts.</span></label>
                <Button className="self-end" type="submit"><PlusCircle className="h-4 w-4" />Add bank</Button>
              </form>
              </details>
            </CardContent></Card>
            <Card id="bank-import"><CardHeader><CardTitle>Import monthly bank statement</CardTitle><CardDescription>Upload the CSV once. The original is retained for seven years and the same file cannot be duplicated.</CardDescription></CardHeader><CardContent>
              {params.error?.startsWith("statement_") ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "The statement could not be imported."}</div> : null}
              {bankAccounts.length ? <form action={importBankStatement} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">Bank account<select className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3" name="bankAccountId" required>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bank_name} · {account.name}{account.account_number ? ` · ${account.account_number}` : account.account_number_last4 ? ` · ending ${account.account_number_last4}` : ""}</option>)}</select></label>
                <label className="text-sm">Period start<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" defaultValue={startDate} name="periodStart" required type="date" /></label>
                <label className="text-sm">Period end<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" defaultValue={endDate} name="periodEnd" required type="date" /></label>
                <label className="text-sm">Statement opening balance<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="openingBalance" required step="0.01" type="number" /><span className="mt-1 block text-xs text-gray-500">Copy the opening balance printed on this statement.</span></label>
                <label className="text-sm">Statement closing balance<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="closingBalance" required step="0.01" type="number" /><span className="mt-1 block text-xs text-gray-500">Copy the final balance printed on this statement.</span></label>
                <input name="statementDate" type="hidden" value={endDate} />
                <label className="text-sm sm:col-span-2">CSV statement<input accept=".csv,text/csv" className="mt-1 block w-full rounded-md border border-[#d7dde5] bg-white p-2 text-sm" name="statement" required type="file" /></label>
                <Button className="sm:col-span-2" type="submit"><Upload className="h-4 w-4" />Import this monthly statement</Button>
              </form> : <p className="text-sm text-gray-600">Add your first bank account before importing a statement.</p>}
            </CardContent></Card>
          </div>

          {statementImports.length ? <Card><CardHeader><CardTitle>Statements</CardTitle><CardDescription>Select a statement to match and reconcile.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">
            {statementImports.map((statement) => { const account = bankAccounts.find((item) => item.id === statement.bank_account_id); return <Button asChild key={statement.id} variant={statement.id === selectedStatementId ? "default" : "outline"}><Link href={tabHref("bank", selectedMonth, selectedPropertyId, statement.id)}>{account?.bank_name ?? "Bank"} · {dateLabel(statement.period_end)} <Badge className={statusClasses[statement.status] ?? ""}>{statement.status.replaceAll("_", " ")}</Badge></Link></Button>; })}
          </CardContent></Card> : null}

          {selectedStatement ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                {[
                  { label: "Bank account", value: statementAccount ? `${statementAccount.bank_name} · ${statementAccount.name}${statementAccount.account_number ? ` · ${statementAccount.account_number}` : ""}` : "Bank", icon: Building2, warn: false },
                  { label: "Opening", value: money(selectedStatement.opening_balance), icon: WalletCards, warn: false },
                  { label: "Money in", value: money(statementLines.filter((line) => Number(line.amount) > 0).reduce((sum, line) => sum + Number(line.amount), 0)), icon: ArrowDownLeft, warn: false },
                  { label: "Money out", value: money(Math.abs(statementLines.filter((line) => Number(line.amount) < 0).reduce((sum, line) => sum + Number(line.amount), 0))), icon: ArrowUpRight, warn: false },
                  { label: "Closing", value: money(selectedStatement.closing_balance), icon: Landmark, warn: false },
                  { label: "Difference", value: money(statementDifference), icon: Scale, warn: Math.abs(statementDifference) > 0.005 },
                ].map((summary) => { const Icon = summary.icon; return <Card key={summary.label}><CardHeader className="pb-3"><CardDescription>{summary.label}</CardDescription><CardTitle className={`text-lg ${summary.warn ? "text-red-600" : ""}`}>{summary.value}</CardTitle><Icon className="mt-2 h-4 w-4 text-[#9a6b19]" /></CardHeader></Card>; })}
              </div>

              <Card id="bank-transactions">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><CardTitle>Transactions to review</CardTitle><CardDescription>{unmatchedCount} still need attention. Open only one line at a time.</CardDescription></div>
                  {selectedStatement.status === "in_progress" ? <div className="flex flex-wrap gap-2"><form action={autoMatchStatement}><input name="statementId" type="hidden" value={selectedStatement.id} /><Button type="submit" variant="outline"><Sparkles className="h-4 w-4" />Auto-link safe matches</Button></form><form action={finalizeBankReconciliation}><input name="statementId" type="hidden" value={selectedStatement.id} /><Button disabled={unmatchedCount > 0 || Math.abs(statementDifference) > 0.005} type="submit"><BadgeCheck className="h-4 w-4" />Finalise whole statement</Button></form></div> : <Badge className="bg-emerald-100 text-emerald-800">Reconciled and locked</Badge>}
                </CardHeader>
                <CardContent className="space-y-4">
                  {params.auto_matched !== undefined ? Number(params.auto_matched) > 0 ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      Linked {Number(params.auto_matched)} exact bank {Number(params.auto_matched) === 1 ? "transaction" : "transactions"}. Existing payments and paid invoices were linked only; no duplicate payment was created.
                    </div>
                  ) : (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      No additional exact matches were safe to link. Press <strong>Open</strong> on a transaction and choose its recorded payment, paid invoice or accounting category.
                    </div>
                  ) : null}
                  {statementLines.map((line) => {
                    const lineMatches = matchesByLine.get(line.id) ?? [];
                    const matchedAmount = lineMatches.reduce((total, match) => total + Number(match.matched_amount ?? 0), 0);
                    const remaining = Number(line.amount) - matchedAmount;
                    const locationHint = bankRoomHint(line.description);
                    const descriptionParts = line.description.split(" · ").filter(Boolean);
                    const transactionLabel = descriptionParts[0] || "Bank transaction";
                    const transactionDetails = descriptionParts.slice(1).join(" · ");
                    const suggestedInvoice = locationHint
                      ? invoiceOptions.find((bill) => bill.propertyCode === locationHint.propertyCode && bill.roomCode === locationHint.roomCode)
                      : null;
                    const invoiceChoices = suggestedInvoice
                      ? [suggestedInvoice, ...invoiceOptions.filter((bill) => bill.id !== suggestedInvoice.id)]
                      : invoiceOptions;
                    const availableCandidates = candidates.filter((candidate) => {
                      const key = `${candidate.sourceType}:${candidate.sourceId}`;
                      const available = Math.abs(candidate.amount) - (consumed.get(key) ?? 0);
                      return Math.sign(candidate.amount) === Math.sign(remaining) && available > 0.005;
                    }).sort((left, right) => {
                      const leftHint = bankRoomHint(left.description);
                      const rightHint = bankRoomHint(right.description);
                      const leftScore = locationHint && leftHint?.propertyCode === locationHint.propertyCode && leftHint.roomCode === locationHint.roomCode ? 1 : 0;
                      const rightScore = locationHint && rightHint?.propertyCode === locationHint.propertyCode && rightHint.roomCode === locationHint.roomCode ? 1 : 0;
                      return rightScore - leftScore;
                    }).slice(0, 150);
                    const isLineOpen = params.line === line.id;
                    return (
                      <div className="rounded-lg border border-[#d7dde5] bg-white" id={`bank-line-${line.id}`} key={line.id}>
                        <div className="grid gap-3 p-4 sm:grid-cols-[110px_1fr_150px_150px] sm:items-center">
                          <div className="text-sm"><p className="font-medium">{dateLabel(line.transaction_date)}</p><p className="text-xs text-gray-500">{line.reference_number || "No reference"}</p></div>
                          <div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-gray-950">{transactionLabel}</p>{locationHint ? <Badge className="bg-blue-100 text-blue-800">{locationHint.propertyCode} Room {locationHint.roomCode}</Badge> : null}</div><p className="mt-1 line-clamp-2 text-xs text-gray-600">{transactionDetails || "No additional bank description"}</p></div>
                          <div className="text-right"><p className={`font-semibold ${Number(line.amount) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{Number(line.amount) >= 0 ? "+" : "-"}{money(Math.abs(Number(line.amount)))}</p><p className="text-xs text-gray-500">{Number(line.amount) >= 0 ? "Money received" : "Money paid out"}</p></div>
                          <div className="flex flex-col items-stretch gap-2 sm:items-end"><Badge className={statusClasses[line.status] ?? ""}>{line.status === "unmatched" ? "Needs review" : line.status}</Badge><Button asChild size="sm" variant={isLineOpen ? "outline" : "default"}><Link href={bankLineHref(selectedMonth, selectedPropertyId, selectedStatement.id, isLineOpen ? undefined : line.id)}>{isLineOpen ? "Close" : "Open"}</Link></Button></div>
                        </div>
                        {isLineOpen ? <div className="border-t border-[#d7dde5] bg-gray-50 p-4">
                          {lineMatches.length ? <div className="mb-4 space-y-2">{lineMatches.map((match) => { const candidate = candidateMap.get(`${match.source_type}:${match.source_id}`); return <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" key={match.id}><span><strong>{match.match_method.replaceAll("_", " ")}</strong> · {candidate?.description ?? match.source_type.replaceAll("_", " ")} · {money(match.matched_amount)}</span>{selectedStatement.status === "in_progress" ? <form action={unmatchBankLine}><input name="matchId" type="hidden" value={match.id} /><Button size="sm" type="submit" variant="outline">Unmatch</Button></form> : null}</div>; })}</div> : null}
                          {selectedStatement.status === "in_progress" && line.status === "unmatched" ? <div className="grid gap-4 xl:grid-cols-3">
                            <form action={matchBankLine} className="space-y-3 rounded-lg border border-[#d7dde5] bg-white p-4">
                              <div><p className="font-semibold">Match existing transaction</p><p className="text-xs text-gray-500">Split or merge is automatic when amounts differ.</p></div>
                              <input name="lineId" type="hidden" value={line.id} />
                              <select className="h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm" defaultValue="" name="sourceToken" required><option disabled value="">Choose transaction</option>{availableCandidates.map((candidate) => <option key={`${candidate.sourceType}:${candidate.sourceId}`} value={`${candidate.sourceType}:${candidate.sourceId}`}>{dateLabel(candidate.date)} · {money(candidate.amount)} · {candidate.description}</option>)}</select>
                              <Button className="w-full" type="submit" variant="outline"><Link2 className="h-4 w-4" />Match</Button>
                            </form>
                            {remaining > 0.005 ? <form action={createTenantPaymentFromBankLine} className="space-y-3 rounded-lg border-2 border-[#b8892c] bg-[#fffaf0] p-4">
                              <div><p className="font-semibold">Tenant paid but did not upload a slip</p><p className="text-xs text-gray-600">Use only for a real unmatched bank receipt. DEKEZ records the payment, knocks off the invoice and retains the statement as proof.</p></div>
                              <input name="lineId" type="hidden" value={line.id} />
                              {suggestedInvoice ? <p className="rounded-md bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">Suggested from QR code: {suggestedInvoice.propertyCode} Room {suggestedInvoice.roomCode} · {suggestedInvoice.tenantName}</p> : null}
                              <label className="block text-xs font-medium">Tenant invoice<select className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={suggestedInvoice?.id ?? ""} name="rentBillId" required><option disabled value="">Choose invoice</option>{invoiceChoices.map((bill) => <option key={bill.id} value={bill.id}>{bill.id === suggestedInvoice?.id ? "Recommended · " : ""}{bill.tenantName} · {bill.propertyName} / {bill.roomName} · {bill.invoiceNumber ?? bill.billMonth} · owing {money(bill.outstanding)}</option>)}</select></label>
                              <div className="grid grid-cols-3 gap-2"><label className="text-xs">Rent<input className="mt-1 h-9 w-full rounded-md border border-[#d7dde5] px-2" defaultValue={suggestedInvoice ? Math.min(Number(remaining), suggestedInvoice.rentOutstanding).toFixed(2) : undefined} min="0" name="rentalAmount" step="0.01" type="number" /></label><label className="text-xs">Deposit<input className="mt-1 h-9 w-full rounded-md border border-[#d7dde5] px-2" defaultValue={suggestedInvoice ? Math.min(Math.max(Number(remaining) - suggestedInvoice.rentOutstanding, 0), suggestedInvoice.depositOutstanding).toFixed(2) : undefined} min="0" name="depositAmount" step="0.01" type="number" /></label><label className="text-xs">Other<input className="mt-1 h-9 w-full rounded-md border border-[#d7dde5] px-2" min="0" name="otherAmount" step="0.01" type="number" /></label></div>
                              <p className="text-xs font-medium text-[#7a5618]">Allocation total must equal {money(remaining)}.</p>
                              <select className="h-9 w-full rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue="other" name="otherCategory"><option value="other">Other / extra</option><option value="top_up_utilities">Top Up Utilities</option><option value="electricity">Electricity</option><option value="water">Water</option><option value="key_lock">Key / lock</option><option value="access_card">Access card</option><option value="damage">Damage</option><option value="cleaning">Cleaning</option><option value="furniture">Furniture</option></select>
                              <input className="h-9 w-full rounded-md border border-[#d7dde5] px-2 text-sm" name="otherDescription" placeholder="Required only when Other amount is used" />
                              <Button className="w-full" type="submit"><Banknote className="h-4 w-4" />Record payment, knock off &amp; match</Button>
                            </form> : null}
                            <div className="space-y-3 rounded-lg border border-[#d7dde5] bg-white p-4">
                              <form action={createBankAdjustment} className="space-y-3"><div><p className="font-semibold">Record a missing accounting entry</p><p className="text-xs text-gray-500">Includes property rent/COGS, salary, AP/AR, fixed assets, loans, capital, transfers, bank fees, tax and other categories.</p></div><input name="lineId" type="hidden" value={line.id} /><select className="h-9 w-full rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue="" name="accountId" required><option disabled value="">Choose accounting category</option>{adjustmentAccountGroups.map((group) => <optgroup key={group.type} label={group.type.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase())}>{group.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</optgroup>)}</select><select className="h-9 w-full rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={locationHint ? properties.find((property) => propertyCode(property.name) === locationHint.propertyCode)?.id ?? "" : ""} name="propertyId"><option value="">General company / no property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select><input className="h-9 w-full rounded-md border border-[#d7dde5] px-2 text-sm" name="description" placeholder="What was this transaction for?" required /><Button className="w-full" type="submit" variant="outline">Record &amp; match</Button></form>
                              <form action={ignoreBankLine} className="space-y-2 border-t border-[#d7dde5] pt-3"><input name="lineId" type="hidden" value={line.id} /><input className="h-9 w-full rounded-md border border-[#d7dde5] px-2 text-sm" name="reason" placeholder="Audit reason to ignore" required /><Button className="w-full" type="submit" variant="ghost">Ignore with reason</Button></form>
                            </div>
                          </div> : null}
                        </div> : null}
                      </div>
                    );
                  })}
                  {!statementLines.length ? <p className="text-sm text-gray-500">No statement lines were imported.</p> : null}
                </CardContent>
              </Card>
            </>
          ) : <Card><CardContent className="pt-5"><p className="text-sm text-gray-600">Add a bank account and import a CSV statement to start reconciling.</p></CardContent></Card>}
        </div>
      ) : null}

      {tab === "ledger" ? <Card><CardHeader><CardTitle>Chart of Accounts</CardTitle><CardDescription>System accounts are mapped to existing DEKEZ invoices, deposits, payments and expenses.</CardDescription></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead>Report group</TableHead><TableHead>Normal balance</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{accounts.map((account) => <TableRow key={account.id}><TableCell className="font-mono font-semibold">{account.code}</TableCell><TableCell>{account.name}</TableCell><TableCell className="capitalize">{account.account_type}</TableCell><TableCell className="capitalize">{String(account.report_group).replaceAll("_", " ")}</TableCell><TableCell className="capitalize">{account.normal_balance}</TableCell><TableCell>{account.is_system ? <Badge>DEKEZ mapped</Badge> : "Manual"}</TableCell></TableRow>)}</TableBody></Table>
        {!accounts.length ? <p className="py-4 text-sm text-gray-500">No accounts have been created yet.</p> : null}
      </CardContent></Card> : null}
    </section>
  );
}

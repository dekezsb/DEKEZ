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
import {
  BankReceiptBatchForm,
  type ReconciliationExpense,
  type ReconciliationStaffGroup,
} from "@/components/accounting/bank-receipt-batch-form";
import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { ChartOfAccountsManager } from "@/components/accounting/chart-of-accounts-manager";
import { ManualJournalForm } from "@/components/accounting/manual-journal-form";
import { ReconciliationSubmitButton } from "@/components/accounting/reconciliation-submit-button";
import { getBankCandidates } from "@/lib/accounting/bank-candidates";
import {
  bankDescriptionKey,
  bankTenantNameMatchScore,
} from "@/lib/accounting/bank-description";
import { recurringDescriptionForMonth } from "@/lib/accounting/recurring-description";
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
  matchOwnAccountTransfer,
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
const monthFormatter = new Intl.DateTimeFormat("en-MY", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
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

function rentalMonthLabel(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}/.test(value)) return "No invoice month";
  return monthFormatter.format(new Date(`${value.slice(0, 7)}-01T00:00:00Z`));
}

function singleRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function tabHref(tab: string, month: string, propertyId: string, statementId?: string) {
  const search = new URLSearchParams({ tab, month });
  if (propertyId) search.set("property", propertyId);
  if (tab === "bank" && statementId) search.set("statement", statementId);
  return `/reports?${search.toString()}`;
}

function bankReviewPageHref(month: string, propertyId: string, statementId: string, reviewPage: number, bankFlow: "credit" | "debit") {
  const search = new URLSearchParams({ tab: "bank", month, statement: statementId, bankFlow });
  if (propertyId) search.set("property", propertyId);
  if (reviewPage > 1) search.set("reviewPage", String(reviewPage));
  return `/reports?${search.toString()}#bank-transactions`;
}

function bankFlowHref(
  month: string,
  propertyId: string,
  statementId: string,
  bankFlow: "credit" | "debit",
) {
  const search = new URLSearchParams({
    tab: "bank",
    month,
    statement: statementId,
    bankFlow,
  });
  if (propertyId) search.set("property", propertyId);
  return `/reports?${search.toString()}#bank-transactions`;
}

function bankBatchLineHref(
  month: string,
  propertyId: string,
  statementId: string,
  reviewPage: number,
  lineId: string,
) {
  const search = new URLSearchParams({
    tab: "bank",
    month,
    statement: statementId,
    bankFlow: "debit",
    batchLine: lineId,
  });
  if (propertyId) search.set("property", propertyId);
  if (reviewPage > 1) search.set("reviewPage", String(reviewPage));
  return `/reports?${search.toString()}#bank-line-${lineId}`;
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

const bankMatchStopWords = new Set([
  "monthly", "rent", "rental", "deposit", "other", "invoice", "payment", "paid",
  "room", "property", "tenant", "fund", "duitnow", "transfer", "cr", "dr", "atm", "eft",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
]);

function bankTextMatchScore(bankText: string, candidateText: string) {
  const bankTokens = new Set(bankText.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const candidateTokens = Array.from(new Set(candidateText.toLowerCase().match(/[a-z0-9]+/g) ?? []));
  return candidateTokens.filter((token) => token.length >= 2 && !bankMatchStopWords.has(token) && bankTokens.has(token)).length;
}

const errorMessages: Record<string, string> = {
  accounting_context: "Your accounting company could not be loaded.",
  bank_account_details: "Choose bank or company card, then enter the account name, institution and full account/card number (6 to 30 digits).",
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
  match_used: "That earlier accounting entry is already fully matched. Choose its recurring-month option or create this month's entry.",
  match_source_month: "Choose a receipt or payment from this statement month. An earlier manual income or expense may only be used through its recurring-month option.",
  match_location: "The bank description and tenant invoice belong to different rooms. Choose the exact property and room shown on the bank transaction.",
  match_rental_month: "Rental payments and paid invoices can only be matched to the same rental month as this bank statement.",
  match_missing: "That accounting record is no longer available. Refresh the line and choose another record.",
  match_create: "This bank match could not be saved.",
  recurring_create: "This month's recurring accounting entry could not be created.",
  recurring_match: "This month's recurring entry could not be linked to the bank payment.",
  line_complete: "This bank line is already fully reconciled. No second entry was created.",
  tenant_payment_match: "The direct tenant knock-off failed. Rent, deposit and other must equal the unmatched bank amount.",
  tenant_payment_month: "Choose the tenant invoice for the same rental month as this bank statement. Older balances cannot be carried into this match.",
  adjustment_details: "Choose an accounting category and enter a description.",
  adjustment_property: "Choose the property for a Property Rental Cost entry.",
  adjustment_create: "The accounting entry could not be created.",
  adjustment_match: "The accounting entry was created but could not be linked to this bank line. Please review it before trying again.",
  ignore_details: "Enter an audit reason before ignoring a statement line.",
  ignore_matched: "Remove existing matches before ignoring this statement line.",
  statement_unmatched: "Match, adjust or explain every bank line before finalising.",
  statement_balance: "Opening balance plus statement movements does not equal the closing balance.",
  expense_batch_details: "Choose the company receipts covered by this payment.",
  expense_batch_line: "This bank/card line is no longer available for batch reconciliation.",
  expense_batch_total: "The selected company receipts must equal the remaining statement amount exactly.",
  expense_batch_proof: "The retained statement link for this expense batch could not be saved.",
  expense_batch_create: "The combined company receipt payment could not be recorded.",
  expense_batch_match: "The receipt batch was saved, but its bank match needs review. It remains available under recorded payments.",
  paid_receipts_details: "Choose the paid company/card receipts covered by this statement charge.",
  paid_receipts_line: "This bank/card line is no longer available for receipt matching.",
  paid_receipts_total: "The selected paid receipts must be unused and equal the remaining statement amount exactly.",
  paid_receipts_match: "The paid receipt group could not be matched to this statement line.",
  staff_batch_details: "Choose one staff member and the claim receipts covered by this transfer.",
  staff_batch_line: "This bank line is no longer available for staff reimbursement.",
  staff_batch_total: "The selected claims must belong to one staff member and equal the remaining bank amount exactly.",
  staff_batch_proof: "The retained statement link for this staff payout could not be saved.",
  staff_batch_create: "The combined staff reimbursement could not be recorded.",
  staff_batch_match: "The staff payout was saved, but its bank match needs review. It remains available under recorded payments.",
  bank_transfer_details: "Choose the matching line from the other DEKEZ bank or prepaid-card statement.",
  bank_transfer_match: "The two statement lines could not be linked. Check that they are equal, opposite, from different DEKEZ accounts and both still unmatched.",
  journal_details: "Enter a journal date, description and at least two valid lines.",
  journal_lines: "The journal lines could not be read. Please review them and try again.",
  journal_balance: "Total debit and total credit must be equal, and every line must use only one side.",
  journal_period: "This accounting period is locked. Use an open period or ask the Super Admin to reopen it.",
  journal_post: "The journal could not be posted. No partial entry was saved.",
  account_details: "Enter a unique 4 to 6 digit code, account name and valid accounting category.",
  account_duplicate: "That account code already exists. Use another code.",
  account_create: "The new account could not be created.",
  account_wording: "Enter an account name between 2 and 100 characters.",
  account_missing: "That account is no longer available. Refresh the page and try again.",
  account_update: "The account wording could not be updated.",
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
  const yearStartDate = `${selectedMonth.slice(0, 4)}-01-01`;
  const priorDates = previousPeriod(startDate, endDate);
  const properties = (await getProperties()).filter((property) => property.company_id === company.id);
  const propertyIds = properties.map((property) => property.id);
  const selectedPropertyId = properties.some((property) => property.id === params.property) ? params.property ?? "" : "";
  const tab = ["overview", "profit-loss", "balance-sheet", "trial-balance", "bank", "journal", "ledger"].includes(params.tab ?? "") ? params.tab ?? "overview" : "overview";
  const bankFlow: "credit" | "debit" = params.bankFlow === "debit" ? "debit" : "credit";

  const [currentReport, priorReport, yearToDateReport, bankAccountsResult, statementsResult, accountsResult, candidates, liabilitiesResult, journalEntriesResult, depositPaymentsResult, reconciliationRulesResult] = await Promise.all([
    getProfitLossReport(supabase, { companyId: company.id, startDate, endDate, propertyId: selectedPropertyId || null }),
    getProfitLossReport(supabase, { companyId: company.id, startDate: priorDates.startDate, endDate: priorDates.endDate, propertyId: selectedPropertyId || null }),
    getProfitLossReport(supabase, { companyId: company.id, startDate: yearStartDate, endDate, propertyId: selectedPropertyId || null }),
    supabase.from("bank_accounts").select("id, name, bank_name, account_number, account_number_last4, opening_balance, opening_balance_date, is_active, accounting_account_id, accounting_accounts(code, name)").eq("company_id", company.id).eq("is_active", true).order("name"),
    supabase.from("bank_statement_imports").select("id, bank_account_id, period_start, period_end, statement_date, opening_balance, closing_balance, status, original_file_name, created_at").eq("company_id", company.id).neq("status", "void").order("period_end", { ascending: false }).limit(240),
    supabase.from("accounting_accounts").select("id, code, name, account_type, report_group, normal_balance, description, system_key, is_system, is_active").eq("company_id", company.id).eq("is_active", true).order("sort_order").order("code"),
    getBankCandidates(supabase, company.id),
    supabase.from("staff_reimbursement_liabilities").select("id, staff_id, amount, status, expense_id, owed_at, payout_id").eq("status", "owed"),
    supabase.from("accounting_journal_entries").select("id, entry_date, entry_number, source_type, reference_number, description, status, posted_at, created_at").eq("company_id", company.id).eq("status", "posted").lte("entry_date", endDate).order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("payments").select("id, amount, payment_date").eq("company_id", company.id).eq("category", "deposit").eq("status", "confirmed").is("reversed_at", null).lte("payment_date", endDate),
    supabase.from("bank_reconciliation_rules").select("id, bank_account_id, direction, bank_description_key, accounting_account_id, property_id, default_description, use_count").eq("company_id", company.id),
  ]);

  const bankAccounts = bankAccountsResult.data ?? [];
  const statementImports = statementsResult.data ?? [];
  const accounts = accountsResult.data ?? [];
  const journalEntries = journalEntriesResult.data ?? [];
  const journalEntryIds = journalEntries.map((entry) => entry.id);
  const journalLines = journalEntryIds.length
    ? (await supabase.from("accounting_journal_lines").select("id, journal_entry_id, account_id, property_id, description, debit, credit").in("journal_entry_id", journalEntryIds)).data ?? []
    : [];
  const reconciliationRuleMap = new Map((reconciliationRulesResult.data ?? []).map((rule) => [
    `${rule.bank_account_id ?? ""}:${rule.direction}:${rule.bank_description_key}`,
    rule,
  ]));
  const selectedStatementId = statementImports.some((item) => item.id === params.statement) ? params.statement ?? "" : statementImports[0]?.id ?? "";
  const selectedStatement = statementImports.find((item) => item.id === selectedStatementId) ?? null;
  const statementRentalMonth = selectedStatement?.period_start?.slice(0, 7) ?? selectedMonth;

  const { data: companyExpenses } = await supabase.from("expenses").select("id").eq("company_id", company.id);
  const companyExpenseIds = new Set((companyExpenses ?? []).map((item) => item.id));
  const staffPayable = (liabilitiesResult.data ?? [])
    .filter((item) => item.expense_id && companyExpenseIds.has(item.expense_id))
    .reduce((total, item) => total + Number(item.amount ?? 0), 0);

  const reconciliationExpenseSelect =
    "id, amount, expense_date, supplier, description, category_id, property_id, room_id, expense_categories(name), properties(name), rooms(name, room_number)";
  const [companyBatchExpensesResult, paidCompanyExpensesResult] = await Promise.all([
    supabase
      .from("expenses")
      .select(reconciliationExpenseSelect)
      .eq("company_id", company.id)
      .eq("status", "verified")
      .eq("payment_status", "unpaid")
      .in("funding_source", ["company_cash", "company_bank"])
      .order("expense_date", { ascending: true }),
    supabase
      .from("expenses")
      .select(reconciliationExpenseSelect)
      .eq("company_id", company.id)
      .eq("funding_source", "company_bank")
      .eq("payment_status", "paid")
      .in("status", ["verified", "reimbursed"])
      .order("expense_date", { ascending: true }),
  ]);
  const companyBatchRows = companyBatchExpensesResult.data ?? [];
  const paidCompanyRows = paidCompanyExpensesResult.data ?? [];
  const companyLiabilities = (liabilitiesResult.data ?? []).filter(
    (item) => item.expense_id && companyExpenseIds.has(item.expense_id),
  );
  const liabilityExpenseIds = companyLiabilities.map((item) => item.expense_id);
  const staffIds = Array.from(new Set(companyLiabilities.map((item) => item.staff_id).filter(Boolean)));
  const receiptExpenseIds = Array.from(new Set([
    ...companyBatchRows.map((item) => item.id),
    ...paidCompanyRows.map((item) => item.id),
    ...liabilityExpenseIds,
  ]));
  const paidCompanyExpenseIds = paidCompanyRows.map((item) => item.id);
  const [
    liabilityExpensesResult,
    staffProfilesResult,
    receiptAttachmentsResult,
    paidAllocationsResult,
    paidMatchesResult,
  ] = await Promise.all([
    liabilityExpenseIds.length
      ? supabase
          .from("expenses")
          .select("id, amount, expense_date, supplier, description, category_id, property_id, room_id, expense_categories(name), properties(name), rooms(name, room_number)")
          .in("id", liabilityExpenseIds)
      : Promise.resolve({ data: [] }),
    staffIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: [] }),
    receiptExpenseIds.length
      ? supabase.from("expense_attachments").select("expense_id").in("expense_id", receiptExpenseIds)
      : Promise.resolve({ data: [] }),
    paidCompanyExpenseIds.length
      ? supabase
          .from("expense_payment_allocations")
          .select("expense_id")
          .in("expense_id", paidCompanyExpenseIds)
      : Promise.resolve({ data: [] }),
    paidCompanyExpenseIds.length
      ? supabase
          .from("bank_reconciliation_matches")
          .select("source_id, matched_amount")
          .eq("source_type", "expense")
          .in("source_id", paidCompanyExpenseIds)
      : Promise.resolve({ data: [] }),
  ]);
  const receiptCounts = new Map<string, number>();
  for (const attachment of receiptAttachmentsResult.data ?? []) {
    receiptCounts.set(attachment.expense_id, (receiptCounts.get(attachment.expense_id) ?? 0) + 1);
  }
  const toReconciliationExpense = (expense: any): ReconciliationExpense => {
    const room = singleRelation(expense.rooms) as { name?: string | null; room_number?: string | null } | null;
    return {
      id: expense.id,
      amount: Number(expense.amount ?? 0),
      expenseDate: expense.expense_date,
      label: expense.supplier || expense.description || "Expense receipt",
      categoryName: (singleRelation(expense.expense_categories) as { name?: string | null } | null)?.name ?? "Other expense",
      propertyName: (singleRelation(expense.properties) as { name?: string | null } | null)?.name ?? "General company",
      roomName: room?.name || (room?.room_number ? `Room ${room.room_number}` : null),
      receiptCount: receiptCounts.get(expense.id) ?? 0,
    };
  };
  const reconciliationUnpaidCompanyExpenses = companyBatchRows.map(toReconciliationExpense);
  const allocatedPaidExpenseIds = new Set(
    (paidAllocationsResult.data ?? []).map((item) => item.expense_id),
  );
  const matchedPaidExpenseIds = new Set(
    (paidMatchesResult.data ?? [])
      .filter((item) => Math.abs(Number(item.matched_amount ?? 0)) > 0.005)
      .map((item) => item.source_id),
  );
  const reconciliationPaidCompanyExpenses = paidCompanyRows
    .filter(
      (item) =>
        !allocatedPaidExpenseIds.has(item.id) &&
        !matchedPaidExpenseIds.has(item.id),
    )
    .map(toReconciliationExpense);
  const liabilityExpenses = new Map(
    (liabilityExpensesResult.data ?? []).map((expense) => [expense.id, expense]),
  );
  const staffNames = new Map(
    (staffProfilesResult.data ?? []).map((profile) => [profile.id, profile.full_name ?? "Staff member"]),
  );
  const staffGroupMap = new Map<string, ReconciliationStaffGroup>();
  for (const liability of companyLiabilities) {
    const expense = liabilityExpenses.get(liability.expense_id);
    if (!expense) continue;
    const group: ReconciliationStaffGroup = staffGroupMap.get(liability.staff_id) ?? {
      staffId: liability.staff_id,
      staffName: staffNames.get(liability.staff_id) ?? "Staff member",
      total: 0,
      items: [],
    };
    group.total += Number(liability.amount ?? 0);
    group.items.push({
      ...toReconciliationExpense(expense),
      amount: Number(liability.amount ?? 0),
      liabilityId: liability.id,
    });
    staffGroupMap.set(liability.staff_id, group);
  }
  const reconciliationStaffGroups = Array.from(staffGroupMap.values()).sort((left, right) =>
    left.staffName.localeCompare(right.staffName),
  );

  let openBills: Array<Record<string, any>> = [];
  if (propertyIds.length) {
    const result = await supabase
      .from("rent_bills")
      .select("id, tenancy_id, tenant_record_id, tenant_id, property_id, room_id, bill_month, due_date, invoice_number, amount, deposit_amount, paid_amount, status")
      .in("property_id", propertyIds)
      .in("status", ["unpaid", "partially_paid", "payment_submitted", "paid"])
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
  const allInvoiceOptions = openBills.map((bill) => {
    const rentOutstanding = Math.max(Number(bill.amount ?? 0) + (itemTotals.get(bill.id) ?? 0) - Number(bill.paid_amount ?? 0), 0);
    const depositOutstanding = Math.max(Number(bill.deposit_amount ?? 0) - (depositPaid.get(bill.tenancy_id) ?? 0), 0);
    return {
      id: String(bill.id),
      invoiceNumber: bill.invoice_number as string | null,
      billMonth: String(bill.bill_month),
      dueDate: String(bill.due_date),
      tenantName: tenantNames.get(bill.tenant_record_id) || `Tenant ${String(bill.tenant_id ?? "").slice(0, 8)}`,
      propertyName: propertyNames.get(bill.property_id) ?? "Property",
      roomName: roomNames.get(bill.room_id) ?? "Room",
      propertyCode: propertyCode(propertyNames.get(bill.property_id) ?? ""),
      roomCode: roomCode(roomNames.get(bill.room_id) ?? ""),
      rentOutstanding,
      depositOutstanding,
      outstanding: rentOutstanding + depositOutstanding,
    };
  });
  const invoiceOptions = allInvoiceOptions.filter((bill) => bill.outstanding > 0.005);
  const statementInvoiceOptions = allInvoiceOptions.filter(
    (bill) => bill.billMonth.slice(0, 7) === statementRentalMonth,
  );
  const tenantOutstanding = invoiceOptions.reduce((total, item) => total + item.outstanding, 0);

  const journalEntryById = new Map(journalEntries.map((entry) => [entry.id, entry]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const manualNetDebitByAccount = new Map<string, number>();
  for (const line of journalLines) {
    if (selectedPropertyId && line.property_id !== selectedPropertyId) continue;
    manualNetDebitByAccount.set(
      line.account_id,
      (manualNetDebitByAccount.get(line.account_id) ?? 0) + Number(line.debit ?? 0) - Number(line.credit ?? 0),
    );
  }
  const manualNormalBalance = (systemKey: string) => {
    const account = accounts.find((item) => item.system_key === systemKey);
    if (!account) return 0;
    const netDebit = manualNetDebitByAccount.get(account.id) ?? 0;
    return account.normal_balance === "credit" ? -netDebit : netDebit;
  };
  const receivableInvoices = invoiceOptions.filter((bill) => bill.dueDate <= endDate);
  const rentalReceivable = receivableInvoices.reduce((total, bill) => total + bill.rentOutstanding, 0) + manualNormalBalance("rental_receivable");
  const depositReceivable = receivableInvoices.reduce((total, bill) => total + bill.depositOutstanding, 0) + manualNormalBalance("deposit_receivable");
  const tenantDepositsHeld = (depositPaymentsResult.data ?? []).reduce((total, payment) => total + Number(payment.amount ?? 0), 0) + manualNormalBalance("tenant_security_deposits");
  const companyPayable = companyBatchRows
    .filter((expense) => expense.expense_date <= endDate)
    .reduce((total, expense) => total + Number(expense.amount ?? 0), 0) + manualNormalBalance("accounts_payable");
  const staffPayableAsOf = companyLiabilities.reduce((total, liability) => {
    const expense = liabilityExpenses.get(liability.expense_id);
    return expense?.expense_date && expense.expense_date <= endDate
      ? total + Number(liability.amount ?? 0)
      : total;
  }, 0) + manualNormalBalance("staff_reimbursement_payable");
  const bankAccountLedgerIds = new Set(bankAccounts.map((account) => account.accounting_account_id).filter(Boolean));
  const latestStatementByBank = new Map<string, (typeof statementImports)[number]>();
  for (const statement of statementImports) {
    if (statement.period_end > endDate || latestStatementByBank.has(statement.bank_account_id)) continue;
    latestStatementByBank.set(statement.bank_account_id, statement);
  }
  let bankAssets = 0;
  let companyCardPayable = 0;
  for (const bankAccount of bankAccounts) {
    const ledgerAccount = accountById.get(bankAccount.accounting_account_id);
    const statement = latestStatementByBank.get(bankAccount.id);
    const balance = statement
      ? Number(statement.closing_balance ?? 0)
      : bankAccount.opening_balance_date && bankAccount.opening_balance_date <= endDate
        ? Number(bankAccount.opening_balance ?? 0)
        : 0;
    if (ledgerAccount?.account_type === "liability") companyCardPayable += Math.abs(balance);
    else bankAssets += balance;
  }
  bankAssets += manualNormalBalance("cash_on_hand");

  const operationalSystemKeys = new Set([
    "cash_on_hand", "company_bank", "bank_transfer_clearing", "rental_receivable",
    "deposit_receivable", "other_receivable", "accounts_payable",
    "staff_reimbursement_payable", "tenant_security_deposits", "tenant_credits",
  ]);
  const otherBalanceRows = accounts.flatMap((account) => {
    if (!["asset", "liability", "equity"].includes(account.account_type)) return [];
    if (operationalSystemKeys.has(account.system_key ?? "") || bankAccountLedgerIds.has(account.id)) return [];
    const netDebit = manualNetDebitByAccount.get(account.id) ?? 0;
    const amount = account.normal_balance === "credit" ? -netDebit : netDebit;
    return Math.abs(amount) > 0.005 ? [{ key: account.id, code: account.code, label: account.name, amount, source: "Posted journals" }] : [];
  });
  const otherCurrentAssets = otherBalanceRows.filter((row) => accountById.get(row.key)?.report_group === "current_asset");
  const otherNonCurrentAssets = otherBalanceRows.filter((row) => accountById.get(row.key)?.report_group === "non_current_asset");
  const otherCurrentLiabilities = otherBalanceRows.filter((row) => accountById.get(row.key)?.report_group === "current_liability");
  const otherNonCurrentLiabilities = otherBalanceRows.filter((row) => accountById.get(row.key)?.report_group === "non_current_liability");
  const manualEquityRows = otherBalanceRows.filter((row) => accountById.get(row.key)?.account_type === "equity");
  const balanceAssets = [
    { key: "bank", code: "1000-1099", label: "Bank and cash", amount: bankAssets, source: "Latest imported statement / cash journals" },
    { key: "rent-ar", code: "1100", label: "Rental receivables (tenant owing)", amount: rentalReceivable, source: `${receivableInvoices.length} open invoices due by ${dateLabel(endDate)}` },
    { key: "deposit-ar", code: "1110", label: "Deposit receivables", amount: depositReceivable, source: "Unpaid tenant deposits" },
    ...otherCurrentAssets,
    ...otherNonCurrentAssets,
  ].filter((row) => Math.abs(row.amount) > 0.005);
  const balanceLiabilities = [
    { key: "company-ap", code: "2000", label: "Accounts payable (company bills)", amount: companyPayable, source: "Verified bills not yet paid" },
    { key: "staff-ap", code: "2100", label: "Staff reimbursement payable", amount: staffPayableAsOf, source: "Approved claims not yet reimbursed" },
    { key: "tenant-deposits", code: "2200", label: "Tenant security deposits held", amount: tenantDepositsHeld, source: "Confirmed deposit receipts" },
    { key: "company-cards", code: "2401+", label: "Company card payable", amount: companyCardPayable, source: "Latest imported card statement" },
    ...otherCurrentLiabilities,
    ...otherNonCurrentLiabilities,
  ].filter((row) => Math.abs(row.amount) > 0.005);
  const balanceEquity = [
    ...manualEquityRows,
    { key: "current-earnings", code: "YTD", label: "Current-year profit / (loss)", amount: yearToDateReport.netProfit, source: `${dateLabel(yearStartDate)} to ${dateLabel(endDate)}` },
  ].filter((row) => Math.abs(row.amount) > 0.005);
  const totalAssets = balanceAssets.reduce((total, row) => total + row.amount, 0);
  const totalLiabilities = balanceLiabilities.reduce((total, row) => total + row.amount, 0);
  const totalEquity = balanceEquity.reduce((total, row) => total + row.amount, 0);
  const balanceSheetDifference = totalAssets - totalLiabilities - totalEquity;

  const trialRows = [
    ...balanceAssets.map((row) => ({ code: row.code, label: row.label, debit: Math.max(row.amount, 0), credit: Math.max(-row.amount, 0), source: row.source })),
    ...balanceLiabilities.map((row) => ({ code: row.code, label: row.label, debit: Math.max(-row.amount, 0), credit: Math.max(row.amount, 0), source: row.source })),
    ...manualEquityRows.map((row) => ({ code: row.code, label: row.label, debit: Math.max(-row.amount, 0), credit: Math.max(row.amount, 0), source: row.source })),
    ...yearToDateReport.revenue.map((row) => ({ code: "4xxx", label: row.label, debit: Math.max(-row.amount, 0), credit: Math.max(row.amount, 0), source: "Invoices / posted journals" })),
    ...yearToDateReport.costsOfSales.map((row) => ({ code: "5xxx", label: row.label, debit: Math.max(row.amount, 0), credit: Math.max(-row.amount, 0), source: "Verified bills / posted journals" })),
    ...yearToDateReport.expenses.map((row) => ({ code: "5xxx", label: row.label, debit: Math.max(row.amount, 0), credit: Math.max(-row.amount, 0), source: "Verified bills / posted journals" })),
  ];
  const trialDebitBeforeConversion = trialRows.reduce((total, row) => total + row.debit, 0);
  const trialCreditBeforeConversion = trialRows.reduce((total, row) => total + row.credit, 0);
  const conversionDifference = trialDebitBeforeConversion - trialCreditBeforeConversion;
  const conversionRow = Math.abs(conversionDifference) > 0.005
    ? { code: "OPENING", label: "Opening / conversion balance still to post", debit: Math.max(-conversionDifference, 0), credit: Math.max(conversionDifference, 0), source: "Post a journal after checking prior-year/opening records" }
    : null;
  const balancedTrialRows = conversionRow ? [...trialRows, conversionRow] : trialRows;
  const trialDebit = balancedTrialRows.reduce((total, row) => total + row.debit, 0);
  const trialCredit = balancedTrialRows.reduce((total, row) => total + row.credit, 0);
  const journalLinesByEntry = new Map<string, typeof journalLines>();
  for (const line of journalLines) {
    const entryLines = journalLinesByEntry.get(line.journal_entry_id) ?? [];
    entryLines.push(line);
    journalLinesByEntry.set(line.journal_entry_id, entryLines);
  }

  const statementLines = selectedStatementId
    ? (await supabase.from("bank_statement_lines").select("id, bank_account_id, transaction_date, value_date, description, reference_number, amount, status, ignored_reason").eq("statement_import_id", selectedStatementId).order("transaction_date").order("id")).data ?? []
    : [];
  const otherBankAccountIds = bankAccounts
    .filter((account) => account.id !== selectedStatement?.bank_account_id)
    .map((account) => account.id);
  const transferCounterpartLines = selectedStatementId && otherBankAccountIds.length
    ? (await supabase
        .from("bank_statement_lines")
        .select("id, bank_account_id, statement_import_id, transaction_date, description, reference_number, amount, status, bank_statement_imports!inner(period_start, period_end, status, company_id)")
        .in("bank_account_id", otherBankAccountIds)
        .eq("status", "unmatched")
        .eq("bank_statement_imports.company_id", company.id)
        .eq("bank_statement_imports.status", "in_progress")
        .order("transaction_date", { ascending: false })
        .limit(1000)).data ?? []
    : [];
  const lineIds = statementLines.map((line) => line.id);
  const matches = lineIds.length
    ? (await supabase.from("bank_reconciliation_matches").select("id, statement_line_id, source_type, source_id, matched_amount, match_method, created_at, created_by").in("statement_line_id", lineIds)).data ?? []
    : [];
  const sourceMatches = candidates.length
    ? (await supabase.from("bank_reconciliation_matches").select("source_type, source_id, matched_amount")).data ?? []
    : [];
  const matchesByLine = new Map<string, typeof matches>();
  for (const match of matches) {
    const values = matchesByLine.get(match.statement_line_id) ?? [];
    values.push(match);
    matchesByLine.set(match.statement_line_id, values);
  }
  const candidateMap = new Map(candidates.map((item) => [`${item.sourceType}:${item.sourceId}`, item]));
  const consumed = new Map<string, number>();
  for (const match of sourceMatches) {
    const key = `${match.source_type}:${match.source_id}`;
    consumed.set(key, (consumed.get(key) ?? 0) + Math.abs(Number(match.matched_amount ?? 0)));
  }
  const statementMovement = statementLines.reduce((total, line) => total + Number(line.amount ?? 0), 0);
  const statementDifference = selectedStatement ? Number(selectedStatement.opening_balance ?? 0) + statementMovement - Number(selectedStatement.closing_balance ?? 0) : 0;
  const unmatchedLines = statementLines.filter((line) => line.status === "unmatched");
  const unmatchedCount = unmatchedLines.length;
  const creditLines = unmatchedLines.filter((line) => Number(line.amount) > 0);
  const debitLines = unmatchedLines.filter((line) => Number(line.amount) < 0);
  const selectedFlowLines = bankFlow === "credit" ? creditLines : debitLines;
  const hasSafeSuggestedMatch = (line: (typeof selectedFlowLines)[number]) => {
    const lineMatches = matchesByLine.get(line.id) ?? [];
    const matchedAmount = lineMatches.reduce((total, match) => total + Number(match.matched_amount ?? 0), 0);
    const remaining = Number(line.amount) - matchedAmount;
    const locationHint = bankRoomHint(line.description);
    const candidatePool = candidates.filter((candidate) => {
      const key = `${candidate.sourceType}:${candidate.sourceId}`;
      const isRecurringTemplate = candidate.sourceType === "manual_bank_transaction"
        && candidate.date.slice(0, 7) !== statementRentalMonth;
      const available = isRecurringTemplate
        ? Math.abs(candidate.amount)
        : Math.abs(candidate.amount) - (consumed.get(key) ?? 0);
      return Math.sign(candidate.amount) === Math.sign(remaining)
        && available > 0.005
        && (!candidate.isRental || candidate.invoiceMonth?.slice(0, 7) === statementRentalMonth)
        && (isRecurringTemplate || candidate.date.slice(0, 7) === statementRentalMonth);
    });
    const exactAmountCandidates = candidatePool.filter((candidate) => {
      const key = `${candidate.sourceType}:${candidate.sourceId}`;
      const isRecurringTemplate = candidate.sourceType === "manual_bank_transaction"
        && candidate.date.slice(0, 7) !== statementRentalMonth;
      const available = isRecurringTemplate
        ? Math.abs(candidate.amount)
        : Math.abs(candidate.amount) - (consumed.get(key) ?? 0);
      return Math.abs(available - Math.abs(remaining)) < 0.005;
    });
    const amountScopedCandidates = exactAmountCandidates.length ? exactAmountCandidates : candidatePool;
    const recommendationPool = locationHint
      ? amountScopedCandidates.filter((candidate) => {
          const hint = bankRoomHint(candidate.description);
          return hint?.propertyCode === locationHint.propertyCode
            && hint.roomCode === locationHint.roomCode
            && candidate.isRental
            && bankTenantNameMatchScore(line.description, candidate.tenantName) > 0;
        })
      : amountScopedCandidates;
    const rankedCandidates = recommendationPool
      .map((candidate) => ({
        candidate,
        score: bankTextMatchScore(line.description, candidate.description),
        tenantNameScore: candidate.isRental
          ? bankTenantNameMatchScore(line.description, candidate.tenantName)
          : 0,
      }))
      .sort((left, right) => locationHint
        ? right.tenantNameScore - left.tenantNameScore
        : right.score - left.score);
    return locationHint
      ? rankedCandidates[0]?.tenantNameScore > 0
        && rankedCandidates[0].tenantNameScore > (rankedCandidates[1]?.tenantNameScore ?? 0)
      : rankedCandidates[0]?.score >= 2
        && rankedCandidates[0].score > (rankedCandidates[1]?.score ?? 0);
  };
  const prioritizedFlowLines = selectedFlowLines
    .map((line, originalIndex) => ({ line, originalIndex, hasSafeMatch: hasSafeSuggestedMatch(line) }))
    .sort((left, right) => Number(right.hasSafeMatch) - Number(left.hasSafeMatch) || left.originalIndex - right.originalIndex);
  const safeSuggestedCount = prioritizedFlowLines.filter((item) => item.hasSafeMatch).length;
  const manualReviewCount = prioritizedFlowLines.length - safeSuggestedCount;
  const reviewPageSize = 20;
  const reviewPageCount = Math.max(1, Math.ceil(prioritizedFlowLines.length / reviewPageSize));
  const requestedReviewPage = Number(params.reviewPage ?? "1");
  const reviewPage = Number.isInteger(requestedReviewPage) ? Math.min(Math.max(requestedReviewPage, 1), reviewPageCount) : 1;
  const reviewLines = prioritizedFlowLines
    .slice((reviewPage - 1) * reviewPageSize, reviewPage * reviewPageSize)
    .map((item) => item.line);
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
    { key: "balance-sheet", label: "Balance Sheet", icon: WalletCards },
    { key: "trial-balance", label: "Trial Balance", icon: ReceiptText },
    { key: "bank", label: "Bank Reconciliation", icon: Landmark },
    { key: "journal", label: "Journal Entries", icon: BookOpen },
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
      {params.account_created ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">New chart account added. It is now available in journals and bank reconciliation.</div> : null}
      {params.account_updated ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Account wording updated. Existing transactions stayed linked to the same account.</div> : null}

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
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle>Profit &amp; Loss Statement</CardTitle><CardDescription>{dateLabel(startDate)} to {dateLabel(endDate)} · accrual basis · deposits excluded from income</CardDescription></div>
            <CsvDownloadButton
              fileName={`DEKEZ-profit-and-loss-${startDate}-to-${endDate}.csv`}
              label="Download P&L CSV"
              rows={[
                ["DEKEZ Profit & Loss", `${startDate} to ${endDate}`, "Accrual basis"],
                ["Section", "Account", "Current RM", "Previous RM", "Difference RM"],
                ...currentReport.revenue.map((row) => { const previous = priorReport.revenue.find((item) => item.key === row.key)?.amount ?? 0; return ["Revenue", row.label, row.amount.toFixed(2), previous.toFixed(2), (row.amount - previous).toFixed(2)]; }),
                ["Revenue", "Total revenue", currentReport.totalRevenue.toFixed(2), priorReport.totalRevenue.toFixed(2), (currentReport.totalRevenue - priorReport.totalRevenue).toFixed(2)],
                ...currentReport.costsOfSales.map((row) => { const previous = priorReport.costsOfSales.find((item) => item.key === row.key)?.amount ?? 0; return ["Cost of sales", row.label, row.amount.toFixed(2), previous.toFixed(2), (row.amount - previous).toFixed(2)]; }),
                ["Cost of sales", "Gross profit", currentReport.grossProfit.toFixed(2), priorReport.grossProfit.toFixed(2), (currentReport.grossProfit - priorReport.grossProfit).toFixed(2)],
                ...currentReport.expenses.map((row) => { const previous = priorReport.expenses.find((item) => item.key === row.key)?.amount ?? 0; return ["Operating expenses", row.label, row.amount.toFixed(2), previous.toFixed(2), (row.amount - previous).toFixed(2)]; }),
                ["Operating expenses", "Total expenses", currentReport.totalExpenses.toFixed(2), priorReport.totalExpenses.toFixed(2), (currentReport.totalExpenses - priorReport.totalExpenses).toFixed(2)],
                ["Result", "Net profit / (loss)", currentReport.netProfit.toFixed(2), priorReport.netProfit.toFixed(2), (currentReport.netProfit - priorReport.netProfit).toFixed(2)],
              ]}
            />
          </CardHeader>
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

      {tab === "balance-sheet" ? (
        <div className="space-y-5">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><CardTitle>Balance Sheet</CardTitle><CardDescription>As at {dateLabel(endDate)} · accrual basis · shows who owes DEKEZ and what DEKEZ still owes.</CardDescription></div>
              <CsvDownloadButton
                fileName={`DEKEZ-balance-sheet-${endDate}.csv`}
                label="Download balance sheet CSV"
                rows={[
                  ["DEKEZ Balance Sheet", `As at ${endDate}`],
                  ["Section", "Code", "Account", "Amount RM", "Source"],
                  ...balanceAssets.map((row) => ["Assets", row.code, row.label, row.amount.toFixed(2), row.source]),
                  ["Assets", "", "Total Assets", totalAssets.toFixed(2), ""],
                  ...balanceLiabilities.map((row) => ["Liabilities", row.code, row.label, row.amount.toFixed(2), row.source]),
                  ["Liabilities", "", "Total Liabilities", totalLiabilities.toFixed(2), ""],
                  ...balanceEquity.map((row) => ["Equity", row.code, row.label, row.amount.toFixed(2), row.source]),
                  ["Equity", "", "Total Equity", totalEquity.toFixed(2), ""],
                  ["Control", "", "Unbalanced / opening data still to post", balanceSheetDifference.toFixed(2), "Must be RM0.00 before audit finalisation"],
                ]}
              />
            </CardHeader>
            <CardContent className="space-y-5">
              {selectedPropertyId ? <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">The property filter is active. Tenant and journal balances are filtered, but bank accounts remain company-level because one bank account serves several properties.</div> : null}
              <div className="grid gap-5 xl:grid-cols-3">
                <BalanceSection rows={balanceAssets} title="Assets" total={totalAssets} tone="emerald" />
                <BalanceSection rows={balanceLiabilities} title="Liabilities" total={totalLiabilities} tone="red" />
                <BalanceSection rows={balanceEquity} title="Equity" total={totalEquity} tone="blue" />
              </div>
              <div className={`rounded-lg border px-4 py-4 ${Math.abs(balanceSheetDifference) < 0.005 ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><strong>{Math.abs(balanceSheetDifference) < 0.005 ? "Balance sheet balances" : "Opening / conversion balance still needs a journal"}</strong><span className="text-lg font-bold">Difference {money(balanceSheetDifference)}</span></div>
                <p className="mt-2 text-xs">Before year-end audit finalisation this difference must be RM0.00. Use a balanced journal only after checking opening bank, loan, fixed-asset, AP and AR records.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "trial-balance" ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle>Trial Balance</CardTitle><CardDescription>{dateLabel(yearStartDate)} to {dateLabel(endDate)} · audit control report showing debit and credit separately.</CardDescription></div>
            <CsvDownloadButton
              fileName={`DEKEZ-trial-balance-${endDate}.csv`}
              label="Download trial balance CSV"
              rows={[
                ["DEKEZ Trial Balance", `${yearStartDate} to ${endDate}`],
                ["Code", "Account", "Debit RM", "Credit RM", "Source"],
                ...balancedTrialRows.map((row) => [row.code, row.label, row.debit.toFixed(2), row.credit.toFixed(2), row.source]),
                ["", "TOTAL", trialDebit.toFixed(2), trialCredit.toFixed(2), ""],
              ]}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            {conversionRow ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><strong>Conversion balance detected: {money(Math.abs(conversionDifference))}.</strong> The table shows it separately so the totals balance, but it is not hidden. Check prior opening balances and post the correct journal before giving the final report to your auditor.</div> : <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Debit equals credit. The trial balance control is clear.</div>}
            <Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader><TableBody>
              {balancedTrialRows.map((row) => <TableRow className={row.code === "OPENING" ? "bg-red-50 text-red-800" : ""} key={`${row.code}-${row.label}`}><TableCell className="font-mono font-semibold">{row.code}</TableCell><TableCell>{row.label}</TableCell><TableCell className="text-xs text-gray-500">{row.source}</TableCell><TableCell className="text-right">{row.debit ? money(row.debit) : "-"}</TableCell><TableCell className="text-right">{row.credit ? money(row.credit) : "-"}</TableCell></TableRow>)}
              <TableRow className="border-t-2 border-gray-900 bg-gray-50 text-base font-bold"><TableCell colSpan={3}>TOTAL</TableCell><TableCell className="text-right">{money(trialDebit)}</TableCell><TableCell className="text-right">{money(trialCredit)}</TableCell></TableRow>
            </TableBody></Table>
          </CardContent>
        </Card>
      ) : null}

      {tab === "journal" ? (
        <div className="space-y-5">
          {params.journal_posted ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Balanced journal posted successfully. It is included in the reports and permanent audit trail.</div> : null}
          <Card><CardHeader><CardTitle>Post Manual Journal Entry</CardTitle><CardDescription>Use for salary accruals, loans, fixed assets, AP/AR corrections, depreciation, capital and year-end adjustments. Debit must equal credit.</CardDescription></CardHeader><CardContent><ManualJournalForm accounts={accounts.map((account) => ({ id: account.id, code: account.code, name: account.name, accountType: account.account_type }))} defaultEntryDate={endDate} properties={properties.map((property) => ({ id: property.id, name: property.name }))} /></CardContent></Card>
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><CardTitle>Posted Journal Register</CardTitle><CardDescription>Posted entries cannot silently change. Corrections should be made with a separate reversing journal.</CardDescription></div>
              <CsvDownloadButton
                fileName={`DEKEZ-journal-register-to-${endDate}.csv`}
                label="Download journal CSV"
                rows={[
                  ["Entry Date", "Entry No", "Reference", "Entry Description", "Account Code", "Account", "Property", "Line Description", "Debit RM", "Credit RM", "Status"],
                  ...journalLines.map((line) => {
                    const entry = journalEntryById.get(line.journal_entry_id);
                    const account = accountById.get(line.account_id);
                    return [entry?.entry_date ?? "", entry?.entry_number ?? "", entry?.reference_number ?? "", entry?.description ?? "", account?.code ?? "", account?.name ?? "", propertyNames.get(line.property_id ?? "") ?? "General company", line.description ?? "", Number(line.debit ?? 0).toFixed(2), Number(line.credit ?? 0).toFixed(2), entry?.status ?? ""];
                  }),
                ]}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {journalEntries.slice(0, 100).map((entry) => {
                const entryLines = journalLinesByEntry.get(entry.id) ?? [];
                const total = entryLines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
                return <details className="rounded-lg border border-[#d7dde5] bg-white" key={entry.id}><summary className="cursor-pointer list-none px-4 py-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><span className="font-mono text-xs font-semibold text-[#7a5618]">{entry.entry_number}</span><p className="mt-1 font-semibold text-gray-950">{entry.description}</p><p className="mt-1 text-xs text-gray-500">{dateLabel(entry.entry_date)} · {entry.reference_number || "No reference"} · {entry.source_type.replaceAll("_", " ")}</p></div><div className="flex items-center gap-2"><Badge className="bg-emerald-100 text-emerald-800">posted</Badge><strong>{money(total)}</strong></div></div></summary><div className="border-t border-[#d7dde5] px-4 py-3"><Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Property</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader><TableBody>{entryLines.map((line) => { const account = accountById.get(line.account_id); return <TableRow key={line.id}><TableCell><span className="font-mono text-xs">{account?.code}</span> · {account?.name ?? "Account"}</TableCell><TableCell>{propertyNames.get(line.property_id ?? "") ?? "General company"}</TableCell><TableCell>{line.description || "-"}</TableCell><TableCell className="text-right">{Number(line.debit) ? money(line.debit) : "-"}</TableCell><TableCell className="text-right">{Number(line.credit) ? money(line.credit) : "-"}</TableCell></TableRow>; })}</TableBody></Table></div></details>;
              })}
              {!journalEntries.length ? <p className="rounded-md bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">No posted manual journals yet.</p> : null}
            </CardContent>
          </Card>
        </div>
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
                    ["One transfer/card charge covers many receipts", "Open several receipts / company-card bills", "Ticks many claim receipts, verifies the total, and creates one audited settlement link."],
                    ["Tenant paid, but did not upload a slip", "Record payment, knock off & match", "Creates one verified payment, reduces the invoice and matches the bank receipt."],
                    ["Bank fee, interest or genuine missing accounting entry", "Create bank adjustment", "Creates the missing income or expense and matches it."],
                    ["Transfer between your own bank and prepaid-card accounts", "Match own-account transfer", "Links both statement sides without creating income or expense."],
                    ["Duplicate or not a company transaction", "Ignore with audit reason", "Explains why the line is excluded. A reason is permanently retained."],
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
                <label className="text-sm">Account type<select className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3" defaultValue="bank" name="accountKind"><option value="bank">Bank account (asset)</option><option value="prepaid_card">Prepaid / top-up card (asset)</option><option value="company_card">Credit card amount owing (liability)</option></select></label>
                <label className="text-sm">Account name<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="name" placeholder="Public Bank Current" required /></label>
                <label className="text-sm">Bank / card issuer<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="bankName" placeholder="Public Bank" required /></label>
                <label className="text-sm">Full account / card number<input autoComplete="off" className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" inputMode="numeric" maxLength={30} minLength={6} name="accountNumber" pattern="[0-9 -]{6,30}" placeholder="Enter complete number" required /></label>
                <label className="text-sm">Starting statement balance<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="openingBalance" step="0.01" type="number" /><span className="mt-1 block text-xs text-gray-500">Use the actual bank/prepaid-card balance. For a true credit card, enter the amount owing.</span></label>
                <label className="text-sm">Balance date<input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" name="openingBalanceDate" type="date" /><span className="mt-1 block text-xs text-gray-500">Use the day before your first statement starts.</span></label>
                <Button className="self-end" type="submit"><PlusCircle className="h-4 w-4" />Add account</Button>
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

              <div className="grid gap-4 lg:grid-cols-2">
                <Link
                  className={`rounded-xl border-2 p-5 transition ${
                    bankFlow === "credit"
                      ? "border-emerald-500 bg-emerald-50 shadow-sm"
                      : "border-[#d7dde5] bg-white hover:border-emerald-300"
                  }`}
                  href={bankFlowHref(selectedMonth, selectedPropertyId, selectedStatement.id, "credit")}
                  prefetch={false}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="flex items-center gap-2 text-lg font-semibold text-emerald-900"><ArrowDownLeft className="h-5 w-5" />Credit / Money In</p>
                      <p className="mt-2 text-sm text-emerald-800">Tenant rent, deposits and other money received. Match these only to receipts and paid invoices.</p>
                    </div>
                    <Badge className="bg-emerald-700 text-white">{creditLines.length} to match</Badge>
                  </div>
                </Link>
                <Link
                  className={`rounded-xl border-2 p-5 transition ${
                    bankFlow === "debit"
                      ? "border-red-400 bg-red-50 shadow-sm"
                      : "border-[#d7dde5] bg-white hover:border-red-300"
                  }`}
                  href={bankFlowHref(selectedMonth, selectedPropertyId, selectedStatement.id, "debit")}
                  prefetch={false}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="flex items-center gap-2 text-lg font-semibold text-red-900"><ArrowUpRight className="h-5 w-5" />Debit / Money Out</p>
                      <p className="mt-2 text-sm text-red-800">Expenses, company-card charges and staff payments. One debit can clear several bills or claim receipts.</p>
                    </div>
                    <Badge className="bg-red-700 text-white">{debitLines.length} to allocate</Badge>
                  </div>
                </Link>
              </div>

              <Card id="bank-transactions">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className={bankFlow === "credit" ? "text-emerald-900" : "text-red-900"}>{bankFlow === "credit" ? "Credit / Money In matching" : "Debit / Money Out allocation"}</CardTitle>
                    <CardDescription>{bankFlow === "credit" ? `${creditLines.length} incoming receipts need attention. Rental suggestions are limited to the ${rentalMonthLabel(statementRentalMonth)} invoice month.` : `${debitLines.length} outgoing payments need attention. Allocate each debit to one recorded payment, several bills/claims, or an accounting category.`}</CardDescription>
                  </div>
                  {selectedStatement.status === "in_progress" ? <div className="flex flex-wrap gap-2"><form action={autoMatchStatement}><input name="statementId" type="hidden" value={selectedStatement.id} /><input name="bankFlow" type="hidden" value={bankFlow} /><Button type="submit" variant="outline"><Sparkles className="h-4 w-4" />Auto-link safe {bankFlow === "credit" ? "credits" : "debits"}</Button></form><form action={finalizeBankReconciliation}><input name="statementId" type="hidden" value={selectedStatement.id} /><Button disabled={unmatchedCount > 0 || Math.abs(statementDifference) > 0.005} type="submit"><BadgeCheck className="h-4 w-4" />Finalise whole statement</Button></form></div> : <Badge className="bg-emerald-100 text-emerald-800">Reconciled and locked</Badge>}
                </CardHeader>
                <CardContent className="space-y-4">
                  {params.already_reconciled ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      This bank line was already fully reconciled. DEKEZ ignored the repeated click, so no duplicate accounting entry was created.
                    </div>
                  ) : null}
                  {params.recurring_matched ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      Created and matched a separate {rentalMonthLabel(params.recurring_matched)} recurring entry. No earlier month was reused.
                    </div>
                  ) : null}
                  {params.transfer_matched ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      Both sides of the own-account transfer were linked. No income or expense was created.
                    </div>
                  ) : null}
                  {params.transfer_unmatched ? (
                    <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900">
                      Both sides of the own-account transfer were unlinked and are ready for correction.
                    </div>
                  ) : null}
                  {params.auto_matched !== undefined ? Number(params.auto_matched) > 0 ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      Linked {Number(params.auto_matched)} exact bank {Number(params.auto_matched) === 1 ? "transaction" : "transactions"}. Existing payments and paid invoices were linked only; no duplicate payment was created.
                    </div>
                  ) : (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      No additional exact matches were safe to link. Press <strong>Open</strong> on a transaction and choose its recorded payment, paid invoice or accounting category.
                    </div>
                  ) : null}
                  {params.expense_batch_reconciled ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      Reconciled one payment against {params.expense_batch_reconciled} company receipt{params.expense_batch_reconciled === "1" ? "" : "s"}. The expense was not posted twice.
                    </div>
                  ) : null}
                  {params.paid_receipts_reconciled ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      Matched {params.paid_receipts_reconciled} existing company/card receipt{params.paid_receipts_reconciled === "1" ? "" : "s"} to one statement charge. No expense was posted twice.
                    </div>
                  ) : null}
                  {params.staff_batch_reconciled ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      Reconciled one staff transfer against {params.staff_batch_reconciled} approved claim{params.staff_batch_reconciled === "1" ? "" : "s"}. The staff payable is now cleared.
                    </div>
                  ) : null}
                  {prioritizedFlowLines.length ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
                      <strong>{safeSuggestedCount} safe {safeSuggestedCount === 1 ? "match is" : "matches are"} shown first.</strong>
                      {manualReviewCount ? ` Finish those first; the remaining ${manualReviewCount} ${manualReviewCount === 1 ? "transaction stays" : "transactions stay"} afterward for manual selection.` : " Every remaining transaction has a safe suggestion."}
                    </div>
                  ) : null}
                  {reviewLines.map((line) => {
                    const lineMatches = matchesByLine.get(line.id) ?? [];
                    const matchedAmount = lineMatches.reduce((total, match) => total + Number(match.matched_amount ?? 0), 0);
                    const remaining = Number(line.amount) - matchedAmount;
                    const locationHint = bankRoomHint(line.description);
                    const descriptionParts = line.description.split(" · ").filter(Boolean);
                    const transactionLabel = descriptionParts[0] || "Bank transaction";
                    const transactionDetails = descriptionParts.slice(1).join(" · ");
                    const exactRoomInvoices = locationHint
                      ? statementInvoiceOptions.filter(
                          (bill) => bill.propertyCode === locationHint.propertyCode
                            && bill.roomCode === locationHint.roomCode,
                        )
                      : [];
                    const rankedRoomInvoices = exactRoomInvoices
                      .map((bill) => ({
                        bill,
                        nameScore: bankTenantNameMatchScore(line.description, bill.tenantName),
                      }))
                      .sort((left, right) => right.nameScore - left.nameScore);
                    const nameMatchedRoomInvoices = rankedRoomInvoices
                      .filter((item) => item.nameScore > 0)
                      .map((item) => item.bill);
                    const suggestedInvoice = rankedRoomInvoices[0]?.nameScore > 0
                      && rankedRoomInvoices[0].nameScore > (rankedRoomInvoices[1]?.nameScore ?? 0)
                        ? rankedRoomInvoices[0].bill
                        : exactRoomInvoices.length === 1 && !exactRoomInvoices[0].tenantName
                          ? exactRoomInvoices[0]
                          : null;
                    const invoiceChoices = locationHint
                      ? nameMatchedRoomInvoices.length
                        ? nameMatchedRoomInvoices
                        : exactRoomInvoices
                      : statementInvoiceOptions;
                    const candidatePool = candidates.filter((candidate) => {
                      const key = `${candidate.sourceType}:${candidate.sourceId}`;
                      const isRecurringTemplate = candidate.sourceType === "manual_bank_transaction"
                        && candidate.date.slice(0, 7) !== statementRentalMonth;
                      const available = isRecurringTemplate
                        ? Math.abs(candidate.amount)
                        : Math.abs(candidate.amount) - (consumed.get(key) ?? 0);
                      const correctRentalMonth = !candidate.isRental
                        || candidate.invoiceMonth?.slice(0, 7) === statementRentalMonth;
                      const correctSourceMonth = isRecurringTemplate
                        || candidate.date.slice(0, 7) === statementRentalMonth;
                      return Math.sign(candidate.amount) === Math.sign(remaining)
                        && available > 0.005
                        && correctRentalMonth
                        && correctSourceMonth;
                    });
                    const exactAmountCandidates = candidatePool.filter((candidate) => {
                      const key = `${candidate.sourceType}:${candidate.sourceId}`;
                      const isRecurringTemplate = candidate.sourceType === "manual_bank_transaction"
                        && candidate.date.slice(0, 7) !== statementRentalMonth;
                      const available = isRecurringTemplate
                        ? Math.abs(candidate.amount)
                        : Math.abs(candidate.amount) - (consumed.get(key) ?? 0);
                      return Math.abs(available - Math.abs(remaining)) < 0.005;
                    });
                    const amountScopedCandidates = exactAmountCandidates.length ? exactAmountCandidates : candidatePool;
                    const locationCandidates = locationHint
                      ? amountScopedCandidates.filter((candidate) => {
                          const hint = bankRoomHint(candidate.description);
                          return hint?.propertyCode === locationHint.propertyCode && hint.roomCode === locationHint.roomCode;
                        })
                      : [];
                    const nameMatchedLocationCandidates = locationCandidates.filter(
                      (candidate) => candidate.isRental
                        && bankTenantNameMatchScore(line.description, candidate.tenantName) > 0,
                    );
                    const availableCandidates = (locationHint
                      ? nameMatchedLocationCandidates.length
                        ? nameMatchedLocationCandidates
                        : locationCandidates
                      : amountScopedCandidates).sort((left, right) => {
                      const leftHint = bankRoomHint(left.description);
                      const rightHint = bankRoomHint(right.description);
                      const leftScore = locationHint && leftHint?.propertyCode === locationHint.propertyCode && leftHint.roomCode === locationHint.roomCode ? 1 : 0;
                      const rightScore = locationHint && rightHint?.propertyCode === locationHint.propertyCode && rightHint.roomCode === locationHint.roomCode ? 1 : 0;
                      return rightScore - leftScore;
                    }).slice(0, 50);
                    const rankedCandidates = availableCandidates
                      .map((candidate) => ({
                        candidate,
                        score: bankTextMatchScore(line.description, candidate.description),
                        tenantNameScore: candidate.isRental
                          ? bankTenantNameMatchScore(line.description, candidate.tenantName)
                          : 0,
                      }))
                      .sort((left, right) => right.score - left.score);
                    const recommendedCandidate = locationHint
                      ? rankedCandidates[0]?.tenantNameScore > 0
                        && rankedCandidates[0].tenantNameScore > (rankedCandidates[1]?.tenantNameScore ?? 0)
                          ? rankedCandidates[0].candidate
                          : null
                      : rankedCandidates[0]?.score >= 2
                        && rankedCandidates[0].score > (rankedCandidates[1]?.score ?? 0)
                          ? rankedCandidates[0].candidate
                          : null;
                    const isRecurringRecommendation = recommendedCandidate?.sourceType === "manual_bank_transaction"
                      && recommendedCandidate.date.slice(0, 7) !== statementRentalMonth;
                    const isSmallExtraCredit = remaining > 0.005
                      && Boolean(locationHint && suggestedInvoice)
                      && [30, 50].some((amount) => Math.abs(Number(remaining) - amount) < 0.005);
                    const rememberedRule = reconciliationRuleMap.get(
                      `${line.bank_account_id ?? ""}:${Number(line.amount) > 0 ? "credit" : "debit"}:${bankDescriptionKey(line.description)}`,
                    );
                    const hintedPropertyId = locationHint
                      ? properties.find((property) => propertyCode(property.name) === locationHint.propertyCode)?.id ?? ""
                      : "";
                    const transferCandidates = transferCounterpartLines.filter((candidate) =>
                      Math.sign(Number(candidate.amount)) === -Math.sign(remaining)
                      && Math.abs(Math.abs(Number(candidate.amount)) - Math.abs(remaining)) < 0.005,
                    );
                    return (
                      <div className="rounded-lg border border-[#d7dde5] bg-white" id={`bank-line-${line.id}`} key={line.id}>
                        <div className="grid gap-3 p-4 sm:grid-cols-[110px_1fr_150px_150px] sm:items-center">
                          <div className="text-sm"><p className="font-medium">{dateLabel(line.transaction_date)}</p><p className="text-xs text-gray-500">{line.reference_number || "No reference"}</p></div>
                          <div><div className="flex flex-wrap items-center gap-2"><Badge className={Number(line.amount) > 0 ? "bg-emerald-700 text-white" : "bg-red-700 text-white"}>{Number(line.amount) > 0 ? "CREDIT" : "DEBIT"}</Badge><p className="font-semibold text-gray-950">{transactionLabel}</p>{locationHint ? <Badge className="bg-blue-100 text-blue-800">{locationHint.propertyCode} Room {locationHint.roomCode}</Badge> : null}</div><p className="mt-1 line-clamp-2 text-xs text-gray-600">{transactionDetails || "No additional bank description"}</p></div>
                          <div className="text-right"><p className={`font-semibold ${Number(line.amount) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{Number(line.amount) >= 0 ? "+" : "-"}{money(Math.abs(Number(line.amount)))}</p><p className="text-xs text-gray-500">{Number(line.amount) >= 0 ? "Money received" : "Money paid out"}</p></div>
                          <div className="flex flex-col items-stretch gap-2 sm:items-end"><Badge className={statusClasses[line.status] ?? ""}>Needs review</Badge></div>
                        </div>
                        <div className="border-t border-[#d7dde5] bg-gray-50 p-4">
                          {lineMatches.length ? <div className="mb-4 space-y-2">{lineMatches.map((match) => { const candidate = candidateMap.get(`${match.source_type}:${match.source_id}`); return <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" key={match.id}><span><strong>{match.match_method.replaceAll("_", " ")}</strong> · {candidate?.description ?? match.source_type.replaceAll("_", " ")} · {money(match.matched_amount)}</span>{selectedStatement.status === "in_progress" ? <form action={unmatchBankLine}><input name="matchId" type="hidden" value={match.id} /><input name="bankFlow" type="hidden" value={bankFlow} /><Button size="sm" type="submit" variant="outline">Unmatch</Button></form> : null}</div>; })}</div> : null}
                          {selectedStatement.status === "in_progress" && line.status === "unmatched" ? <div className="space-y-4">
                            {transferCandidates.length ? <form action={matchOwnAccountTransfer} className="space-y-3 rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
                              <div><p className="font-semibold text-blue-950">Transfer between your own accounts</p><p className="text-xs text-blue-900">Use this when one DEKEZ bank/card account paid another. It links the debit and credit without recording income or expense.</p></div>
                              <input name="lineId" type="hidden" value={line.id} />
                              <input name="bankFlow" type="hidden" value={bankFlow} />
                              <label className="block text-xs font-medium text-blue-950">Matching opposite statement line<select className="mt-1 h-10 w-full rounded-md border border-blue-300 bg-white px-3 text-sm" name="counterpartLineId" required><option value="">Choose the other account line</option>{transferCandidates.map((candidate) => { const account = bankAccounts.find((item) => item.id === candidate.bank_account_id); const statement = singleRelation(candidate.bank_statement_imports); return <option key={candidate.id} value={candidate.id}>{account?.name ?? account?.bank_name ?? "Other DEKEZ account"} · {dateLabel(candidate.transaction_date)} · {money(Math.abs(Number(candidate.amount)))} · statement ending {dateLabel(statement?.period_end)} · {candidate.description}</option>; })}</select></label>
                              <ReconciliationSubmitButton className="w-full" pendingLabel="Linking both accounts..."><Link2 className="h-4 w-4" />Match own-account transfer</ReconciliationSubmitButton>
                            </form> : null}
                            {remaining < -0.005 && params.batchLine !== line.id ? (
                              <Button asChild className="w-full justify-start" variant="outline">
                                <Link href={bankBatchLineHref(selectedMonth, selectedPropertyId, selectedStatement.id, reviewPage, line.id)} prefetch={false}>
                                  <ReceiptText className="h-4 w-4" /> Allocate this debit to several bills / claim receipts
                                </Link>
                              </Button>
                            ) : null}
                            {remaining < -0.005 && params.batchLine === line.id ? (
                              <details className="rounded-lg border-2 border-[#b8892c] bg-[#fffaf0]" open>
                                <summary className="cursor-pointer list-none px-4 py-4 font-semibold text-[#7a5618]">
                                  Allocate this debit across several bills or claim receipts
                                  <span className="mt-1 block text-xs font-normal text-gray-600">
                                    Tick the receipts below. Their combined total must equal {money(Math.abs(remaining))}.
                                  </span>
                                </summary>
                                <div className="border-t border-amber-200 p-4">
                                  <BankReceiptBatchForm
                                    lineAmount={remaining}
                                    lineId={line.id}
                                    paidCompanyExpenses={reconciliationPaidCompanyExpenses}
                                    staffGroups={reconciliationStaffGroups}
                                    unpaidCompanyExpenses={reconciliationUnpaidCompanyExpenses}
                                  />
                                </div>
                              </details>
                            ) : null}
                            {recommendedCandidate ? <form action={matchBankLine} className="flex flex-col gap-3 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <input name="lineId" type="hidden" value={line.id} />
                              <input name="bankFlow" type="hidden" value={bankFlow} />
                              <input name="sourceToken" type="hidden" value={`${recommendedCandidate.sourceType}:${recommendedCandidate.sourceId}`} />
                              <div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{isRecurringRecommendation ? `Recurring pattern — create ${rentalMonthLabel(statementRentalMonth)}` : "DEKEZ same-month suggestion"}</p><p className="mt-1 font-semibold text-gray-950">{isRecurringRecommendation ? recurringDescriptionForMonth(recommendedCandidate.description, statementRentalMonth) : recommendedCandidate.description}</p><p className="text-sm text-gray-600">{isRecurringRecommendation ? `Pattern from ${dateLabel(recommendedCandidate.date)}` : dateLabel(recommendedCandidate.date)} · {money(recommendedCandidate.amount)}</p>{recommendedCandidate.invoiceMonth ? <p className="mt-2 inline-flex rounded-md bg-white px-2 py-1 text-xs font-semibold text-emerald-800">Rental invoice month: {rentalMonthLabel(recommendedCandidate.invoiceMonth)}</p> : null}</div>
                              <ReconciliationSubmitButton className="shrink-0" pendingLabel={isRecurringRecommendation ? "Creating this month..." : "Matching..."}><BadgeCheck className="h-4 w-4" />{isRecurringRecommendation ? `Create ${rentalMonthLabel(statementRentalMonth)} & match` : "Match this record"}</ReconciliationSubmitButton>
                            </form> : <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><strong>{locationHint ? `No recorded ${locationHint.propertyCode} Room ${locationHint.roomCode} receipt is available to match.` : "No safe recommendation yet."}</strong> {locationHint ? "DEKEZ will not offer another room. Use the exact-room invoice option below to record this receipt." : "Choose the correct record under Other options. Nothing will be posted until you confirm."}</div>}
                            <details open={!recommendedCandidate} className="rounded-lg border border-[#d7dde5] bg-white">
                              <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-[#7a5618]">{recommendedCandidate ? "Wrong match? Open other options" : "Open matching options"}</summary>
                              <div className="grid gap-4 border-t border-[#d7dde5] p-4 xl:grid-cols-3">
                            <form action={matchBankLine} className="space-y-3 rounded-lg border border-[#d7dde5] bg-white p-4">
                              <div><p className="font-semibold">Match existing transaction</p><p className="text-xs text-gray-500">Split or merge is automatic when amounts differ.</p></div>
                              <input name="lineId" type="hidden" value={line.id} />
                              <input name="bankFlow" type="hidden" value={bankFlow} />
                              <select className="h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm" defaultValue="" name="sourceToken" required><option disabled value="">Choose transaction</option>{availableCandidates.map((candidate) => <option key={`${candidate.sourceType}:${candidate.sourceId}`} value={`${candidate.sourceType}:${candidate.sourceId}`}>{candidate.invoiceMonth ? `${rentalMonthLabel(candidate.invoiceMonth)} invoice · ` : ""}{dateLabel(candidate.date)} · {money(candidate.amount)} · {candidate.description}</option>)}</select>
                              <ReconciliationSubmitButton className="w-full" pendingLabel="Matching..." variant="outline"><Link2 className="h-4 w-4" />Match</ReconciliationSubmitButton>
                            </form>
                            {remaining > 0.005 ? <form action={createTenantPaymentFromBankLine} className="space-y-3 rounded-lg border-2 border-[#b8892c] bg-[#fffaf0] p-4">
                              <div><p className="font-semibold">Tenant paid but did not upload a slip</p><p className="text-xs text-gray-600">Use only for a real unmatched bank receipt. DEKEZ records the payment, knocks off the invoice and retains the statement as proof.</p></div>
                              <input name="lineId" type="hidden" value={line.id} />
                              <input name="bankFlow" type="hidden" value="credit" />
                              <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900">Only {rentalMonthLabel(statementRentalMonth)} rental invoices are allowed for this statement. Older outstanding invoices are not carried forward here.</p>
                              {isSmallExtraCredit ? <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900">RM{Number(remaining).toFixed(0)} detected for {locationHint?.propertyCode} Room {locationHint?.roomCode}. It is prepared as a same-month extra/electricity item, not rental. Choose its exact purpose before confirming.</p> : null}
                              {suggestedInvoice ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">QR name and room matched: {suggestedInvoice.propertyCode} Room {suggestedInvoice.roomCode} · {suggestedInvoice.tenantName} · rental invoice month {rentalMonthLabel(suggestedInvoice.billMonth)}</p> : exactRoomInvoices.length ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">The QR room is {locationHint?.propertyCode} Room {locationHint?.roomCode}, but the QR name did not safely match the invoice tenant. Only this exact room is shown below—check the name before confirming.</p> : locationHint ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">No {rentalMonthLabel(statementRentalMonth)} invoice was found for {locationHint.propertyCode} Room {locationHint.roomCode}. DEKEZ will not show another room.</p> : null}
                              <label className="block text-xs font-medium">{rentalMonthLabel(statementRentalMonth)} tenant invoice<select className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={suggestedInvoice?.id ?? ""} name="rentBillId" required><option disabled value="">Choose {rentalMonthLabel(statementRentalMonth)} invoice</option>{invoiceChoices.map((bill) => <option key={bill.id} value={bill.id}>{bill.id === suggestedInvoice?.id ? "Recommended · " : ""}{rentalMonthLabel(bill.billMonth)} · {bill.tenantName} · {bill.propertyName} / {bill.roomName} · {bill.invoiceNumber ?? bill.id.slice(0, 8)} · owing {money(bill.outstanding)}</option>)}</select></label>
                              <div className="grid grid-cols-3 gap-2"><label className="text-xs">Rent<input className="mt-1 h-9 w-full rounded-md border border-[#d7dde5] px-2" defaultValue={isSmallExtraCredit ? "0.00" : suggestedInvoice ? Math.min(Number(remaining), suggestedInvoice.rentOutstanding).toFixed(2) : undefined} min="0" name="rentalAmount" step="0.01" type="number" /></label><label className="text-xs">Deposit<input className="mt-1 h-9 w-full rounded-md border border-[#d7dde5] px-2" defaultValue={isSmallExtraCredit ? "0.00" : suggestedInvoice ? Math.min(Math.max(Number(remaining) - suggestedInvoice.rentOutstanding, 0), suggestedInvoice.depositOutstanding).toFixed(2) : undefined} min="0" name="depositAmount" step="0.01" type="number" /></label><label className="text-xs">Other / top-up<input className="mt-1 h-9 w-full rounded-md border border-[#d7dde5] px-2" defaultValue={isSmallExtraCredit ? Number(remaining).toFixed(2) : undefined} min="0" name="otherAmount" step="0.01" type="number" /></label></div>
                              <p className="text-xs font-medium text-[#7a5618]">Allocation total must equal {money(remaining)}.</p>
                              <select className="h-9 w-full rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={isSmallExtraCredit ? "" : "other"} name="otherCategory" required={isSmallExtraCredit}><option disabled value="">Choose this RM{Number(remaining).toFixed(0)} purpose</option><option value="other">Other / extra</option><option value="top_up_utilities">Top Up Utilities</option><option value="electricity">Electricity</option><option value="water">Water</option><option value="key_lock">Key / lock</option><option value="access_card">Access card</option><option value="damage">Damage</option><option value="cleaning">Cleaning</option><option value="furniture">Furniture</option></select>
                              <input className="h-9 w-full rounded-md border border-[#d7dde5] px-2 text-sm" name="otherDescription" placeholder={isSmallExtraCredit ? `What is this RM${Number(remaining).toFixed(0)} charge for?` : "Required only when Other amount is used"} required={isSmallExtraCredit} />
                              <ReconciliationSubmitButton className="w-full" pendingLabel="Recording and matching..."><Banknote className="h-4 w-4" />Record payment, knock off &amp; match</ReconciliationSubmitButton>
                            </form> : null}
                            <div className="space-y-3 rounded-lg border border-[#d7dde5] bg-white p-4">
                              <form action={createBankAdjustment} className="space-y-3">
                                <div><p className="font-semibold">{bankFlow === "debit" ? "Categorise this debit" : "Record a missing accounting entry"}</p><p className="text-xs text-gray-500">{bankFlow === "debit" ? "Use for bank fees, salary, property rent/COGS, fixed assets, tax or another outgoing category that has no existing bill." : "Use for interest, owner capital, transfers or another incoming accounting category."}</p></div>
                                {rememberedRule ? <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"><strong>Remembered from an earlier month.</strong> Check the filled category, property and description, then confirm.</div> : null}
                                <input name="lineId" type="hidden" value={line.id} />
                                <input name="bankFlow" type="hidden" value={bankFlow} />
                                <select className="h-9 w-full rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={rememberedRule?.accounting_account_id ?? ""} name="accountId" required><option disabled value="">Choose accounting category</option>{adjustmentAccountGroups.map((group) => <optgroup key={group.type} label={group.type.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase())}>{group.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</optgroup>)}</select>
                                <select className="h-9 w-full rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={rememberedRule?.property_id ?? hintedPropertyId} name="propertyId"><option value="">General company / no property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select>
                                <input className="h-9 w-full rounded-md border border-[#d7dde5] px-2 text-sm" defaultValue={rememberedRule?.default_description ? recurringDescriptionForMonth(rememberedRule.default_description, statementRentalMonth) : ""} name="description" placeholder="What was this transaction for?" required />
                                <label className="flex items-start gap-2 rounded-md border border-[#d7dde5] bg-gray-50 px-3 py-2 text-xs text-gray-700"><input className="mt-0.5" defaultChecked name="rememberRule" type="checkbox" value="1" /><span>Remember this bank description for next month. DEKEZ will prefill the same category, property and description, but will still wait for your confirmation.</span></label>
                                <ReconciliationSubmitButton className="w-full" pendingLabel="Recording and matching..." variant="outline">Record &amp; match</ReconciliationSubmitButton>
                              </form>
                              <form action={ignoreBankLine} className="space-y-2 border-t border-[#d7dde5] pt-3"><input name="lineId" type="hidden" value={line.id} /><input name="bankFlow" type="hidden" value={bankFlow} /><input className="h-9 w-full rounded-md border border-[#d7dde5] px-2 text-sm" name="reason" placeholder="Audit reason to ignore" required /><Button className="w-full" type="submit" variant="ghost">Ignore with reason</Button></form>
                            </div>
                              </div>
                            </details>
                          </div> : null}
                        </div>
                      </div>
                    );
                  })}
                  {!reviewLines.length ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-800">All {bankFlow === "credit" ? "credits" : "debits"} have been matched or explained.</div> : null}
                  {reviewPageCount > 1 ? <div className="flex items-center justify-between gap-3 border-t border-[#d7dde5] pt-4 text-sm"><span>Page {reviewPage} of {reviewPageCount} · showing up to {reviewPageSize} unmatched {bankFlow === "credit" ? "credits" : "debits"}</span><div className="flex gap-2">{reviewPage > 1 ? <Button asChild size="sm" variant="outline"><Link href={bankReviewPageHref(selectedMonth, selectedPropertyId, selectedStatement.id, reviewPage - 1, bankFlow)} prefetch={false}>Previous</Link></Button> : null}{reviewPage < reviewPageCount ? <Button asChild size="sm"><Link href={bankReviewPageHref(selectedMonth, selectedPropertyId, selectedStatement.id, reviewPage + 1, bankFlow)} prefetch={false}>Next</Link></Button> : null}</div></div> : null}
                </CardContent>
              </Card>
            </>
          ) : <Card><CardContent className="pt-5"><p className="text-sm text-gray-600">Add a bank account and import a CSV statement to start reconciling.</p></CardContent></Card>}
        </div>
      ) : null}

      {tab === "ledger" ? <ChartOfAccountsManager accounts={accounts} /> : null}
    </section>
  );
}

function BalanceSection({
  rows,
  title,
  tone,
  total,
}: {
  rows: Array<{ key: string; code: string; label: string; amount: number; source: string }>;
  title: string;
  tone: "emerald" | "red" | "blue";
  total: number;
}) {
  const classes = tone === "emerald"
    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
    : tone === "red"
      ? "border-red-200 bg-red-50 text-red-950"
      : "border-blue-200 bg-blue-50 text-blue-950";
  return (
    <div className={`overflow-hidden rounded-lg border ${classes}`}>
      <div className="flex items-center justify-between border-b border-current/10 px-4 py-3"><h3 className="font-semibold">{title}</h3><strong>{money(total)}</strong></div>
      <div className="divide-y divide-current/10 bg-white/70">
        {rows.map((row) => <div className="px-4 py-3" key={row.key}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{row.code} · {row.label}</p><p className="mt-1 text-xs opacity-70">{row.source}</p></div><strong className="shrink-0">{money(row.amount)}</strong></div></div>)}
        {!rows.length ? <p className="px-4 py-5 text-sm opacity-70">No balance recorded.</p> : null}
      </div>
    </div>
  );
}

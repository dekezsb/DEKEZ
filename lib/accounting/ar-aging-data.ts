import type { SupabaseClient } from "@supabase/supabase-js";
import { allReportRows } from "@/lib/accounting/report-data";
import type { ArInvoice, ArManualSource } from "@/lib/accounting/ar-aging";

/**
 * Read-only loader for the AR aging report. It uses the same rules as the
 * Balance Sheet so the two agree: open invoices (not cancelled, waived or
 * removed) with rent outstanding = invoice + charges - payments, never below
 * zero, and deposit outstanding = deposit due - confirmed deposit payments.
 */
const OPEN_STATUSES = [
  "unpaid", "partial", "partially_paid", "submitted", "pending_verification", "payment_submitted",
  "rejected", "overdue", "upcoming", "due_today", "paid",
];

type Row = Record<string, any>;
function must<T>(label: string, result: { data: T[] | null; error: unknown }): T[] {
  if (result.error) throw new Error(`AR aging could not be loaded (${label}).`);
  return result.data ?? [];
}

export type ArAgingData = {
  invoices: ArInvoice[];
  manual: ArManualSource[];
  overpaid: { count: number; amount: number };
};

export async function loadArAging(
  supabase: SupabaseClient,
  companyId: string,
  properties: Array<{ id: string; name: string }>,
  asAt: string,
  propertyId?: string | null,
): Promise<ArAgingData> {
  const propertyIds = properties.map((property) => property.id);
  if (!propertyIds.length) return { invoices: [], manual: [], overpaid: { count: 0, amount: 0 } };
  const propertyName = new Map(properties.map((property) => [property.id, property.name]));

  const [bills, items, depositPayments, tenantRecords, tenancies, rooms, aliases, accounts] = await Promise.all([
    allReportRows<Row>(supabase.from("rent_bills")
      .select("id, tenancy_id, tenant_record_id, tenant_id, property_id, room_id, bill_month, due_date, invoice_date, invoice_number, amount, deposit_amount, paid_amount, status")
      .in("property_id", propertyIds).in("status", OPEN_STATUSES).is("removed_at", null) as any),
    allReportRows<Row>(supabase.from("rental_invoice_line_items").select("id, rent_bill_id, amount") as any),
    allReportRows<Row>(supabase.from("payments").select("id, tenancy_id, amount").eq("category", "deposit").eq("status", "confirmed").is("reversed_at", null) as any),
    allReportRows<Row>(supabase.from("tenant_records").select("id, full_name") as any),
    allReportRows<Row>(supabase.from("tenancies").select("id, tenants(full_name)") as any),
    allReportRows<Row>(supabase.from("rooms").select("id, name, room_number") as any),
    allReportRows<Row>(supabase.from("document_number_aliases").select("id, source_id, legacy_number, new_number").eq("source_table", "rent_bills") as any),
    supabase.from("accounting_accounts").select("id, system_key, normal_balance").eq("company_id", companyId).in("system_key", ["rental_receivable", "deposit_receivable"]),
  ]);

  const itemTotal = new Map<string, number>();
  for (const item of must("invoice charges", items)) itemTotal.set(item.rent_bill_id, (itemTotal.get(item.rent_bill_id) ?? 0) + Number(item.amount ?? 0));
  const depositPaid = new Map<string, number>();
  for (const payment of must("deposit payments", depositPayments)) depositPaid.set(payment.tenancy_id, (depositPaid.get(payment.tenancy_id) ?? 0) + Number(payment.amount ?? 0));
  const tenantName = new Map(must("tenants", tenantRecords).map((row) => [row.id as string, row.full_name as string]));
  const legacyTenantName = new Map(must("tenancies", tenancies).map((row) => [row.id as string, ((Array.isArray(row.tenants) ? row.tenants[0] : row.tenants)?.full_name ?? "") as string]));
  const roomName = new Map(must("rooms", rooms).map((row) => [row.id as string, (row.name || `Room ${row.room_number}`) as string]));
  const aliasById = new Map<string, string>();
  const aliasByNumber = new Map<string, string>();
  for (const alias of must("numbering aliases", aliases)) {
    if (alias.source_id) aliasById.set(alias.source_id, alias.new_number);
    if (alias.legacy_number) aliasByNumber.set(alias.legacy_number, alias.new_number);
  }

  const invoices: ArInvoice[] = [];
  let overpaidCount = 0;
  let overpaidCents = 0;
  for (const bill of must("invoices", bills)) {
    const invoiceAmount = Number(bill.amount ?? 0) + (itemTotal.get(bill.id) ?? 0);
    const paidAmount = Number(bill.paid_amount ?? 0);
    const rentOutstanding = Math.max(Math.round((invoiceAmount - paidAmount) * 100) / 100, 0);
    const depositOutstanding = Math.max(Math.round((Number(bill.deposit_amount ?? 0) - (depositPaid.get(bill.tenancy_id) ?? 0)) * 100) / 100, 0);
    if (paidAmount - invoiceAmount > 0.005 && (!propertyId || bill.property_id === propertyId)) {
      overpaidCount += 1;
      overpaidCents += Math.round((paidAmount - invoiceAmount) * 100);
    }
    const number = String(bill.invoice_number ?? "") || `Invoice ${String(bill.id).slice(0, 8)}`;
    const tenantKey = String(bill.tenant_record_id ?? bill.tenant_id ?? bill.tenancy_id ?? bill.id);
    invoices.push({
      id: String(bill.id),
      propertyId: String(bill.property_id),
      propertyName: propertyName.get(bill.property_id) ?? "Property",
      tenantKey,
      tenantName: tenantName.get(bill.tenant_record_id) || legacyTenantName.get(bill.tenancy_id) || `Tenant ${String(bill.tenant_id ?? "").slice(0, 8)}`,
      roomName: roomName.get(bill.room_id) ?? "",
      invoiceNumber: number,
      aliasNumber: aliasById.get(bill.id) ?? aliasByNumber.get(number) ?? null,
      invoiceDate: String(bill.invoice_date ?? bill.bill_month ?? ""),
      dueDate: String(bill.due_date ?? ""),
      status: String(bill.status),
      invoiceAmount,
      paidAmount,
      rentOutstanding,
      depositOutstanding,
    });
  }

  // Postings made straight to the receivable accounts: they sit on the Balance
  // Sheet next to the invoices, so the reconciliation has to show them.
  const accountRows = must("receivable accounts", accounts as { data: Row[] | null; error: unknown });
  const rental = accountRows.find((row) => row.system_key === "rental_receivable");
  const deposit = accountRows.find((row) => row.system_key === "deposit_receivable");
  const receivableIds = accountRows.map((row) => row.id as string);
  const manual: ArManualSource[] = [];
  if (receivableIds.length) {
    const [entries, lines, bankVouchers, historical] = await Promise.all([
      allReportRows<Row>(supabase.from("accounting_journal_entries").select("id, entry_date, status").eq("company_id", companyId).eq("status", "posted").lte("entry_date", asAt) as any),
      allReportRows<Row>(supabase.from("accounting_journal_lines").select("id, journal_entry_id, account_id, property_id, debit, credit").in("account_id", receivableIds) as any),
      allReportRows<Row>(supabase.from("bank_manual_transactions").select("id, amount, offset_account_id, property_id, transaction_date").eq("company_id", companyId).in("offset_account_id", receivableIds).lte("transaction_date", asAt) as any),
      propertyId ? Promise.resolve({ data: [] as Row[], error: null }) : allReportRows<Row>(supabase.from("historical_bank_credit_classifications").select("id, account_id, amount, classification_date").eq("company_id", companyId).in("account_id", receivableIds).lte("classification_date", asAt) as any),
    ]);
    const postedEntry = new Set(must("journal entries", entries).map((entry) => entry.id as string));
    const sign = (accountId: string) => (accountRows.find((row) => row.id === accountId)?.normal_balance === "credit" ? -1 : 1);
    const tally = { journalRental: 0, journalDeposit: 0, bankRental: 0, bankDeposit: 0, histRental: 0, histDeposit: 0 };
    const put = (accountId: string, netDebit: number, rentalKey: keyof typeof tally, depositKey: keyof typeof tally) => {
      const natural = Math.round(netDebit * 100) * sign(accountId);
      if (accountId === rental?.id) tally[rentalKey] += natural;
      else if (accountId === deposit?.id) tally[depositKey] += natural;
    };
    for (const line of must("journal lines", lines)) {
      if (!postedEntry.has(line.journal_entry_id)) continue;
      if (propertyId && line.property_id !== propertyId) continue;
      put(line.account_id, Number(line.debit ?? 0) - Number(line.credit ?? 0), "journalRental", "journalDeposit");
    }
    for (const row of must("bank vouchers", bankVouchers)) {
      if (propertyId && row.property_id !== propertyId) continue;
      put(row.offset_account_id, -Number(row.amount ?? 0), "bankRental", "bankDeposit");
    }
    for (const row of must("historical bank credits", historical)) put(row.account_id, -Number(row.amount ?? 0), "histRental", "histDeposit");
    const entry = (label: string, rentalKey: keyof typeof tally, depositKey: keyof typeof tally) => {
      if (tally[rentalKey] || tally[depositKey]) manual.push({ label, rental: tally[rentalKey] / 100, deposit: tally[depositKey] / 100 });
    };
    entry("Manual journals posted to the receivable accounts", "journalRental", "journalDeposit");
    entry("Bank payment / receipt vouchers posted to the receivable accounts", "bankRental", "bankDeposit");
    entry("Historical bank credits classified against receivables (not tied to an invoice)", "histRental", "histDeposit");
  }

  return { invoices, manual, overpaid: { count: overpaidCount, amount: overpaidCents / 100 } };
}

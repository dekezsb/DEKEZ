import type { SupabaseClient } from "@supabase/supabase-js";
import { allReportRows, getProfitLossReport, type ProfitLossRow } from "@/lib/accounting/report-data";
import { accountIdForPnlKey, type GlAccount, type GlLine, type GlSource } from "@/lib/accounting/general-ledger";

type Entry = { id: string; entry_date: string; entry_number: string; source_type: string | null; source_id: string | null; reference_number: string | null; description: string | null; reversed_entry_id: string | null };
type JournalLine = { id: string; journal_entry_id: string; account_id: string; property_id: string | null; description: string | null; debit: number | string; credit: number | string };
type VoucherRef = { id: string; voucher_number: string; voucher_type: string; journal_entry_id: string; reversal_journal_entry_id: string | null; party_name: string | null };
type AliasRow = { source_table: string; source_id: string; legacy_number: string; new_number: string };

const num = (value: unknown) => {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
};
const editLink = (kind: "voucher" | "journal" | "bank", id: string) => `/reports/vouchers/edit?${new URLSearchParams({ kind, id }).toString()}`;

async function inBatches<T>(ids: string[], fetch: (batch: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await fetch(ids.slice(offset, offset + 100));
    if (result.error) throw new Error("General ledger could not be loaded.");
    rows.push(...(result.data ?? []));
  }
  return rows;
}

function must<T>(label: string, result: { data: T | null; error: unknown }): T {
  if (result.error) throw new Error(`General ledger: ${label} could not be loaded.`);
  return result.data as T;
}

/**
 * Collects every ledger line dated up to `to`, for every account, from the same
 * sources the financial reports use:
 *  - income / expense accounts: the P&L supporting ledger (invoices, expenses,
 *    utility bills, bank vouchers, posted journals), so totals match the P&L;
 *  - asset / liability / equity accounts: posted journal lines, bank-voucher
 *    offsets and confirmed tenant deposit receipts (2200).
 * Bank balances come from imported statements and open receivables from open
 * invoices, exactly as on the balance sheet, so those accounts show journal
 * movements only.
 */
export async function loadGeneralLedger(supabase: SupabaseClient, companyId: string, to: string) {
  const [accountRows, propertyRows, entries, voucherRows, aliasRows, bankRows, depositRows] = await Promise.all([
    supabase.from("accounting_accounts").select("id, code, name, account_type, normal_balance, system_key").eq("company_id", companyId).order("code"),
    supabase.from("properties").select("id, name").eq("company_id", companyId),
    allReportRows<Entry>(supabase.from("accounting_journal_entries").select("id, entry_date, entry_number, source_type, source_id, reference_number, description, reversed_entry_id").eq("company_id", companyId).eq("status", "posted").lte("entry_date", to)),
    allReportRows<VoucherRef>(supabase.from("accounting_vouchers").select("id, voucher_number, voucher_type, journal_entry_id, reversal_journal_entry_id, party_name").eq("company_id", companyId)),
    allReportRows<AliasRow>(supabase.from("document_number_aliases").select("source_table, source_id, legacy_number, new_number")),
    allReportRows<{ id: string; amount: number | string; offset_account_id: string; property_id: string | null; transaction_date: string; reference_number: string | null; description: string | null }>(
      supabase.from("bank_manual_transactions").select("id, amount, offset_account_id, property_id, transaction_date, reference_number, description").eq("company_id", companyId).lte("transaction_date", to)),
    allReportRows<{ id: string; amount: number | string; payment_date: string; property_id: string | null; reference_number: string | null; notes: string | null }>(
      supabase.from("payments").select("id, amount, payment_date, property_id, reference_number, notes").eq("company_id", companyId).eq("category", "deposit").eq("status", "confirmed").is("reversed_at", null).lte("payment_date", to)),
  ]);

  const accounts: GlAccount[] = must("chart of accounts", accountRows).map((row: { id: string; code: string; name: string; account_type: string; normal_balance: string; system_key: string | null }) => ({
    id: row.id, code: row.code, name: row.name, type: row.account_type, normalBalance: row.normal_balance === "credit" ? "credit" : "debit", systemKey: row.system_key,
  }));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const propertyName = new Map(must("properties", propertyRows).map((property: { id: string; name: string }) => [property.id, property.name]));
  const propertyLabel = (id: string | null | undefined) => (id ? propertyName.get(id) ?? "" : "General");
  for (const result of [entries, voucherRows, aliasRows, bankRows, depositRows]) if (result.error) throw new Error("General ledger could not be loaded.");

  const aliasByEntry = new Map<string, string>();
  const aliasByRenovation = new Map<string, string>();
  const invoiceAlias = new Map<string, string>();
  const bankAlias = new Map<string, string>();
  for (const alias of aliasRows.data) {
    if (alias.source_table === "accounting_journal_entries") aliasByEntry.set(alias.source_id, alias.new_number);
    else if (alias.source_table === "renovation_documents") aliasByRenovation.set(alias.source_id, alias.new_number);
    else if (alias.source_table === "rent_bills") invoiceAlias.set(alias.legacy_number, alias.new_number);
    else if (alias.source_table === "bank_payment_voucher") bankAlias.set(alias.legacy_number, alias.new_number);
  }
  const entryById = new Map(entries.data.map((entry) => [entry.id, entry]));
  const voucherByEntry = new Map<string, { voucher: VoucherRef; reversal: boolean }>();
  for (const voucher of voucherRows.data) {
    voucherByEntry.set(voucher.journal_entry_id, { voucher, reversal: false });
    if (voucher.reversal_journal_entry_id) voucherByEntry.set(voucher.reversal_journal_entry_id, { voucher, reversal: true });
  }

  const journalLines = await inBatches<JournalLine>(entries.data.map((entry) => entry.id), (batch) =>
    supabase.from("accounting_journal_lines").select("id, journal_entry_id, account_id, property_id, description, debit, credit").in("journal_entry_id", batch));
  const lineById = new Map(journalLines.map((line) => [line.id, line]));

  /** One journal line to a ledger line, with the right document, numbers and drill-down link. */
  function journalGlLine(line: JournalLine, entry: Entry, overrides?: Partial<GlLine>): GlLine {
    const linked = voucherByEntry.get(entry.id);
    const reversal = Boolean(linked?.reversal) || entry.source_type === "journal_reversal";
    let source: GlSource = "journal";
    let number = entry.entry_number;
    let aliasNumber: string | null = aliasByEntry.get(entry.id) ?? null;
    let href: string | null = editLink("journal", entry.id);
    if (linked) {
      source = reversal ? "reversal" : "voucher";
      number = reversal ? entry.entry_number : linked.voucher.voucher_number;
      aliasNumber = reversal ? linked.voucher.voucher_number : entry.entry_number !== linked.voucher.voucher_number ? entry.entry_number : null;
      href = editLink("voucher", linked.voucher.id);
    } else if (reversal) {
      source = "reversal";
    } else if (entry.source_type === "renovation_invoice" || entry.source_type === "renovation_invoice_adjustment") {
      source = "renovation";
      aliasNumber = (entry.source_id ? aliasByRenovation.get(entry.source_id) : null) ?? aliasNumber;
      href = entry.source_id ? `/renovation/${entry.source_id}` : null;
    }
    return {
      key: `journal:${line.id}`,
      accountId: line.account_id,
      date: entry.entry_date,
      source,
      number,
      aliasNumber,
      reference: entry.reference_number,
      party: linked?.voucher.party_name ?? "",
      property: propertyLabel(line.property_id),
      description: line.description?.trim() || entry.description?.trim() || "Posted journal entry",
      debit: num(line.debit),
      credit: num(line.credit),
      href,
      ...overrides,
    };
  }

  const lines: GlLine[] = [];

  // Balance-sheet accounts straight from the posted journals.
  for (const line of journalLines) {
    const account = accountById.get(line.account_id);
    const entry = entryById.get(line.journal_entry_id);
    if (!account || !entry || ["income", "expense"].includes(account.type)) continue;
    lines.push(journalGlLine(line, entry));
  }

  // Bank-voucher offsets on balance-sheet accounts (the bank side comes from statements).
  for (const row of bankRows.data) {
    const account = accountById.get(row.offset_account_id);
    if (!account || ["income", "expense"].includes(account.type)) continue;
    const amount = num(row.amount);
    const reference = row.reference_number?.trim() || null;
    lines.push({
      key: `bank:${row.id}`, accountId: account.id, date: row.transaction_date, source: "bank_pv",
      number: reference ?? `Bank ${row.id.slice(0, 8)}`, aliasNumber: reference ? bankAlias.get(reference) ?? null : null, reference: null,
      party: "", property: propertyLabel(row.property_id), description: row.description ?? "Bank voucher",
      debit: Math.max(-amount, 0), credit: Math.max(amount, 0),
      href: reference?.startsWith("PV-") ? editLink("bank", reference) : null,
    });
  }

  // Confirmed tenant deposit receipts are the liability on 2200.
  const depositAccount = accounts.find((account) => account.systemKey === "tenant_security_deposits");
  if (depositAccount) {
    for (const payment of depositRows.data) {
      lines.push({
        key: `payment:${payment.id}`, accountId: depositAccount.id, date: payment.payment_date, source: "payment",
        number: payment.reference_number?.trim() || `Payment ${payment.id.slice(0, 8)}`, aliasNumber: null, reference: null,
        party: "", property: propertyLabel(payment.property_id), description: payment.notes?.trim() || "Tenant deposit received",
        debit: 0, credit: num(payment.amount), href: "/payments",
      });
    }
  }

  // Income and expense accounts: the P&L supporting ledger, so they agree with the P&L report.
  const pnl = await getProfitLossReport(supabase, { companyId, startDate: "2000-01-01", endDate: to, includeDetails: true });
  const pseudoAccounts: GlAccount[] = [];
  const addPnlRows = (rows: ProfitLossRow[], type: "income" | "expense") => {
    for (const row of rows) {
      let accountId = accountIdForPnlKey(row.key, accounts);
      if (!accountId) {
        accountId = `pseudo:${row.label}`;
        if (!pseudoAccounts.some((account) => account.id === accountId)) {
          pseudoAccounts.push({ id: accountId, code: "UNMAPPED", name: `${row.label} (no ledger account mapped)`, type, normalBalance: type === "income" ? "credit" : "debit" });
        }
      }
      for (const detail of row.details) {
        const [prefix, rawId] = [detail.id.slice(0, detail.id.indexOf(":")), detail.id.slice(detail.id.indexOf(":") + 1)];
        const base = { key: detail.id, accountId, date: detail.date, reference: detail.referenceNumber, party: detail.partyName ?? "", property: detail.propertyName, description: detail.description, debit: detail.debit, credit: detail.credit };
        if (prefix === "journal") {
          const line = lineById.get(rawId);
          const entry = line ? entryById.get(line.journal_entry_id) : undefined;
          if (line && entry) lines.push(journalGlLine(line, entry, { accountId, description: detail.description, party: base.party || (voucherByEntry.get(entry.id)?.voucher.party_name ?? "") }));
        } else if (prefix === "manual") {
          const reference = detail.referenceNumber?.trim() || null;
          lines.push({ ...base, source: "bank_pv", number: reference ?? detail.documentNumber, aliasNumber: reference ? bankAlias.get(reference) ?? null : null, reference: null, href: reference?.startsWith("PV-") ? editLink("bank", reference) : null });
        } else if (prefix === "rent" || prefix === "line") {
          lines.push({ ...base, source: "invoice", number: detail.documentNumber, aliasNumber: invoiceAlias.get(detail.documentNumber) ?? null, href: `/rental-invoices?search=${encodeURIComponent(detail.documentNumber)}` });
        } else if (prefix === "expense") {
          lines.push({ ...base, source: "expense", number: detail.documentNumber, aliasNumber: null, href: "/expenses" });
        } else if (prefix === "utility") {
          lines.push({ ...base, source: "utility_bill", number: detail.documentNumber, aliasNumber: null, href: "/utility-bills" });
        }
      }
    }
  };
  addPnlRows(pnl.revenue, "income");
  addPnlRows(pnl.costsOfSales, "expense");
  addPnlRows(pnl.expenses, "expense");

  return { accounts: [...accounts, ...pseudoAccounts], lines };
}

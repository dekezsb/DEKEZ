import "server-only";
import { renovationContext } from "./server";
import { allReportRows } from "@/lib/accounting/report-data";
import type { RenovationPayment, RenovationDocument } from "./model";
import type { BankLineOption } from "@/components/renovation/payments";

export async function renovationPaymentData(invoiceId?: string, statementIds?: string[]) {
  const { db, company } = await renovationContext();
  let paymentQuery = db.from("renovation_payment_submissions").select("*").eq("company_id", company.id);
  if (invoiceId) paymentQuery = paymentQuery.eq("invoice_id", invoiceId);
  const [payments, banks, lines, documents] = await Promise.all([
    allReportRows(paymentQuery.order("created_at", { ascending: false }).order("id")),
    allReportRows(db.from("bank_accounts").select("id,name").eq("company_id", company.id)),
    statementIds?.length ? allReportRows(db.from("bank_statement_lines").select("id,bank_account_id,transaction_date,description,reference_number,amount,bank_statement_imports!inner(company_id,status)").eq("bank_statement_imports.company_id", company.id).eq("bank_statement_imports.status", "in_progress").in("statement_import_id", statementIds).gt("amount", 0).neq("status", "ignored").is("duplicate_of_line_id", null)) : Promise.resolve({ data: [], error: null }),
    !invoiceId ? allReportRows(db.from("renovation_documents").select("id,document_number,client_snapshot,project").eq("company_id", company.id).eq("kind", "invoice").eq("status", "issued")) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([payments, banks, lines, documents].some(r => r.error)) throw new Error("Could not load renovation payment balances. No estimated balances are shown.");
  const sourceIds = payments.data.map(p => p.bank_transaction_id).filter(Boolean) as string[];
  const lineIds = lines.data.map(l => l.id);
  const sourceTotals = new Map<string, number>(), lineTotals = new Map<string, number>();
  const blocked = new Set<string>(), lineSources = new Map<string, string[]>();
  for (const [ids, key, totals] of [[sourceIds, "source_id", sourceTotals], [lineIds, "statement_line_id", lineTotals]] as const) {
    for (let offset = 0; offset < ids.length; offset += 100) {
      let query = db.from("bank_reconciliation_matches").select("source_type,source_id,statement_line_id,matched_amount").in(key, ids.slice(offset, offset + 100));
      if (key === "source_id") query = query.eq("source_type", "manual_bank_transaction");
      const result = await allReportRows(query);
      if (result.error) throw new Error("Could not load bank matching balances.");
      for (const match of result.data) totals.set(match[key], (totals.get(match[key]) ?? 0) + Number(match.matched_amount));
      if (key === "statement_line_id") for (const match of result.data) {
        if (match.source_type !== "manual_bank_transaction" || !sourceIds.includes(match.source_id)) blocked.add(match.statement_line_id);
        lineSources.set(match.statement_line_id, [...(lineSources.get(match.statement_line_id) ?? []),match.source_id]);
      }
    }
  }
  const signedPayments: RenovationPayment[] = await Promise.all((payments.data as RenovationPayment[]).map(async p => {
    const { data } = p.proof_path ? await db.storage.from("renovation-proofs").createSignedUrl(p.proof_path, 600) : { data: null };
    return { ...p, proofUrl: data?.signedUrl, matched: p.bank_transaction_id ? sourceTotals.get(p.bank_transaction_id) ?? 0 : 0 };
  }));
  const available: BankLineOption[] = lines.data.map(l => ({ ...l, blocked: blocked.has(l.id), matchedSourceIds:lineSources.get(l.id) ?? [], remaining: Number(l.amount) - (lineTotals.get(l.id) ?? 0) })).filter(l => l.remaining > 0.005);
  return { payments: signedPayments, banks: banks.data, lines: available, invoices: documents.data as Pick<RenovationDocument, "id" | "document_number" | "client_snapshot" | "project">[] };
}

// Receipt selection is not bank reconciliation: these receipts are already
// fully bank-confirmed. The RPC rechecks all eligibility and balances atomically.
export async function existingRenovationReceipts() {
  const { db, company } = await renovationContext(true);
  const { data: accounts, error: accountError } = await db.from("accounting_accounts").select("id")
    .eq("company_id", company.id).eq("is_active", true).in("code", ["4050", "1185"]);
  if (accountError) throw new Error("Could not load renovation accounts.");
  if (!accounts?.length) return [];
  const [receipts, links] = await Promise.all([
    allReportRows(db.from("bank_manual_transactions").select("id,correction_version,transaction_date,reference_number,description,amount")
      .eq("company_id", company.id).in("offset_account_id", accounts.map(a => a.id)).is("property_id", null).gt("amount", 0)
      .order("transaction_date", { ascending: false }).order("id")),
    allReportRows(db.from("renovation_payment_submissions").select("bank_transaction_id").eq("company_id", company.id).eq("status", "verified")),
  ]);
  if (receipts.error || links.error) throw new Error("Could not load existing renovation receipts.");
  const linked = new Set(links.data.map(p => p.bank_transaction_id));
  const available = receipts.data.filter(r => !linked.has(r.id));
  const sums = new Map<string, number>();
  for (let offset = 0; offset < available.length; offset += 100) {
    const matches = await allReportRows(db.from("bank_reconciliation_matches").select("source_id,matched_amount")
      .eq("source_type", "manual_bank_transaction").in("source_id", available.slice(offset, offset + 100).map(r => r.id)));
    if (matches.error) throw new Error("Could not confirm existing bank receipts.");
    for (const m of matches.data) sums.set(m.source_id, (sums.get(m.source_id) ?? 0) + Math.round(Number(m.matched_amount) * 100));
  }
  return available.filter(r => r.reference_number?.trim().length >= 3 && sums.get(r.id) === Math.round(Number(r.amount) * 100))
    .map(r => ({ ...r, amount: Number(r.amount) }));
}

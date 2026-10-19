import "server-only";
import { renovationContext } from "./server";
import { allReportRows } from "@/lib/accounting/report-data";
import type { RenovationPayment } from "./model";
import type { BankLineOption } from "@/components/renovation/payments";

export async function renovationPaymentData(invoiceId: string) {
  const { db, company } = await renovationContext();
  const [payments, banks, lines] = await Promise.all([
    allReportRows(db.from("renovation_payment_submissions").select("*").eq("company_id", company.id).eq("invoice_id", invoiceId)),
    allReportRows(db.from("bank_accounts").select("id,name").eq("company_id", company.id)),
    allReportRows(db.from("bank_statement_lines").select("id,bank_account_id,transaction_date,description,reference_number,amount,bank_statement_imports!inner(company_id,status)").eq("bank_statement_imports.company_id", company.id).eq("bank_statement_imports.status", "in_progress").gt("amount", 0).neq("status", "ignored").is("duplicate_of_line_id", null)),
  ]);
  if ([payments, banks, lines].some(r => r.error)) throw new Error("Could not load renovation payment balances. No estimated balances are shown.");
  const sourceIds = payments.data.map(p => p.bank_transaction_id).filter(Boolean) as string[];
  const lineIds = lines.data.map(l => l.id);
  const sourceTotals = new Map<string, number>(), lineTotals = new Map<string, number>();
  for (const [ids, key, totals] of [[sourceIds, "source_id", sourceTotals], [lineIds, "statement_line_id", lineTotals]] as const) {
    for (let offset = 0; offset < ids.length; offset += 100) {
      let query = db.from("bank_reconciliation_matches").select("source_id,statement_line_id,matched_amount").in(key, ids.slice(offset, offset + 100));
      if (key === "source_id") query = query.eq("source_type", "manual_bank_transaction");
      const result = await allReportRows(query);
      if (result.error) throw new Error("Could not load bank matching balances.");
      for (const match of result.data) totals.set(match[key], (totals.get(match[key]) ?? 0) + Number(match.matched_amount));
    }
  }
  const signedPayments: RenovationPayment[] = await Promise.all((payments.data as RenovationPayment[]).map(async p => {
    const { data } = await db.storage.from("renovation-proofs").createSignedUrl(p.proof_path, 600);
    return { ...p, proofUrl: data?.signedUrl, matched: p.bank_transaction_id ? sourceTotals.get(p.bank_transaction_id) ?? 0 : 0 };
  }));
  const available: BankLineOption[] = lines.data.map(l => ({ ...l, remaining: Number(l.amount) - (lineTotals.get(l.id) ?? 0) })).filter(l => l.remaining > 0.005);
  return { payments: signedPayments, banks: banks.data, lines: available };
}

import type { SupabaseClient } from "@supabase/supabase-js";

export const bankSourceTypes = [
  "payment",
  "expense_payment_batch",
  "staff_reimbursement_payout",
  "cash_bank_in",
  "expense",
  "manual_bank_transaction",
] as const;

export type BankSourceType = (typeof bankSourceTypes)[number];

export type BankCandidate = {
  sourceType: BankSourceType;
  sourceId: string;
  date: string;
  amount: number;
  description: string;
  referenceNumber: string | null;
  propertyId: string | null;
};

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

export async function getBankCandidates(
  supabase: SupabaseClient,
  companyId: string,
): Promise<BankCandidate[]> {
  const [paymentsResult, batchesResult, payoutsResult, bankInsResult, expensesResult, manualResult] = await Promise.all([
    supabase
      .from("payments")
      .select("id, payment_date, amount, category, reference_number, property_id, rent_bill_id, payment_method")
      .eq("company_id", companyId)
      .eq("status", "confirmed")
      .is("reversed_at", null)
      .not("payment_method", "in", '("cash","manual_adjustment")'),
    supabase
      .from("expense_payment_batches")
      .select("id, paid_on, total_amount, reference_number, payment_method")
      .eq("company_id", companyId)
      .in("payment_method", ["company_bank", "cheque"]),
    supabase
      .from("staff_reimbursement_payouts")
      .select("id, paid_on, total_amount, reference_number, payment_source")
      .eq("payment_source", "company_bank"),
    supabase
      .from("cash_bank_ins")
      .select("id, banked_on, amount, reference_number, bank_name, status")
      .eq("company_id", companyId)
      .neq("status", "cancelled"),
    supabase
      .from("expenses")
      .select("id, expense_date, amount, supplier, description, receipt_number, property_id")
      .eq("company_id", companyId)
      .eq("funding_source", "company_bank")
      .eq("payment_status", "paid")
      .in("status", ["verified", "reimbursed"]),
    supabase
      .from("bank_manual_transactions")
      .select("id, transaction_date, amount, description, reference_number")
      .eq("company_id", companyId),
  ]);

  const expenseIds = (expensesResult.data ?? []).map((expense) => expense.id);
  const { data: allocatedExpenses } = expenseIds.length
    ? await supabase
        .from("expense_payment_allocations")
        .select("expense_id")
        .in("expense_id", expenseIds)
    : { data: [] };
  const allocatedExpenseIds = new Set((allocatedExpenses ?? []).map((item) => item.expense_id));

  const candidates: BankCandidate[] = [];

  for (const payment of paymentsResult.data ?? []) {
    candidates.push({
      sourceType: "payment",
      sourceId: payment.id,
      date: payment.payment_date,
      amount: numberValue(payment.amount),
      description: `${String(payment.category ?? "Tenant payment").replaceAll("_", " ")} · ${payment.rent_bill_id ? "Invoice payment" : "Unallocated receipt"}`,
      referenceNumber: payment.reference_number,
      propertyId: payment.property_id,
    });
  }

  for (const batch of batchesResult.data ?? []) {
    candidates.push({
      sourceType: "expense_payment_batch",
      sourceId: batch.id,
      date: batch.paid_on,
      amount: -Math.abs(numberValue(batch.total_amount)),
      description: "Supplier expense payment batch",
      referenceNumber: batch.reference_number,
      propertyId: null,
    });
  }

  for (const payout of payoutsResult.data ?? []) {
    candidates.push({
      sourceType: "staff_reimbursement_payout",
      sourceId: payout.id,
      date: payout.paid_on,
      amount: -Math.abs(numberValue(payout.total_amount)),
      description: "Staff reimbursement payout",
      referenceNumber: payout.reference_number,
      propertyId: null,
    });
  }

  for (const bankIn of bankInsResult.data ?? []) {
    candidates.push({
      sourceType: "cash_bank_in",
      sourceId: bankIn.id,
      date: bankIn.banked_on,
      amount: Math.abs(numberValue(bankIn.amount)),
      description: `Cash bank-in${bankIn.bank_name ? ` · ${bankIn.bank_name}` : ""}`,
      referenceNumber: bankIn.reference_number,
      propertyId: null,
    });
  }

  for (const expense of expensesResult.data ?? []) {
    if (allocatedExpenseIds.has(expense.id)) continue;
    candidates.push({
      sourceType: "expense",
      sourceId: expense.id,
      date: expense.expense_date,
      amount: -Math.abs(numberValue(expense.amount)),
      description: expense.description || expense.supplier || "Company bank expense",
      referenceNumber: expense.receipt_number,
      propertyId: expense.property_id,
    });
  }

  for (const transaction of manualResult.data ?? []) {
    candidates.push({
      sourceType: "manual_bank_transaction",
      sourceId: transaction.id,
      date: transaction.transaction_date,
      amount: numberValue(transaction.amount),
      description: transaction.description,
      referenceNumber: transaction.reference_number,
      propertyId: null,
    });
  }

  return candidates.sort((left, right) => right.date.localeCompare(left.date));
}

export function dateDistance(left: string, right: string) {
  return Math.abs(
    Math.round(
      (new Date(`${left}T00:00:00Z`).getTime() - new Date(`${right}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
  );
}

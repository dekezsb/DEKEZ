import type { SupabaseClient } from "@supabase/supabase-js";

export const bankSourceTypes = [
  "payment",
  "rent_bill",
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
  isRental?: boolean;
  invoiceMonth?: string | null;
  invoiceNumber?: string | null;
  tenantName?: string | null;
  propertyName?: string | null;
  roomName?: string | null;
};

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

export async function getBankCandidates(
  supabase: SupabaseClient,
  companyId: string,
): Promise<BankCandidate[]> {
  const [paymentsResult, paidBillsResult, batchesResult, payoutsResult, bankInsResult, expensesResult, manualResult] = await Promise.all([
    supabase
      .from("payments")
      .select("id, payment_date, amount, category, reference_number, property_id, rent_bill_id, payment_method")
      .eq("company_id", companyId)
      .eq("status", "confirmed")
      .is("reversed_at", null)
      .not("payment_method", "in", '("cash","manual_adjustment")'),
    supabase
      .from("rent_bills")
      .select("id, due_date, bill_month, amount, paid_amount, invoice_number, property_id, room_id, tenant_record_id, properties!inner(company_id)")
      .eq("properties.company_id", companyId)
      .eq("status", "paid")
      .is("removed_at", null),
    supabase
      .from("expense_payment_batches")
      .select("id, paid_on, total_amount, reference_number, payment_method")
      .eq("company_id", companyId)
      .in("payment_method", ["company_bank", "company_card", "cheque"]),
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
  const batchIds = (batchesResult.data ?? []).map((batch) => batch.id);
  const payoutIds = (payoutsResult.data ?? []).map((payout) => payout.id);
  const [{ data: batchAllocations }, { data: payoutLiabilities }] = await Promise.all([
    batchIds.length
      ? supabase
          .from("expense_payment_allocations")
          .select("batch_id, amount, expenses(supplier, description)")
          .in("batch_id", batchIds)
      : Promise.resolve({ data: [] }),
    payoutIds.length
      ? supabase
          .from("staff_reimbursement_liabilities")
          .select("payout_id, staff_id, amount, expenses(supplier, description)")
          .in("payout_id", payoutIds)
      : Promise.resolve({ data: [] }),
  ]);
  const payoutStaffIds = Array.from(
    new Set((payoutLiabilities ?? []).map((item) => item.staff_id).filter(Boolean)),
  );
  const { data: payoutStaffProfiles } = payoutStaffIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", payoutStaffIds)
    : { data: [] };
  const payoutStaffNames = new Map(
    (payoutStaffProfiles ?? []).map((profile) => [profile.id, profile.full_name ?? "Staff member"]),
  );
  const batchItems = new Map<string, string[]>();
  for (const allocation of batchAllocations ?? []) {
    const expense = Array.isArray(allocation.expenses)
      ? allocation.expenses[0]
      : allocation.expenses;
    const values = batchItems.get(allocation.batch_id) ?? [];
    values.push(
      `${expense?.supplier || expense?.description || "Expense receipt"} ${numberValue(allocation.amount).toFixed(2)}`,
    );
    batchItems.set(allocation.batch_id, values);
  }
  const payoutItems = new Map<string, string[]>();
  const payoutPayee = new Map<string, string>();
  for (const liability of payoutLiabilities ?? []) {
    if (!liability.payout_id) continue;
    const expense = Array.isArray(liability.expenses)
      ? liability.expenses[0]
      : liability.expenses;
    const values = payoutItems.get(liability.payout_id) ?? [];
    values.push(
      `${expense?.supplier || expense?.description || "Claim receipt"} ${numberValue(liability.amount).toFixed(2)}`,
    );
    payoutItems.set(liability.payout_id, values);
    payoutPayee.set(
      liability.payout_id,
      payoutStaffNames.get(liability.staff_id) ?? "Staff member",
    );
  }

  const candidates: BankCandidate[] = [];
  const paidBills = paidBillsResult.data ?? [];
  const paymentBillIds = Array.from(new Set(
    (paymentsResult.data ?? []).map((payment) => payment.rent_bill_id).filter(Boolean),
  ));
  const { data: paymentBills } = paymentBillIds.length
    ? await supabase
        .from("rent_bills")
        .select("id, due_date, bill_month, amount, paid_amount, invoice_number, property_id, room_id, tenant_record_id")
        .in("id", paymentBillIds)
    : { data: [] };
  const billMap = new Map(
    [...paidBills, ...(paymentBills ?? [])].map((bill) => [bill.id, bill]),
  );
  const contextualBills = Array.from(billMap.values());
  const propertyIds = Array.from(new Set(contextualBills.map((bill) => bill.property_id).filter(Boolean)));
  const roomIds = Array.from(new Set(contextualBills.map((bill) => bill.room_id).filter(Boolean)));
  const tenantRecordIds = Array.from(new Set(contextualBills.map((bill) => bill.tenant_record_id).filter(Boolean)));
  const [propertiesResult, roomsResult, tenantsResult] = await Promise.all([
    propertyIds.length ? supabase.from("properties").select("id, name").in("id", propertyIds) : Promise.resolve({ data: [] }),
    roomIds.length ? supabase.from("rooms").select("id, name, room_number").in("id", roomIds) : Promise.resolve({ data: [] }),
    tenantRecordIds.length ? supabase.from("tenant_records").select("id, full_name").in("id", tenantRecordIds) : Promise.resolve({ data: [] }),
  ]);
  const propertyNames = new Map((propertiesResult.data ?? []).map((item) => [item.id, item.name]));
  const rooms = new Map((roomsResult.data ?? []).map((item) => [item.id, item]));
  const tenantNames = new Map((tenantsResult.data ?? []).map((item) => [item.id, item.full_name]));
  const paymentBillIdSet = new Set(paymentBillIds);

  for (const payment of paymentsResult.data ?? []) {
    const bill = payment.rent_bill_id ? billMap.get(payment.rent_bill_id) : null;
    const room = bill ? rooms.get(bill.room_id) : null;
    const propertyName = bill ? propertyNames.get(bill.property_id) ?? "Property" : null;
    const propertyCode = propertyName?.trim().toUpperCase().match(/^[A-Z]{3}/)?.[0] ?? propertyName;
    const roomName = room?.name || (room?.room_number ? `Room ${room.room_number}` : null);
    const tenantName = bill ? tenantNames.get(bill.tenant_record_id) ?? "Tenant" : null;
    const invoiceContext = bill
      ? `${propertyCode ?? "Property"} ${roomName ?? "Room"} · ${tenantName} · ${bill.invoice_number ?? bill.bill_month}`
      : "Unallocated receipt";
    candidates.push({
      sourceType: "payment",
      sourceId: payment.id,
      date: payment.payment_date,
      amount: numberValue(payment.amount),
      description: `${String(payment.category ?? "Tenant payment").replaceAll("_", " ")} · ${invoiceContext}`,
      referenceNumber: payment.reference_number,
      propertyId: payment.property_id,
      isRental: Boolean(bill) || payment.category === "monthly_rent",
      invoiceMonth: bill?.bill_month ?? null,
      invoiceNumber: bill?.invoice_number ?? null,
      tenantName,
      propertyName,
      roomName,
    });
  }

  for (const bill of paidBills) {
    if (paymentBillIdSet.has(bill.id)) continue;
    const paidAmount = numberValue(bill.paid_amount) || numberValue(bill.amount);
    if (paidAmount <= 0) continue;
    const room = rooms.get(bill.room_id);
    const propertyName = propertyNames.get(bill.property_id) ?? "Property";
    const propertyCode = propertyName.trim().toUpperCase().match(/^[A-Z]{3}/)?.[0] ?? propertyName;
    const roomName = room?.name || `Room ${room?.room_number ?? ""}`;
    candidates.push({
      sourceType: "rent_bill",
      sourceId: bill.id,
      date: bill.due_date || bill.bill_month,
      amount: Math.abs(paidAmount),
      description: `Paid invoice · ${propertyCode} ${roomName} · ${tenantNames.get(bill.tenant_record_id) ?? "Tenant"} · ${bill.invoice_number ?? bill.bill_month}`,
      referenceNumber: null,
      propertyId: bill.property_id,
      isRental: true,
      invoiceMonth: bill.bill_month,
      invoiceNumber: bill.invoice_number,
      tenantName: tenantNames.get(bill.tenant_record_id) ?? "Tenant",
      propertyName,
      roomName,
    });
  }

  for (const batch of batchesResult.data ?? []) {
    const items = batchItems.get(batch.id) ?? [];
    const method = batch.payment_method === "company_card" ? "Company card" : "Company bank";
    candidates.push({
      sourceType: "expense_payment_batch",
      sourceId: batch.id,
      date: batch.paid_on,
      amount: -Math.abs(numberValue(batch.total_amount)),
      description: `${method} · ${items.length} receipt${items.length === 1 ? "" : "s"}${items.length ? ` · ${items.slice(0, 3).join(" + ")}${items.length > 3 ? " + more" : ""}` : ""}`,
      referenceNumber: batch.reference_number,
      propertyId: null,
    });
  }

  for (const payout of payoutsResult.data ?? []) {
    const items = payoutItems.get(payout.id) ?? [];
    candidates.push({
      sourceType: "staff_reimbursement_payout",
      sourceId: payout.id,
      date: payout.paid_on,
      amount: -Math.abs(numberValue(payout.total_amount)),
      description: `Staff reimbursement · ${payoutPayee.get(payout.id) ?? "Staff member"} · ${items.length} claim${items.length === 1 ? "" : "s"}${items.length ? ` · ${items.slice(0, 3).join(" + ")}${items.length > 3 ? " + more" : ""}` : ""}`,
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

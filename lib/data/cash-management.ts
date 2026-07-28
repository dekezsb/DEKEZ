import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUserCompanies } from "./organization";

export type CompanyCashSummary = {
  companyId: string;
  companyName: string;
  cashCollected: number;
  paidOutOfCash: number;
  bankedIn: number;
  owedToStaff: number;
  cashInHand: number;
};

export type CashBankInRecord = {
  id: string;
  companyId: string;
  companyName: string;
  amount: number;
  bankedOn: string;
  bankName: string | null;
  referenceNumber: string | null;
  notes: string | null;
  status: "completed" | "cancelled";
  recordedBy: string;
  recordedByName: string;
  createdAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
};

export type CashManagementSummary = {
  cashCollected: number;
  paidOutOfCash: number;
  bankedIn: number;
  owedToStaff: number;
  cashInHand: number;
  companies: CompanyCashSummary[];
  bankIns: CashBankInRecord[];
};

type PaymentRow = {
  company_id: string;
  amount: number | string;
  payment_method: string | null;
  status: string;
};

type ExpenseRow = {
  company_id: string | null;
  amount: number | string;
  status: string;
  funding_source: string;
  reimbursement_source: string | null;
};

type BankInRow = {
  id: string;
  company_id: string;
  amount: number | string;
  banked_on: string;
  bank_name: string | null;
  reference_number: string | null;
  notes: string | null;
  status: "completed" | "cancelled";
  recorded_by: string;
  created_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

async function getDataClient() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function isCashPayment(method: string | null) {
  return ["cash", "cash_payment"].includes(method?.trim().toLowerCase() ?? "");
}

export async function getCashManagementSummary(): Promise<CashManagementSummary> {
  const companies = await getUserCompanies();

  if (!companies.length) {
    return {
      cashCollected: 0,
      paidOutOfCash: 0,
      bankedIn: 0,
      owedToStaff: 0,
      cashInHand: 0,
      companies: [],
      bankIns: [],
    };
  }

  const companyIds = companies.map((company) => company.id);
  const supabase = await getDataClient();
  const [paymentsResult, expensesResult, bankInsResult] = await Promise.all([
    supabase
      .from("payments")
      .select("company_id, amount, payment_method, status")
      .in("company_id", companyIds)
      .eq("status", "confirmed"),
    supabase
      .from("expenses")
      .select("company_id, amount, status, funding_source, reimbursement_source")
      .in("company_id", companyIds)
      .in("status", ["verified", "reimbursed"]),
    supabase
      .from("cash_bank_ins")
      .select("id, company_id, amount, banked_on, bank_name, reference_number, notes, status, recorded_by, created_at, cancelled_at, cancellation_reason")
      .in("company_id", companyIds)
      .order("banked_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const payments = ((paymentsResult.data ?? []) as PaymentRow[]).filter((payment) =>
    isCashPayment(payment.payment_method),
  );
  const expenses = (expensesResult.data ?? []) as ExpenseRow[];
  const bankIns = (bankInsResult.data ?? []) as BankInRow[];
  const profileIds = Array.from(new Set(bankIns.map((bankIn) => bankIn.recorded_by)));
  const { data: profiles } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [] };
  const profileNames = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.full_name?.trim() || "Admin"]),
  );
  const companyNames = new Map(companies.map((company) => [company.id, company.name]));

  const companySummaries = companies.map((company) => {
    const companyPayments = payments.filter((payment) => payment.company_id === company.id);
    const companyExpenses = expenses.filter((expense) => expense.company_id === company.id);
    const companyBankIns = bankIns.filter(
      (bankIn) => bankIn.company_id === company.id && bankIn.status === "completed",
    );
    const cashCollected = sum(companyPayments.map((payment) => Number(payment.amount ?? 0)));
    const directCashExpenses = companyExpenses.filter(
      (expense) => expense.funding_source === "company_cash",
    );
    const cashReimbursements = companyExpenses.filter(
      (expense) =>
        expense.funding_source === "staff_personal"
        && expense.status === "reimbursed"
        && expense.reimbursement_source === "company_cash",
    );
    const paidOutOfCash = sum(
      [...directCashExpenses, ...cashReimbursements].map((expense) =>
        Number(expense.amount ?? 0),
      ),
    );
    const owedToStaff = sum(
      companyExpenses
        .filter(
          (expense) =>
            expense.funding_source === "staff_personal"
            && expense.status === "verified",
        )
        .map((expense) => Number(expense.amount ?? 0)),
    );
    const bankedIn = sum(companyBankIns.map((bankIn) => Number(bankIn.amount ?? 0)));

    return {
      companyId: company.id,
      companyName: company.name,
      cashCollected,
      paidOutOfCash,
      bankedIn,
      owedToStaff,
      cashInHand: cashCollected - paidOutOfCash - bankedIn,
    };
  });

  return {
    cashCollected: sum(companySummaries.map((company) => company.cashCollected)),
    paidOutOfCash: sum(companySummaries.map((company) => company.paidOutOfCash)),
    bankedIn: sum(companySummaries.map((company) => company.bankedIn)),
    owedToStaff: sum(companySummaries.map((company) => company.owedToStaff)),
    cashInHand: sum(companySummaries.map((company) => company.cashInHand)),
    companies: companySummaries,
    bankIns: bankIns.map((bankIn) => ({
      id: bankIn.id,
      companyId: bankIn.company_id,
      companyName: companyNames.get(bankIn.company_id) ?? "Company",
      amount: Number(bankIn.amount ?? 0),
      bankedOn: bankIn.banked_on,
      bankName: bankIn.bank_name,
      referenceNumber: bankIn.reference_number,
      notes: bankIn.notes,
      status: bankIn.status,
      recordedBy: bankIn.recorded_by,
      recordedByName: profileNames.get(bankIn.recorded_by) ?? "Admin",
      createdAt: bankIn.created_at,
      cancelledAt: bankIn.cancelled_at,
      cancellationReason: bankIn.cancellation_reason,
    })),
  };
}

export async function getCompanyCashInHand(companyId: string) {
  const summary = await getCashManagementSummary();
  return summary.companies.find((company) => company.companyId === companyId) ?? null;
}

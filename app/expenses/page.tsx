import { FileImage, ReceiptText } from "lucide-react";
import { AddExpenseForm } from "@/components/expenses/add-expense-form";
import {
  ExpensePaymentBatchForm,
  type PayableExpense,
} from "@/components/expenses/expense-payment-batch-form";
import {
  StaffReimbursementPayoutForm,
  type StaffPayableBill,
} from "@/components/maintenance/staff-reimbursement-payout-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { statusBadgeClass } from "@/lib/status-styles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createExpenseCategory, reviewExpense } from "./actions";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type ExpenseRecord = {
  id: string;
  property_id: string | null;
  unit_id: string | null;
  room_id: string | null;
  maintenance_ticket_id: string | null;
  claim_id: string | null;
  category_id: string | null;
  expense_date: string;
  amount: number | string | null;
  tax_amount: number | string | null;
  supplier: string | null;
  description: string | null;
  paid_by: string | null;
  payment_method: string;
  funding_source: string;
  reimbursement_source: string | null;
  payment_status: string;
  paid_at: string | null;
  charge_to: string;
  status: string;
  tax_claimable: boolean;
  uploaded_by: string | null;
  verified_at: string | null;
  created_at: string;
  expense_categories?: { name: string } | { name: string }[] | null;
  properties?: { name: string } | { name: string }[] | null;
  units?: { name: string } | { name: string }[] | null;
  rooms?: { name: string; room_number: string | null } | { name: string; room_number: string | null }[] | null;
  maintenance_tickets?: { ticket_number: string | null } | { ticket_number: string | null }[] | null;
};

type AttachmentRecord = {
  id: string;
  expense_id: string;
  file_path: string;
  file_name: string | null;
  content_type: string | null;
  signedUrl?: string | null;
};

type PageProps = {
  searchParams: Promise<{
    created?: string;
    reviewed?: string;
    payment_recorded?: string;
    payout_recorded?: string;
    error?: string;
    month?: string;
    year?: string;
    property?: string;
    category?: string;
    status?: string;
    charge_to?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please enter amount and category.",
  create: "Expense could not be saved.",
  upload: "Receipt upload failed.",
  category_missing: "Please enter a category name.",
  category_create: "Category could not be created.",
  review_missing: "Choose an expense and review action.",
  review: "Expense review could not be saved.",
  payment_missing:
    "Select at least one bill, enter the payment details, and attach a bank slip or card statement up to 3 MB.",
  payment_changed:
    "One of the selected bills was already paid or changed. Refresh and select the unpaid bills again.",
  payment_proof: "The payment slip or card statement could not be uploaded.",
  payout_missing:
    "Tick at least one staff bill, enter the payout details, and attach a bank slip or proof up to 3 MB.",
  payout_changed:
    "One of the selected staff bills was already paid or changed. Refresh and select the unpaid bills again.",
  payout_proof: "The staff payout proof could not be uploaded.",
  payout_receipt_missing:
    "Every staff bill must have its receipt attached before it can be paid and knocked off.",
  use_claim_payout:
    "Use Verification → Claim Bills to record a staff lump-sum payout with proof.",
};

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function money(value: number | string | null | undefined) {
  return ringgitFormatter.format(Number(value ?? 0));
}

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function monthKey(dateText: string) {
  return dateText.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("en-MY", { month: "long", year: "numeric" }).toUpperCase();
}

function sumExpenses(expenses: ExpenseRecord[]) {
  return expenses.reduce((total, expense) => total + Number(expense.amount ?? 0), 0);
}

function groupByMonth(expenses: ExpenseRecord[]) {
  const groups = new Map<string, ExpenseRecord[]>();

  for (const expense of expenses) {
    const key = monthKey(expense.expense_date);
    groups.set(key, [...(groups.get(key) ?? []), expense]);
  }

  return Array.from(groups.entries()).sort(([left], [right]) => right.localeCompare(left));
}

function categorySummary(expenses: ExpenseRecord[]) {
  const totals = new Map<string, number>();

  for (const expense of expenses) {
    const category = single(expense.expense_categories)?.name ?? "Other";
    totals.set(category, (totals.get(category) ?? 0) + Number(expense.amount ?? 0));
  }

  return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
}

export default async function ExpensesPage({ searchParams }: PageProps) {
  const role = await requireRole([
    "super_admin",
    "owner",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
  ]);
  const params = await searchParams;
  const supabase = await getAdmin();
  const currentDate = new Date();
  const malaysiaToday = currentDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
  const selectedMonth = params.month ?? String(currentDate.getMonth() + 1).padStart(2, "0");
  const selectedYear = params.year ?? String(currentDate.getFullYear());
  const canVerify = ["super_admin", "owner", "admin"].includes(role);
  const canRecordPayments = ["super_admin", "admin"].includes(role);

  let expenseQuery = supabase
    .from("expenses")
    .select("id, property_id, unit_id, room_id, maintenance_ticket_id, claim_id, category_id, expense_date, amount, tax_amount, supplier, description, paid_by, payment_method, funding_source, reimbursement_source, payment_status, paid_at, charge_to, status, tax_claimable, uploaded_by, verified_at, created_at, expense_categories(name), properties(name), units(name), rooms(name, room_number), maintenance_tickets(ticket_number)")
    .order("expense_date", { ascending: false });

  if (selectedMonth && selectedYear) {
    const start = `${selectedYear}-${selectedMonth}-01`;
    const endDate = new Date(Number(selectedYear), Number(selectedMonth), 1);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`;
    expenseQuery = expenseQuery.gte("expense_date", start).lt("expense_date", end);
  }
  if (params.property) {
    expenseQuery = expenseQuery.eq("property_id", params.property);
  }
  if (params.category) {
    expenseQuery = expenseQuery.eq("category_id", params.category);
  }
  if (params.status) {
    expenseQuery = expenseQuery.eq("status", params.status);
  }
  if (params.charge_to) {
    expenseQuery = expenseQuery.eq("charge_to", params.charge_to);
  }

  const [
    expensesResult,
    categoriesResult,
    propertiesResult,
    unitsResult,
    roomsResult,
    ticketsResult,
    claimsResult,
    profilesResult,
    payableExpensesResult,
    paymentBatchesResult,
    reimbursementLiabilitiesResult,
    reimbursementPayoutsResult,
    payoutProfilesResult,
  ] = await Promise.all([
    expenseQuery,
    supabase.from("expense_categories").select("id, name").order("name", { ascending: true }),
    supabase.from("properties").select("id, name").order("name", { ascending: true }),
    supabase.from("units").select("id, property_id, name").order("name", { ascending: true }),
    supabase.from("rooms").select("id, property_id, unit_id, name, room_number").order("name", { ascending: true }),
    supabase.from("maintenance_tickets").select("id, ticket_number, description, status").order("created_at", { ascending: false }).limit(100),
    supabase.from("claims").select("id, description, status, total_amount").order("submitted_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("id, full_name, role").order("full_name", { ascending: true }),
    canRecordPayments
      ? supabase
          .from("expenses")
          .select("id, amount, expense_date, supplier, description, expense_categories(name), properties(name), rooms(name, room_number)")
          .eq("status", "verified")
          .eq("payment_status", "unpaid")
          .in("funding_source", ["company_cash", "company_bank"])
          .order("expense_date", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    canRecordPayments
      ? supabase
          .from("expense_payment_batches")
          .select("id, total_amount, payment_method, paid_on, reference_number, notes, proof_bucket_name, proof_file_path, proof_file_name, proof_content_type, retain_until, recorded_by, created_at, expense_payment_allocations(id, expense_id, amount)")
          .order("paid_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    canRecordPayments
      ? supabase
          .from("staff_reimbursement_liabilities")
          .select("id, claim_id, expense_id, staff_id, amount, status, owed_at, paid_at, payout_id")
          .order("owed_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    canRecordPayments
      ? supabase
          .from("staff_reimbursement_payouts")
          .select("id, staff_id, total_amount, payment_source, paid_on, reference_number, notes, proof_bucket_name, proof_file_path, proof_content_type, retain_until, recorded_by, created_at")
          .order("paid_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    canRecordPayments
      ? supabase
          .from("profiles")
          .select("id, full_name, bank_name, bank_account_holder, bank_account_number")
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const expenses = (expensesResult.data ?? []) as ExpenseRecord[];
  const categories = categoriesResult.data ?? [];
  const properties = propertiesResult.data ?? [];
  const units = unitsResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const tickets = ticketsResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const profiles = profilesResult.data ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile.full_name ?? profile.id]));
  const profileDetailsById = new Map(
    (payoutProfilesResult.data ?? []).map((profile) => [
      profile.id,
      profile,
    ]),
  );
  const reimbursementLiabilities =
    reimbursementLiabilitiesResult.data ?? [];
  const reimbursementPayouts = reimbursementPayoutsResult.data ?? [];
  const payableExpenses: PayableExpense[] = (payableExpensesResult.data ?? []).map(
    (expense) => {
      const room = single(expense.rooms);
      return {
        id: expense.id,
        amount: Number(expense.amount ?? 0),
        expenseDate: expense.expense_date,
        supplier: expense.supplier,
        description: expense.description,
        categoryName: single(expense.expense_categories)?.name ?? "Other",
        propertyName:
          single(expense.properties)?.name ?? "General Company Expense",
        roomName: room?.room_number ?? room?.name ?? null,
      };
    },
  );
  const paymentBatches = await Promise.all(
    (paymentBatchesResult.data ?? []).map(async (batch) => {
      const { data } = await supabase.storage
        .from(batch.proof_bucket_name)
        .createSignedUrl(batch.proof_file_path, 60 * 10);
      return { ...batch, signedUrl: data?.signedUrl ?? null };
    }),
  );
  const reimbursementPayoutsWithProof = await Promise.all(
    reimbursementPayouts.map(async (payout) => {
      const { data } = await supabase.storage
        .from(payout.proof_bucket_name)
        .createSignedUrl(payout.proof_file_path, 60 * 10);
      return { ...payout, signedUrl: data?.signedUrl ?? null };
    }),
  );

  const owedLiabilities = reimbursementLiabilities.filter(
    (liability) => liability.status === "owed",
  );
  const liabilityExpenseIds = owedLiabilities.map(
    (liability) => liability.expense_id,
  );
  const [liabilityExpensesResult, liabilityAttachmentsResult] =
    liabilityExpenseIds.length
      ? await Promise.all([
          supabase
            .from("expenses")
            .select("id, expense_date, amount, supplier, description, expense_categories(name), properties(name), rooms(name, room_number)")
            .in("id", liabilityExpenseIds),
          supabase
            .from("expense_attachments")
            .select("id, expense_id, bucket_name, file_path, file_name, content_type")
            .in("expense_id", liabilityExpenseIds),
        ])
      : [{ data: [] }, { data: [] }];
  const liabilityExpenseById = new Map(
    (liabilityExpensesResult.data ?? []).map((expense) => [
      expense.id,
      expense,
    ]),
  );
  const liabilityAttachmentsWithUrls = await Promise.all(
    (liabilityAttachmentsResult.data ?? []).map(async (attachment) => {
      const { data } = await supabase.storage
        .from(attachment.bucket_name || "expense-receipts")
        .createSignedUrl(attachment.file_path, 60 * 10);
      return {
        ...attachment,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );
  const liabilityReceiptsByExpense = new Map<
    string,
    { fileName: string; url: string }[]
  >();
  for (const attachment of liabilityAttachmentsWithUrls) {
    if (!attachment.signedUrl) continue;
    const receipts =
      liabilityReceiptsByExpense.get(attachment.expense_id) ?? [];
    receipts.push({
      fileName: attachment.file_name || "View receipt",
      url: attachment.signedUrl,
    });
    liabilityReceiptsByExpense.set(attachment.expense_id, receipts);
  }
  const staffPayablesById = new Map<
    string,
    {
      liabilityIds: string[];
      items: StaffPayableBill[];
      total: number;
    }
  >();
  for (const liability of owedLiabilities) {
    const expense = liabilityExpenseById.get(liability.expense_id);
    if (!expense) continue;
    const room = single(expense.rooms);
    const group = staffPayablesById.get(liability.staff_id) ?? {
      liabilityIds: [],
      items: [],
      total: 0,
    };
    const amount = Number(liability.amount ?? 0);
    group.liabilityIds.push(liability.id);
    group.items.push({
      amount,
      categoryName: single(expense.expense_categories)?.name ?? "Other",
      description: expense.description,
      expenseDate: expense.expense_date,
      liabilityId: liability.id,
      propertyName:
        single(expense.properties)?.name ?? "General Company Expense",
      receipts: liabilityReceiptsByExpense.get(expense.id) ?? [],
      roomName: room?.room_number ?? room?.name ?? null,
      supplier: expense.supplier,
    });
    group.total += amount;
    staffPayablesById.set(liability.staff_id, group);
  }
  const totalStaffOwing = owedLiabilities.reduce(
    (total, liability) => total + Number(liability.amount ?? 0),
    0,
  );
  const liabilityCountByPayout = new Map<string, number>();
  for (const liability of reimbursementLiabilities) {
    if (!liability.payout_id) continue;
    liabilityCountByPayout.set(
      liability.payout_id,
      (liabilityCountByPayout.get(liability.payout_id) ?? 0) + 1,
    );
  }

  const [attachmentsResult, paymentAllocationsResult] = expenses.length
    ? await Promise.all([
        supabase
          .from("expense_attachments")
          .select("id, expense_id, file_path, file_name, content_type")
          .in("expense_id", expenses.map((expense) => expense.id)),
        supabase
          .from("expense_payment_allocations")
          .select("expense_id, batch_id")
          .in("expense_id", expenses.map((expense) => expense.id)),
      ])
    : [{ data: [] }, { data: [] }];
  const attachmentsData = attachmentsResult.data ?? [];
  const paymentAllocationByExpense = new Map(
    (paymentAllocationsResult.data ?? []).map((allocation) => [
      allocation.expense_id,
      allocation.batch_id,
    ]),
  );
  const paymentBatchById = new Map(
    paymentBatches.map((batch) => [batch.id, batch]),
  );

  const attachmentsWithUrls = await Promise.all(
    ((attachmentsData ?? []) as AttachmentRecord[]).map(async (attachment) => {
      const { data } = await supabase.storage
        .from("expense-receipts")
        .createSignedUrl(attachment.file_path, 60 * 10);
      return { ...attachment, signedUrl: data?.signedUrl ?? null };
    }),
  );
  const attachmentsByExpense = new Map<string, AttachmentRecord[]>();
  for (const attachment of attachmentsWithUrls) {
    const list = attachmentsByExpense.get(attachment.expense_id) ?? [];
    list.push(attachment);
    attachmentsByExpense.set(attachment.expense_id, list);
  }

  const groupedExpenses = groupByMonth(expenses);
  const totalThisMonth = sumExpenses(expenses.filter((expense) => expense.status !== "rejected"));
  const propertyExpenses = sumExpenses(expenses.filter((expense) => expense.property_id && expense.status === "verified"));
  const companyExpenses = sumExpenses(expenses.filter((expense) => expense.charge_to === "company" && expense.status === "verified"));
  const pendingExpenses = expenses.filter((expense) => expense.status === "pending_verification").length;
  const taxClaimable = sumExpenses(expenses.filter((expense) => expense.tax_claimable && expense.status === "verified"));
  const awaitingPayment = payableExpenses.reduce(
    (total, expense) => total + expense.amount,
    0,
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b98a2c]">Expense Bills</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Expense Bills</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Monthly receipt, invoice, property expense and claim-linked spending records.
          </p>
        </div>
        <Button asChild className="bg-[#b98a2c] text-white hover:bg-[#9d7424]">
          <a href="#add-expense">+ Add Expense</a>
        </Button>
      </div>

      {params.created ? (
        <div className="rounded-lg border border-[#b98a2c]/30 bg-white px-4 py-3 text-sm font-medium text-[#9d7424] shadow-sm">
          Saved successfully.
        </div>
      ) : null}
      {params.reviewed === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Expense review saved.
        </div>
      ) : null}
      {params.payment_recorded === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Combined payment recorded. Every selected bill is now marked paid and
          linked to the same retained proof.
        </div>
      ) : null}
      {params.payout_recorded === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Staff payout recorded. The selected bills are no longer company
          owing and the bank slip is retained with the payee record.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Expense could not be saved."}
        </div>
      ) : null}

      <AddExpenseForm
        categories={categories}
        claims={claims}
        profiles={profiles}
        properties={properties}
        rooms={rooms}
        tickets={tickets}
        units={units}
      />

      {canRecordPayments ? (
        <Card id="staff-ap-payments">
          <CardHeader>
            <CardTitle>Staff AP Payments</CardTitle>
            <CardDescription>
              Pay staff reimbursements like an AP knock-off: choose one payee,
              tick the bills covered by the payment, and attach one bank slip.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">
                  Company owing all staff
                </p>
                <p className="mt-2 text-2xl font-bold text-red-700">
                  {money(totalStaffOwing)}
                </p>
              </div>
              <div className="rounded-lg border border-[#d7dde5] bg-white p-4">
                <p className="text-sm text-gray-600">Staff payees owing</p>
                <p className="mt-2 text-2xl font-bold text-gray-950">
                  {staffPayablesById.size}
                </p>
              </div>
              <div className="rounded-lg border border-[#d7dde5] bg-white p-4">
                <p className="text-sm text-gray-600">
                  Verified bills not yet paid back
                </p>
                <p className="mt-2 text-2xl font-bold text-gray-950">
                  {owedLiabilities.length}
                </p>
              </div>
            </div>

            {staffPayablesById.size ? (
              <div className="space-y-4">
                {[...staffPayablesById.entries()]
                  .sort(([leftId], [rightId]) =>
                    (profileDetailsById.get(leftId)?.full_name ?? leftId)
                      .localeCompare(
                        profileDetailsById.get(rightId)?.full_name ?? rightId,
                      ),
                  )
                  .map(([staffId, group]) => {
                    const profile = profileDetailsById.get(staffId);
                    return (
                      <StaffReimbursementPayoutForm
                        bankAccountHolder={
                          profile?.bank_account_holder ?? null
                        }
                        bankAccountNumber={
                          profile?.bank_account_number ?? null
                        }
                        bankName={profile?.bank_name ?? null}
                        items={group.items}
                        key={staffId}
                        liabilityIds={group.liabilityIds}
                        paidOn={malaysiaToday}
                        returnTo="expenses"
                        staffId={staffId}
                        staffName={profile?.full_name ?? "Staff member"}
                        total={group.total}
                      />
                    );
                  })}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                Company does not currently owe any verified staff-funded bills.
              </div>
            )}

            {reimbursementPayoutsWithProof.length ? (
              <div className="space-y-3 border-t border-[#e3e8ef] pt-5">
                <div>
                  <h3 className="font-semibold text-gray-950">
                    Recent staff AP payments
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Each payment shows who was paid and keeps its bank slip with
                    every knocked-off bill for audit.
                  </p>
                </div>
                {reimbursementPayoutsWithProof.map((payout) => (
                  <details
                    className="rounded-lg border border-[#d7dde5] bg-white p-4"
                    id={`staff-payout-${payout.id}`}
                    key={payout.id}
                  >
                    <summary className="grid cursor-pointer gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <span>
                        <span className="block font-medium text-gray-950">
                          Pay to:{" "}
                          {profileDetailsById.get(payout.staff_id)?.full_name ??
                            "Staff member"}
                        </span>
                        <span className="mt-1 block text-sm text-gray-600">
                          {payout.paid_on} -{" "}
                          {payout.payment_source.replaceAll("_", " ")} -{" "}
                          {liabilityCountByPayout.get(payout.id) ?? 0} bill
                          {(liabilityCountByPayout.get(payout.id) ?? 0) === 1
                            ? ""
                            : "s"}{" "}
                          - Ref {payout.reference_number ?? "-"} - Retain until{" "}
                          {payout.retain_until}
                        </span>
                      </span>
                      <span className="font-semibold text-emerald-700">
                        {money(payout.total_amount)}
                      </span>
                    </summary>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e3e8ef] pt-4">
                      <p className="text-sm text-gray-600">
                        {payout.notes || "No additional payout notes."}
                      </p>
                      {payout.signedUrl ? (
                        <DocumentPreview
                          contentType={payout.proof_content_type}
                          fileName={
                            payout.proof_file_path.split("/").at(-1) ??
                            "Staff payout proof"
                          }
                          label="Bank slip / payout proof"
                          url={payout.signedUrl}
                        />
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canRecordPayments ? (
        <Card id="payment-knockoff">
          <CardHeader>
            <CardTitle>Pay Company-Funded Expense Bills</CardTitle>
            <CardDescription>
              Select several verified unpaid bills, then attach one bank slip
              or company-card statement for the exact combined payment. Staff
              reimbursements are handled separately above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ExpensePaymentBatchForm
              expenses={payableExpenses}
              paidOn={malaysiaToday}
            />

            {paymentBatches.length ? (
              <div className="space-y-3 border-t border-[#e3e8ef] pt-5">
                <h3 className="font-semibold text-gray-950">
                  Recent combined payments
                </h3>
                {paymentBatches.map((batch) => (
                  <details
                    className="rounded-lg border border-[#d7dde5] bg-white p-4"
                    id={`payment-batch-${batch.id}`}
                    key={batch.id}
                  >
                    <summary className="grid cursor-pointer gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <span>
                        <span className="block font-medium text-gray-950">
                          {batch.paid_on} ·{" "}
                          {batch.payment_method.replaceAll("_", " ")}
                        </span>
                        <span className="mt-1 block text-sm text-gray-600">
                          {batch.expense_payment_allocations?.length ?? 0} bill
                          {(batch.expense_payment_allocations?.length ?? 0) === 1
                            ? ""
                            : "s"}{" "}
                          · Ref {batch.reference_number ?? "-"} · Retain until{" "}
                          {batch.retain_until}
                        </span>
                      </span>
                      <span className="font-semibold text-gray-950">
                        {money(batch.total_amount)}
                      </span>
                    </summary>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e3e8ef] pt-4">
                      <p className="text-sm text-gray-600">
                        {batch.notes || "No additional payment notes."}
                      </p>
                      {batch.signedUrl ? (
                        <DocumentPreview
                          contentType={batch.proof_content_type}
                          fileName={batch.proof_file_name}
                          label="Payment proof"
                          url={batch.signedUrl}
                        />
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <SummaryCard title="Total Expenses This Month" value={money(totalThisMonth)} />
        <SummaryCard title="Property Expenses" value={money(propertyExpenses)} />
        <SummaryCard title="Company Expenses" value={money(companyExpenses)} />
        <SummaryCard title="Pending Verification" value={pendingExpenses} />
        <SummaryCard title="Awaiting Payment" value={money(awaitingPayment)} />
        <SummaryCard title="Company Owing Staff" value={money(totalStaffOwing)} />
        <SummaryCard title="Tax Claimable" value={money(taxClaimable)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter by month, property, category, status and charge type.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-6" method="get">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Month</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="month" defaultValue={selectedMonth}>
                {Array.from({ length: 12 }, (_, index) => {
                  const value = String(index + 1).padStart(2, "0");
                  return <option key={value} value={value}>{value}</option>;
                })}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Year</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="year" defaultValue={selectedYear} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Property</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="property" defaultValue={params.property ?? ""}>
                <option value="">All</option>
                {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Category</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="category" defaultValue={params.category ?? ""}>
                <option value="">All</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Status</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="status" defaultValue={params.status ?? ""}>
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="pending_verification">Pending verification</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
                <option value="reimbursed">Reimbursed</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Charge to</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="charge_to" defaultValue={params.charge_to ?? ""}>
                <option value="">All</option>
                <option value="company">Company</option>
                <option value="owner">Owner</option>
                <option value="tenant">Tenant</option>
              </select>
            </label>
            <Button className="lg:col-span-6" type="submit" variant="outline">Apply filters</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {groupedExpenses.map(([key, monthExpenses]) => (
            <Card key={key}>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>{monthLabel(key)} - {monthExpenses.length} BILLS</CardTitle>
                    <CardDescription>Total: {money(sumExpenses(monthExpenses))}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {categorySummary(monthExpenses).slice(0, 5).map(([category, total]) => (
                      <Badge className="bg-[#f4ead7] text-[#9d7424]" key={category}>{category} - {money(total)}</Badge>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {monthExpenses.map((expense) => {
                  const category = single(expense.expense_categories)?.name ?? "Other";
                  const property = single(expense.properties)?.name ?? "General Company Expense";
                  const room = single(expense.rooms);
                  const ticket = single(expense.maintenance_tickets);
                  const attachments = attachmentsByExpense.get(expense.id) ?? [];
                  const firstAttachment = attachments[0];
                  const isImage = firstAttachment?.content_type?.startsWith("image/");
                  const paymentBatchId =
                    paymentAllocationByExpense.get(expense.id) ?? null;
                  const paymentBatch = paymentBatchId
                    ? paymentBatchById.get(paymentBatchId)
                    : null;
                  const paymentDisplayStatus =
                    expense.funding_source === "staff_personal"
                      ? expense.payment_status === "paid" ||
                        expense.status === "reimbursed"
                        ? "paid back to staff"
                        : "owed to staff"
                      : expense.payment_status === "paid"
                        ? "paid"
                        : expense.status === "verified"
                          ? "awaiting payment"
                          : "not ready for payment";
                  const paymentBadgeStatus =
                    expense.payment_status === "paid" ||
                    expense.status === "reimbursed"
                      ? "paid"
                      : expense.status === "verified"
                        ? "unpaid"
                        : "pending";

                  return (
                    <details className="rounded-lg border border-[#d7dde5] bg-white p-4" key={expense.id}>
                      <summary className="grid cursor-pointer gap-4 sm:grid-cols-[72px_1fr_auto] sm:items-center">
                        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-[#f4f6f8]">
                          {firstAttachment?.signedUrl && isImage ? (
                            <img alt={`Receipt for ${category}`} className="h-full w-full object-cover" src={firstAttachment.signedUrl} />
                          ) : (
                            <FileImage className="h-6 w-6 text-[#496386]" />
                          )}
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-[#07142f]">{money(expense.amount)}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                             <Badge>{category}</Badge>
                             <Badge className={statusBadgeClass(expense.status)}>{expense.status}</Badge>
                             <Badge className={statusBadgeClass(paymentBadgeStatus)}>
                               {paymentDisplayStatus}
                             </Badge>
                             <Badge className="bg-[#eef3f9] text-[#496386]">charge to {expense.charge_to}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-[#496386]">
                            {expense.expense_date} - {property}
                            {room ? ` - ${room.room_number ?? room.name}` : ""}
                          </p>
                          <p className="text-sm text-[#496386]">Uploaded by {profileById.get(expense.uploaded_by ?? "") ?? "-"}</p>
                        </div>
                        <span className="text-sm font-medium text-[#b98a2c]">View details</span>
                      </summary>
                      <div className="mt-4 grid gap-4 border-t border-[#e3e8ef] pt-4 lg:grid-cols-2">
                        <div className="space-y-2 text-sm text-gray-600">
                          <p>Supplier: {expense.supplier ?? "-"}</p>
                          <p>Description: {expense.description ?? "-"}</p>
                           <p>Payment method: {expense.payment_method}</p>
                           <p>Paid from: {expense.funding_source.replaceAll("_", " ")}</p>
                           <p>Payment status: {paymentDisplayStatus}</p>
                           {expense.paid_at ? (
                             <p>
                               Payment recorded:{" "}
                               {new Date(expense.paid_at).toLocaleString("en-MY", {
                                 timeZone: "Asia/Kuala_Lumpur",
                               })}
                             </p>
                           ) : null}
                          {expense.reimbursement_source ? (
                            <p>Reimbursed from: {expense.reimbursement_source.replaceAll("_", " ")}</p>
                          ) : null}
                          <p>Tax amount: {money(expense.tax_amount)}</p>
                          <p>Tax claimable: {expense.tax_claimable ? "Yes" : "No"}</p>
                          <p>Maintenance ticket: {ticket?.ticket_number ?? "-"}</p>
                          <p>Claim link: {expense.claim_id ?? "-"}</p>
                        </div>
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-3">
                            {attachments.map((attachment) => (
                              attachment.signedUrl ? (
                                <DocumentPreview
                                  contentType={attachment.content_type}
                                  fileName={attachment.file_name}
                                  key={attachment.id}
                                  label="Expense receipt"
                                  url={attachment.signedUrl}
                                />
                              ) : null
                             ))}
                           </div>
                           {paymentBatchId ? (
                             <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                               <p className="font-semibold">
                                 Paid in a retained combined payment
                               </p>
                               <p className="mt-1">
                                 This bill is locked to prevent audit records
                                 from being changed after payment.
                               </p>
                               {paymentBatch ? (
                                 <div className="mt-3 flex flex-wrap items-center gap-3">
                                   <a
                                     className="font-medium text-[#126b5f] underline"
                                     href={`#payment-batch-${paymentBatch.id}`}
                                   >
                                     Ref {paymentBatch.reference_number ?? "-"} ·{" "}
                                     {paymentBatch.paid_on}
                                   </a>
                                   {paymentBatch.signedUrl ? (
                                     <DocumentPreview
                                       contentType={paymentBatch.proof_content_type}
                                       fileName={paymentBatch.proof_file_name}
                                       label="Combined payment proof"
                                       url={paymentBatch.signedUrl}
                                     />
                                   ) : null}
                                 </div>
                               ) : (
                                 <p className="mt-2">
                                   The linked payment record is retained in the
                                   combined payment archive above.
                                 </p>
                               )}
                             </div>
                           ) : null}
                           {canVerify && !paymentBatchId ? (
                             <form action={reviewExpense} className="grid gap-3">
                              <input name="expenseId" type="hidden" value={expense.id} />
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">
                                  Bill date
                                </span>
                                <input
                                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                                  defaultValue={expense.expense_date}
                                  name="expenseDate"
                                  required
                                  type="date"
                                />
                                <span className="mt-1 block text-xs text-gray-500">
                                  Expense reports use this month.
                                </span>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Correct amount</span>
                                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="amount" type="number" step="0.01" defaultValue={Number(expense.amount ?? 0)} />
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Category</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="categoryId" defaultValue={expense.category_id ?? ""}>
                                  {categories.map((categoryItem) => <option key={categoryItem.id} value={categoryItem.id}>{categoryItem.name}</option>)}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Property</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="propertyId" defaultValue={expense.property_id ?? ""}>
                                  <option value="">General company expense</option>
                                  {properties.map((propertyItem) => <option key={propertyItem.id} value={propertyItem.id}>{propertyItem.name}</option>)}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Charge to</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="chargeTo" defaultValue={expense.charge_to}>
                                  <option value="company">Company</option>
                                  <option value="owner">Owner</option>
                                  <option value="tenant">Tenant</option>
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">Originally paid from</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="fundingSource" defaultValue={expense.funding_source}>
                                  <option value="company_cash">Company cash</option>
                                  <option value="company_bank">Company bank</option>
                                  <option value="staff_personal">Staff personal money</option>
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-medium text-gray-700">When reimbursing, pay from</span>
                                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="reimbursementSource" defaultValue={expense.reimbursement_source ?? "company_bank"}>
                                  <option value="company_bank">Company bank</option>
                                  <option value="company_cash">Company cash</option>
                                </select>
                              </label>
                              <input className="rounded-md border border-[#d7dde5] px-3 py-2" name="rejectionReason" placeholder="Reason if rejecting" />
                              <div className="grid gap-2 sm:grid-cols-3">
                                <Button name="decision" type="submit" value="verified">Verify</Button>
                                {expense.claim_id &&
                                expense.funding_source === "staff_personal" ? (
                                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
                                    Use Claim Bills lump-sum payout
                                  </div>
                                ) : (
                                  <Button name="decision" type="submit" value="reimbursed" variant="outline">Reimbursed</Button>
                                )}
                                <Button className="border-red-200 text-red-700 hover:bg-red-50" name="decision" type="submit" value="rejected" variant="outline">Reject</Button>
                              </div>
                            </form>
                          ) : null}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </CardContent>
            </Card>
          ))}
          {!groupedExpenses.length ? (
            <Card>
              <CardHeader>
                <CardTitle>No expense bills found</CardTitle>
                <CardDescription>Add your first receipt or change the filters.</CardDescription>
              </CardHeader>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {canVerify ? (
            <Card>
              <CardHeader>
                <CardTitle>Categories</CardTitle>
                <CardDescription>Create custom expense categories.</CardDescription>
              </CardHeader>
              <CardContent>
                <form action={createExpenseCategory} className="space-y-3">
                  <input className="w-full rounded-md border border-[#d7dde5] px-3 py-2" name="categoryName" placeholder="Category name" />
                  <input className="w-full rounded-md border border-[#d7dde5] px-3 py-2" name="categoryDescription" placeholder="Description optional" />
                  <Button className="w-full" type="submit" variant="outline">Add category</Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SummaryCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card>
      <CardHeader>
        <ReceiptText className="h-5 w-5 text-[#b98a2c]" />
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

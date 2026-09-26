import { CheckCircle2, Clock, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { formatMalaysiaDate } from "@/lib/date-format";
import { money } from "@/lib/e-tenancy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProperties } from "@/lib/data/organization";
import { PaymentSlipRow } from "./payment-slip-row";
import { paymentMatchesFilters } from "@/lib/payments/verification-row";

export type PaymentVerificationPageProps = {
  searchParams: Promise<{
    reviewed?: string;
    reversed?: string;
    error?: string;
    status?: string;
    property?: string;
    tenant?: string;
    month?: string;
    method?: string;
  }>;
};

type SubmissionRecord = {
  id: string;
  tenant_id: string | null;
  tenant_record_id: string | null;
  tenant_application_id: string | null;
  tenancy_id: string | null;
  rent_bill_id: string | null;
  property_id: string | null;
  room_id: string | null;
  bill_month: string | null;
  bill_type: string;
  payment_type: string;
  amount: number | string | null;
  payment_date: string | null;
  payment_method: string;
  reference_number: string | null;
  receipt_url: string | null;
  verification_status: string;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  rejection_reason: string | null;
  payment_note: string | null;
  receipt_sha256: string | null;
  properties?: { name: string } | { name: string }[] | null;
  rooms?: { name: string; room_number: string | null } | { name: string; room_number: string | null }[] | null;
  tenant_applications?: {
    monthly_rent: number | string | null;
    deposit: number | string | null;
    utility_deposit: number | string | null;
    admin_notes: string | null;
    registration_mode: string | null;
  } | {
    monthly_rent: number | string | null;
    deposit: number | string | null;
    utility_deposit: number | string | null;
    admin_notes: string | null;
    registration_mode: string | null;
  }[] | null;
  rent_bills?: {
    bill_month: string | null;
    due_date: string | null;
    amount: number | string | null;
    deposit_amount: number | string | null;
    paid_amount: number | string | null;
    status: string;
    rental_invoice_line_items?:
      | { amount: number | string | null }
      | { amount: number | string | null }[]
      | null;
  } | {
    bill_month: string | null;
    due_date: string | null;
    amount: number | string | null;
    deposit_amount: number | string | null;
    paid_amount: number | string | null;
    status: string;
    rental_invoice_line_items?:
      | { amount: number | string | null }
      | { amount: number | string | null }[]
      | null;
  }[] | null;
};

const errorMessages: Record<string, string> = {
  bank_reference_required: "Please enter bank code.",
  duplicate_bank_reference: "This bank code is already linked to another payment.",
  reservation_first: "This payment belongs to a room reservation. Its slip is saved. Request actual check-in from Reservations and approve the tenant before applying this payment to a rental invoice.",
  identity_first:
    "Approve the tenant check-in first, then verify this payment against its invoice.",
  missing: "Choose a payment and action.",
  reason: "Please enter a rejection or reversal reason.",
  review: "Payment could not be updated.",
  already_verified: "This payment has already been verified.",
  not_verified: "Only a verified payment can be undone.",
  reversal_link_missing:
    "This older payment is not safely linked yet. No records were changed.",
  extra_purpose:
    "Choose what the extra payment is for and enter a clear description before verification.",
  purpose_correction:
    "Check the corrected payment details and explain why they are being changed.",
  correction_date: "Choose a valid payment date.",
  bank_reference: "Enter a bank transaction reference of at most 120 characters, on one line. Keep starting zeroes.",
  correction_month: "Choose a valid billing month.",
  correction_amount: "Enter a valid payment amount greater than RM 0.00.",
  extra_amount:
    "Enter a valid extra-charge amount greater than RM 0.00.",
  allocation_amount:
    "Enter valid Rental, Deposit and Extra Charge amounts. Their combined total must be greater than RM 0.00.",
  booking_allocation:
    "Choose either Monthly Rent or Deposit for the full booking-fee amount. Do not add an extra charge.",
  booking_review:
    "The booking fee could not be verified. No balance was changed. Refresh once and try again; the error has been recorded for review.",
  recurring_rent:
    "The recurring rental change could not be completed. Check the new monthly rent and reason, then try again.",
  correction_bill_missing:
    "No invoice exists for that tenancy and billing month. Create or select the correct invoice before verifying.",
  correction_bill_paid:
    "The selected billing month is already fully paid. Choose the correct unpaid invoice.",
  correction_bill_pending:
    "That billing month already has another payment awaiting verification. Review that submission first.",
};

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isImagePath(path: string | null | undefined) {
  return Boolean(path?.match(/\.(png|jpg|jpeg|webp|gif)$/i));
}

function malaysiaDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function malaysiaTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

async function allRows<T>(query: { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> }) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw new Error("Payment verification records could not load. Please retry.");
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) return rows;
  }
}

export default async function PaymentVerificationPage({
  searchParams,
}: PaymentVerificationPageProps) {
  return <PaymentVerificationContent searchParams={searchParams} />;
}

export async function PaymentVerificationContent({
  searchParams,
  embedded = false,
  returnTo = "/payment-verification",
}: PaymentVerificationPageProps & {
  embedded?: boolean;
  returnTo?: string;
}) {
  const role = await requireRole(["super_admin", "admin"]);
  const params = await searchParams;
  const supabase = await getAdmin();
  const statusFilter = params.status || "pending_verification";
  const currentMonth = malaysiaDate().slice(0, 7);
  const monthFilter = params.month ?? "";

  const properties = await getProperties();
  const propertyIds = params.property ? properties.filter((p) => p.id === params.property).map((p) => p.id) : properties.map((p) => p.id);
  const allSubmissions = propertyIds.length ? await allRows<SubmissionRecord>(supabase
    .from("payment_submissions")
    .select("id, tenant_id, tenant_record_id, tenant_application_id, tenancy_id, rent_bill_id, property_id, room_id, bill_month, bill_type, payment_type, amount, payment_date, payment_method, reference_number, receipt_url, verification_status, verified_by, verified_at, created_at, rejection_reason, payment_note, receipt_sha256, properties(name), rooms(name, room_number), tenant_applications(monthly_rent, deposit, utility_deposit, admin_notes, registration_mode), rent_bills(bill_month, due_date, amount, deposit_amount, paid_amount, status, rental_invoice_line_items(amount))")
    .in("property_id", propertyIds).order("created_at", { ascending: false }).order("id")) : [];
  // Filters apply to individual slips, including old verified slips with no code.
  const submissions = allSubmissions.filter((submission) => paymentMatchesFilters({
    ...submission, bill_month: submission.bill_month ?? single(submission.rent_bills)?.bill_month ?? null,
  }, { status: statusFilter, tenant: params.tenant, method: params.method, month: monthFilter }));
  const [profileRows, recordRows] = await Promise.all([
    allRows<{ id: string; full_name: string | null; phone: string | null }>(supabase.from("profiles").select("id, full_name, phone").order("id")),
    allRows<{ id: string; full_name: string; phone: string | null }>(supabase.from("tenant_records").select("id, full_name, phone").in("property_id", propertyIds).order("id")),
  ]);
  const profiles = new Map(profileRows.map((p) => [p.id, p]));
  const tenantRecords = new Map(recordRows.map((p) => [p.id, p]));
  const signedUrls = new Map<string, string>();
  await Promise.all(submissions.map(async (submission) => {
    if (!submission.receipt_url) return;
    const { data } = await supabase.storage.from("payment-receipts").createSignedUrl(submission.receipt_url, 600);
    if (data?.signedUrl) signedUrls.set(submission.id, data.signedUrl);
  }));

  const today = malaysiaDate();
  const pendingPayments = allSubmissions.filter((submission) => submission.verification_status === "pending_verification");
  const reportedCheckInAmounts = new Map<
    string,
    { rent: number; deposit: number }
  >();
  for (const submission of allSubmissions) {
    if (!submission.tenant_application_id || submission.verification_status === "rejected") {
      continue;
    }
    const amounts = reportedCheckInAmounts.get(submission.tenant_application_id) ?? {
      rent: 0,
      deposit: 0,
    };
    if (["monthly_rent", "first_month_rental"].includes(submission.payment_type)) {
      amounts.rent += Number(submission.amount ?? 0);
    }
    if (submission.payment_type === "deposit") {
      amounts.deposit += Number(submission.amount ?? 0);
    }
    reportedCheckInAmounts.set(submission.tenant_application_id, amounts);
  }
  const verifiedPayments = allSubmissions.filter((submission) => submission.verification_status === "verified");
  const verifiedToday = verifiedPayments.filter(
    (submission) =>
      submission.verified_at &&
      malaysiaDate(new Date(submission.verified_at)) === today,
  ).length;
  const verifiedThisMonth = verifiedPayments.filter(
    (submission) =>
      submission.verified_at &&
      malaysiaDate(new Date(submission.verified_at)).slice(0, 7) ===
        currentMonth,
  );
  const totalAmountPending = pendingPayments.reduce((total, submission) => total + Number(submission.amount ?? 0), 0);
  const totalAmountVerified = verifiedThisMonth.reduce((total, submission) => total + Number(submission.amount ?? 0), 0);

  return (
    <section className="space-y-6">
      {!embedded ? <div>
        <p className="text-xs font-semibold uppercase text-[#b98a2c]">Bank In Records</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Payment Verification</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Check uploaded bank-in slips before rent bills are marked paid and rental totals are counted.
        </p>
      </div> : null}

      {params.reviewed === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Payment submission updated.
        </div>
      ) : null}
      {params.reversed === "1" ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 shadow-sm">
          Verification undone. The slip is pending again and the invoice balance has been restored.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Unable to update payment submission."}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Clock} label="Pending Payments" value={pendingPayments.length} />
        <MetricCard icon={CheckCircle2} label="Verified Today" value={verifiedToday} />
        <MetricCard icon={CheckCircle2} label="Verified This Month" value={verifiedThisMonth.length} />
        <MetricCard icon={ReceiptText} label="Total Amount Pending" value={money(totalAmountPending)} />
        <MetricCard icon={ReceiptText} label="Total Amount Verified" value={money(totalAmountVerified)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>One row per payment slip. Choose Verified or All to add missing bank codes to older payments.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-6" method="get">
            {returnTo === "/verification?view=payments" ? (
              <input name="view" type="hidden" value="payments" />
            ) : null}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Status</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="status" defaultValue={statusFilter}>
                <option value="pending_verification">Pending Verification</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Property</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="property" defaultValue={params.property ?? ""}>
                <option value="">All</option>
                {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Tenant</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="tenant" defaultValue={params.tenant ?? ""}>
                <option value="">All</option>
                {Array.from(profiles.values()).map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name ?? profile.phone ?? profile.id}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Rental month</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="month" type="month" defaultValue={monthFilter} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Payment Method</span>
              <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="method" defaultValue={params.method ?? ""}>
                <option value="">All</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="duitnow">DuitNow</option>
                <option value="online_payment">Online payment</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button className="w-full" type="submit" variant="outline">Apply</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank In Records</CardTitle>
          <CardDescription>
            Uploading a slip does not mark rent as paid. Only Admin verification does.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submissions.length ? <Table className="min-w-[1150px]">
            <TableHeader><TableRow>
              {["Slip", "Tenant", "Property / Room", "Rental month", "Amount", "Bank Code / Reference", "Payment method", "Status", "Action"].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>{submissions.map((submission) => {
              const row = buildRow(submission, profiles, tenantRecords, signedUrls, reportedCheckInAmounts);
              return <PaymentSlipRow key={`${submission.id}:${submission.verification_status}:${submission.reference_number ?? ""}`} row={row} paymentMethod={submission.payment_method}
                paymentNote={submission.payment_note}
                canCorrectPurpose={role === "super_admin"} canReverse={role === "super_admin"}
                returnTo={returnTo} errorMessages={errorMessages} />;
            })}</TableBody>
          </Table> : <p className="text-sm text-gray-500">No payment slips for this filter.</p>}
        </CardContent>
      </Card>
    </section>
  );
}

function nextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function buildRow(
  submission: SubmissionRecord,
  profiles: Map<string, { id: string; full_name: string | null; phone: string | null }>,
  tenantRecords: Map<string, { id: string; full_name: string; phone: string | null }>,
  signedUrls: Map<string, string>,
  reportedCheckInAmounts: Map<string, { rent: number; deposit: number }>,
) {
  const tenant = submission.tenant_id ? profiles.get(submission.tenant_id) : null;
  const tenantRecord = submission.tenant_record_id ? tenantRecords.get(submission.tenant_record_id) : null;
  const property = single(submission.properties);
  const room = single(submission.rooms);
  const bill = single(submission.rent_bills);
  const application = single(submission.tenant_applications);
  const checkInAmounts = submission.tenant_application_id
    ? reportedCheckInAmounts.get(submission.tenant_application_id)
    : null;
  const receiptUrl = signedUrls.get(submission.id) ?? null;
  const rawLineItems = bill?.rental_invoice_line_items;
  const lineItems = Array.isArray(rawLineItems)
    ? rawLineItems
    : rawLineItems
      ? [rawLineItems]
      : [];
  const extraChargeTotal = lineItems.reduce(
    (total, item) => total + Number(item.amount ?? 0),
    0,
  );
  const invoiceTotal =
    Number(bill?.amount ?? submission.amount ?? 0) +
    Number(bill?.deposit_amount ?? 0) +
    extraChargeTotal;
  const invoiceOutstanding = Math.max(
    invoiceTotal - Number(bill?.paid_amount ?? 0),
    0,
  );
  const rentOutstanding = Math.max(
    Number(bill?.amount ?? submission.amount ?? 0) -
      Math.min(
        Number(bill?.paid_amount ?? 0),
        Number(bill?.amount ?? submission.amount ?? 0),
      ),
    0,
  );
  const depositOutstanding = Math.max(
    Number(bill?.deposit_amount ?? 0),
    0,
  );

  return {
    submissionId: submission.id,
    status: submission.verification_status,
    tenantName: tenant?.full_name ?? tenantRecord?.full_name ?? tenant?.phone ?? tenantRecord?.phone ?? "Tenant",
    propertyName: property?.name ?? "-",
    roomName: room?.room_number ?? room?.name ?? "-",
    billMonth: bill?.bill_month ?? submission.bill_month ?? "-",
    paymentDate: submission.payment_date ?? "",
    amountDue: money(invoiceOutstanding),
    amountSubmitted: money(submission.amount),
    amountSubmittedValue: Number(submission.amount ?? 0),
    paymentPurpose:
      submission.payment_type === "first_month_rental"
        ? "monthly_rent"
        : submission.payment_type,
    invoiceOutstanding,
    rentOutstanding,
    depositOutstanding,
    referenceNumber: submission.reference_number ?? "",
    receiptUrl,
    receiptIsImage: isImagePath(submission.receipt_url),
    verifiedBy: profiles.get(submission.verified_by ?? "")?.full_name ?? submission.verified_by,
    verifiedAt: submission.verified_at,
    rejectionReason: submission.rejection_reason,
    isCheckIn:
      submission.bill_type === "check_in" || Boolean(submission.tenant_application_id),
    checkInSummary:
      application && checkInAmounts
        ? {
            agreedRent: money(Number(application.monthly_rent ?? 0)),
            requiredDeposit: money(
              Number(application.deposit ?? 0) +
                Number(application.utility_deposit ?? 0),
            ),
            reportedRent: money(checkInAmounts.rent),
            reportedDeposit: money(checkInAmounts.deposit),
            note: application.admin_notes,
          }
        : null,
  };
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardHeader>
        <Icon className="h-5 w-5 text-[#b98a2c]" />
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

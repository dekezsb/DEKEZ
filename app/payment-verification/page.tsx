import { CheckCircle2, Clock, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { formatMalaysiaDate } from "@/lib/date-format";
import { money } from "@/lib/e-tenancy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PaymentRecordActions } from "./payment-record-actions";

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
  properties?: { name: string } | { name: string }[] | null;
  rooms?: { name: string; room_number: string | null } | { name: string; room_number: string | null }[] | null;
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
  correction_month: "Choose a valid billing month.",
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

function latestSubmissionPerBill<
  T extends { id: string; rent_bill_id: string | null },
>(submissions: T[]) {
  const seen = new Set<string>();

  return submissions.filter((submission) => {
    const key = submission.rent_bill_id
      ? `bill:${submission.rent_bill_id}`
      : `submission:${submission.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  let query = supabase
    .from("payment_submissions")
    .select("id, tenant_id, tenant_record_id, tenant_application_id, tenancy_id, rent_bill_id, property_id, room_id, bill_month, bill_type, payment_type, amount, payment_date, payment_method, reference_number, receipt_url, verification_status, verified_by, verified_at, created_at, rejection_reason, properties(name), rooms(name, room_number), rent_bills(bill_month, due_date, amount, deposit_amount, paid_amount, status, rental_invoice_line_items(amount))")
    .order("created_at", { ascending: false });

  if (params.property) {
    query = query.eq("property_id", params.property);
  }
  if (params.tenant) {
    query = query.eq("tenant_id", params.tenant);
  }
  if (params.method) {
    query = query.eq("payment_method", params.method);
  }
  if (monthFilter) {
    query = query.gte("payment_date", `${monthFilter}-01`).lt("payment_date", nextMonth(monthFilter));
  }

  const [submissionsResult, profilesResult, tenantRecordsResult, propertiesResult, allSubmissionsResult] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name, phone"),
    supabase.from("tenant_records").select("id, full_name, phone"),
    supabase.from("properties").select("id, name").order("name", { ascending: true }),
    supabase
      .from("payment_submissions")
      .select("id, rent_bill_id, amount, verification_status, verified_at, payment_date, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const latestFilteredSubmissions = latestSubmissionPerBill(
    (submissionsResult.data ?? []) as SubmissionRecord[],
  );
  const submissions =
    statusFilter === "all"
      ? latestFilteredSubmissions
      : latestFilteredSubmissions.filter(
          (submission) => submission.verification_status === statusFilter,
        );
  const allSubmissions = latestSubmissionPerBill(
    allSubmissionsResult.data ?? [],
  );
  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const tenantRecords = new Map((tenantRecordsResult.data ?? []).map((tenant) => [tenant.id, tenant]));
  const properties = propertiesResult.data ?? [];
  const signedUrls = new Map<string, string>();

  for (const submission of submissions) {
    if (submission.receipt_url) {
      const { data } = await supabase.storage.from("payment-receipts").createSignedUrl(submission.receipt_url, 60 * 10);
      if (data?.signedUrl) {
        signedUrls.set(submission.id, data.signedUrl);
      }
    }
  }

  const today = malaysiaDate();
  const pendingPayments = allSubmissions.filter((submission) => submission.verification_status === "pending_verification");
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
          <CardDescription>Default view shows pending verification first.</CardDescription>
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
              <span className="text-sm font-medium text-gray-700">Month</span>
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
          {submissions.length ? (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Tenant / Staff</TableHead>
                      <TableHead>Property</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Amount Due</TableHead>
                      <TableHead>Amount Submitted</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead>Slip</TableHead>
                      <TableHead className="min-w-48">Verify</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submissions.map((submission) => {
                      const row = buildRow(submission, profiles, tenantRecords, signedUrls);
                      return (
                        <TableRow key={submission.id}>
                          <TableCell className="min-w-40">
                            <p>{formatMalaysiaDate(submission.payment_date)}</p>
                            <p className="text-xs text-gray-500">{malaysiaTime(submission.created_at)}</p>
                          </TableCell>
                          <TableCell className="min-w-48 font-medium text-gray-950">{row.tenantName}</TableCell>
                          <TableCell>{row.propertyName}</TableCell>
                          <TableCell>{row.roomName}</TableCell>
                          <TableCell>{row.amountDue}</TableCell>
                          <TableCell className="font-semibold text-gray-950">{row.amountSubmitted}</TableCell>
                          <TableCell>
                            <p>{submission.payment_method}</p>
                            <p className="text-xs text-gray-500">{submission.reference_number ?? "-"}</p>
                          </TableCell>
                          <TableCell>
                            <ReceiptThumb receiptUrl={row.receiptUrl} receiptIsImage={row.receiptIsImage} />
                          </TableCell>
                          <TableCell>
                            <PaymentRecordActions
                              {...row}
                              canCorrectPurpose={role === "super_admin"}
                              canReverse={role === "super_admin"}
                              returnTo={returnTo}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="grid gap-4 lg:hidden">
                {submissions.map((submission) => {
                  const row = buildRow(submission, profiles, tenantRecords, signedUrls);
                  return (
                    <div className="rounded-lg border border-[#d7dde5] bg-white p-4" key={submission.id}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-gray-950">{row.tenantName}</p>
                          <p className="mt-1 text-sm text-gray-600">{row.propertyName} / {row.roomName}</p>
                          <p className="mt-2 text-xl font-bold">{row.amountSubmitted}</p>
                          <p className="text-xs text-gray-500">{formatMalaysiaDate(submission.payment_date)} {malaysiaTime(submission.created_at)}</p>
                        </div>
                        <ReceiptThumb receiptUrl={row.receiptUrl} receiptIsImage={row.receiptIsImage} />
                      </div>
                      <div className="mt-4">
                        <PaymentRecordActions
                          {...row}
                          canCorrectPurpose={role === "super_admin"}
                          canReverse={role === "super_admin"}
                          returnTo={returnTo}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">No bank-in records for this filter.</p>
          )}
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
) {
  const tenant = submission.tenant_id ? profiles.get(submission.tenant_id) : null;
  const tenantRecord = submission.tenant_record_id ? tenantRecords.get(submission.tenant_record_id) : null;
  const property = single(submission.properties);
  const room = single(submission.rooms);
  const bill = single(submission.rent_bills);
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
    paymentPurpose: submission.payment_type,
    invoiceOutstanding,
    referenceNumber: submission.reference_number ?? "",
    receiptUrl,
    receiptIsImage: isImagePath(submission.receipt_url),
    verifiedBy: profiles.get(submission.verified_by ?? "")?.full_name ?? submission.verified_by,
    verifiedAt: submission.verified_at,
    rejectionReason: submission.rejection_reason,
  };
}

function ReceiptThumb({
  receiptUrl,
  receiptIsImage,
}: {
  receiptUrl?: string | null;
  receiptIsImage: boolean;
}) {
  if (!receiptUrl) {
    return <span className="text-sm text-gray-500">No slip</span>;
  }

  return (
    <DocumentPreview
      contentType={receiptIsImage ? "image/*" : "application/pdf"}
      label="Payment slip"
      showName={false}
      size="sm"
      url={receiptUrl}
    />
  );
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

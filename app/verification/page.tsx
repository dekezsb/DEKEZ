import { Link } from "@/components/app-link";
import {
  Building2,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileSignature,
  Send,
  ShieldCheck,
  UserCheck,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import { StaffReimbursementPayoutForm } from "@/components/maintenance/staff-reimbursement-payout-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import {
  formatMalaysiaDate,
  formatMalaysiaDateTime,
} from "@/lib/date-format";
import { money } from "@/lib/e-tenancy";
import { statusBadgeClass } from "@/lib/status-styles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkoutRoom } from "@/app/properties/[id]/actions";
import { PaymentVerificationContent } from "@/app/payment-verification/page";
import { TenantVerificationContent } from "@/app/tenant-verification/page";
import { type AgreementArchiveItem } from "@/components/verification/agreement-archive";
import { loadTenancyAgreementArchive } from "@/lib/data/tenancy-agreements";
import {
  agreementTypeForProperty,
  agreementTypeLabel,
} from "@/lib/tenancy/agreement-types";
import {
  requestRenewalSignature,
  rejectSignedAgreementForResign,
  confirmSmartMeterCredit,
  reviewClaim,
  reviewSmartMeterTopUp,
  reviewUserRegistration,
  sendAgreementWhatsApp,
  updateAgreementTermRent,
  verifySignedAgreement,
} from "./actions";

type PageProps = {
  searchParams: Promise<{
    view?: string;
    reviewed?: string;
    sent?: string;
    renewal?: string;
    checkout?: string;
    updated?: string;
    error?: string;
    status?: string;
    property?: string;
    tenant?: string;
    month?: string;
    method?: string;
    occupancy?: string;
    agreement_verified?: string;
    agreement_rejected?: string;
    resign_sent?: string;
    payout_recorded?: string;
    topup_approved?: string;
    topup_rejected?: string;
    topup_credited?: string;
  }>;
};

type VerificationView =
  | "users"
  | "tenants"
  | "claims"
  | "agreements"
  | "meter_topups"
  | "payments";

const views: {
  key: VerificationView;
  label: string;
  icon: typeof ShieldCheck;
}[] = [
  { key: "users", label: "User Permission", icon: Building2 },
  { key: "tenants", label: "Tenant & Room", icon: UserCheck },
  { key: "claims", label: "Claim Bills", icon: ClipboardCheck },
  { key: "agreements", label: "Signed Agreement Verification", icon: FileSignature },
  { key: "payments", label: "Payment Verification", icon: CreditCard },
  { key: "meter_topups", label: "Electricity Top-Ups", icon: Zap },
];

const errorMessages: Record<string, string> = {
  user_missing:
    "Choose a user permission and select properties when approving an Owner.",
  property_missing: "One of the selected properties could not be found.",
  user_assign: "The user could not be assigned to the selected properties.",
  user_documents:
    "Review the Owner identity number and required IC/passport photos before approval.",
  user_review: "The user permission could not be updated.",
  claim_missing: "Choose a claim action and include a reason when required.",
  claim_review: "The claim could not be updated.",
  claim_expense: "The approved claim could not be added to Expense Bills.",
  claim_reimbursement:
    "The staff reimbursement balance could not be recorded.",
  payout_missing:
    "Choose a payout date and source, then attach an image or PDF proof no larger than 3 MB.",
  payout_changed:
    "The outstanding total changed before payout. Refresh and review the balance again.",
  payout_proof: "The staff payout proof could not be stored.",
  payout_receipt_missing:
    "Every staff bill must have its receipt attached before it can be paid and knocked off.",
  agreement_missing: "The tenancy agreement could not be found.",
  whatsapp_failed: "The WhatsApp request could not be sent. The failed attempt was logged.",
  renewal_missing: "The active tenancy does not have enough information for renewal.",
  renewal_decision:
    "Record the tenant's Yes decision in the dashboard before preparing or sending a renewal agreement.",
  renewal_create: "The renewal agreement could not be prepared.",
  agreement_rent:
    "The agreement rent could not be changed. Signed agreements are locked.",
  agreement_verify:
    "The signed agreement could not be verified. It may already be verified.",
  agreement_reject_missing:
    "Enter the reason this signed agreement is not accepted.",
  agreement_reject:
    "The signed agreement could not be rejected. It may already have been reviewed.",
  agreement_replacement_prepare:
    "The replacement agreement could not be prepared safely. The signed copy was not changed.",
  topup_review: "Choose Approve or Reject and provide a reason when rejecting.",
  topup_changed: "This electricity top-up request was already reviewed. Refresh and check its latest status.",
  topup_credit_details: "Enter the meter-provider transaction reference after the physical meter is credited.",
  topup_credit: "The meter credit could not be recorded. Check the request and provider reference.",
  meter_missing: "Assign an active electricity meter to this room before confirming the meter credit.",
  invoice_missing: "The monthly invoice could not be prepared for this electricity top-up.",
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

function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function VerificationPage({ searchParams }: PageProps) {
  const role = await requireRole(["super_admin", "admin"]);
  const params = await searchParams;
  const availableViews =
    role === "admin"
      ? views.filter((view) =>
          ["tenants", "agreements"].includes(view.key),
        )
      : views;
  const activeView = availableViews.some((view) => view.key === params.view)
    ? (params.view as VerificationView)
    : role === "admin"
      ? "tenants"
      : "users";
  const supabase = await getAdmin();

  const [
    usersResult,
    propertiesResult,
    assignmentsResult,
    tenantApplicationsResult,
    claimsResult,
    claimExpensesResult,
    reimbursementLiabilitiesResult,
    reimbursementPayoutsResult,
    paymentSubmissionsResult,
    profilesResult,
    profileDocumentsResult,
    smartMeterTopUpsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, requested_role, identity_type, identity_number, company_name, company_details, registration_status, registration_reviewed_at, registration_rejection_reason, registration_completed_at, created_at")
      .neq("role", "super_admin")
      .not("registration_completed_at", "is", null)
      .order("created_at", { ascending: false }),
    supabase.from("properties").select("id, company_id, name").order("name"),
    supabase
      .from("property_owners")
      .select("property_id, owner_id")
      .is("end_date", null),
    supabase
      .from("tenant_applications")
      .select("id, tenant_id, submission_source, property_id, room_id, full_name, verification_status, payment_status, status, proposed_start_date, proposed_end_date, properties(name), rooms(name, room_number)")
      .order("submitted_at", { ascending: false }),
    supabase
      .from("claims")
      .select("id, ticket_id, property_id, room_id, submitted_by, labour_cost, material_cost, total_amount, description, funding_source, bill_date, status, submitted_at, reviewed_at, rejection_reason, properties(name), rooms(name, room_number), maintenance_tickets(ticket_number), claim_attachments(id, bucket_name, file_path, content_type)")
      .order("submitted_at", { ascending: false }),
    supabase
      .from("expenses")
      .select("claim_id, funding_source, amount, status")
      .not("claim_id", "is", null),
    supabase
      .from("staff_reimbursement_liabilities")
      .select("id, claim_id, expense_id, staff_id, amount, status, owed_at, paid_at, payout_id")
      .order("owed_at", { ascending: true }),
    supabase
      .from("staff_reimbursement_payouts")
      .select("id, staff_id, total_amount, payment_source, paid_on, reference_number, notes, proof_bucket_name, proof_file_path, proof_content_type, recorded_by, created_at")
      .order("paid_on", { ascending: false }),
    supabase
      .from("payment_submissions")
      .select("id, verification_status"),
    supabase
      .from("profiles")
      .select("id, full_name, phone, bank_name, bank_account_holder, bank_account_number"),
    supabase
      .from("profile_documents")
      .select("id, profile_id, document_type, file_path, file_name, content_type, verification_status")
      .order("uploaded_at", { ascending: true }),
    supabase
      .from("smart_meter_top_up_requests")
      .select("id, property_id, room_id, tenancy_id, tenant_profile_id, meter_id, rent_bill_id, bill_month, payment_date, amount, payment_slip_bucket, payment_slip_path, payment_slip_name, payment_slip_type, status, rejection_reason, verified_at, credited_at, provider_reference, credit_before, credit_after, created_at, properties(name, property_code), rooms(name, room_number), rent_bills(invoice_number)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const users = usersResult.data ?? [];
  const properties = propertiesResult.data ?? [];
  const assignments = assignmentsResult.data ?? [];
  const tenantApplications = tenantApplicationsResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const claimExpenses = claimExpensesResult.data ?? [];
  const reimbursementLiabilities =
    reimbursementLiabilitiesResult.data ?? [];
  const reimbursementPayouts = reimbursementPayoutsResult.data ?? [];
  const agreementArchive = await loadTenancyAgreementArchive(supabase);
  const agreements = agreementArchive.agreements;
  const paymentSubmissions = paymentSubmissionsResult.data ?? [];
  const smartMeterTopUps = await Promise.all(
    (smartMeterTopUpsResult.data ?? []).map(async (request) => {
      const { data } = await supabase.storage
        .from(request.payment_slip_bucket)
        .createSignedUrl(request.payment_slip_path, 60 * 10);
      return {
        ...request,
        amount: Number(request.amount ?? 0),
        signedSlipUrl: data?.signedUrl ?? null,
      };
    }),
  );
  const profiles = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile]),
  );
  const claimAttachments = new Map<
    string,
    {
      id: string;
      content_type: string | null;
      fileName: string;
      signedUrl: string | null;
    }[]
  >();
  const payoutProofs = new Map<string, string | null>();
  for (const payout of reimbursementPayouts) {
    const { data } = await supabase.storage
      .from(payout.proof_bucket_name)
      .createSignedUrl(payout.proof_file_path, 60 * 10);
    payoutProofs.set(payout.id, data?.signedUrl ?? null);
  }
  for (const claim of claims) {
    for (const attachment of claim.claim_attachments ?? []) {
      const { data } = await supabase.storage
        .from(attachment.bucket_name)
        .createSignedUrl(attachment.file_path, 60 * 10);
      const list = claimAttachments.get(claim.id) ?? [];
      list.push({
        id: attachment.id,
        content_type: attachment.content_type,
        fileName: attachment.file_path.split("/").at(-1) ?? "Claim receipt",
        signedUrl: data?.signedUrl ?? null,
      });
      claimAttachments.set(claim.id, list);
    }
  }
  const profileDocuments = new Map<
    string,
    {
      document_type: string;
      file_name: string | null;
      content_type: string | null;
      id: string;
      signedUrl?: string;
      verification_status: string;
    }[]
  >();
  for (const document of profileDocumentsResult.data ?? []) {
    const { data } = await supabase.storage
      .from("tenant-documents")
      .createSignedUrl(document.file_path, 60 * 10);
    const list = profileDocuments.get(document.profile_id) ?? [];
    list.push({ ...document, signedUrl: data?.signedUrl });
    profileDocuments.set(document.profile_id, list);
  }
  const selfRegisteredTenantIds = new Set(
    tenantApplications
      .filter(
        (application) =>
          application.submission_source === "self_registration" &&
          application.tenant_id,
      )
      .map((application) => application.tenant_id as string),
  );
  const permissionUsers = users.filter(
    (user) =>
      !selfRegisteredTenantIds.has(user.id) &&
      user.registration_status === "pending_verification",
  );
  const signedAgreementsPendingVerification = agreements.filter(
    (agreement) =>
      ["signed", "renewal_signed"].includes(agreement.status) &&
      !agreement.admin_verified_at &&
      !agreement.admin_rejected_at,
  );

  const pendingCounts: Record<VerificationView, number> = {
    users: permissionUsers.length,
    tenants: tenantApplications.filter(
      (application) => application.verification_status === "pending_verification",
    ).length,
    claims: claims.filter(
      (claim) => claim.status === "pending_owner_approval",
    ).length,
    agreements: signedAgreementsPendingVerification.length,
    payments: paymentSubmissions.filter(
      (submission) =>
        submission.verification_status === "pending_verification",
    ).length,
    meter_topups: smartMeterTopUps.filter(
      (request) => request.status === "pending_verification",
    ).length,
  };
  const totalPending = availableViews.reduce(
    (total, view) => total + pendingCounts[view.key],
    0,
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b98a2c]">
            {role === "admin" ? "Management Review" : "Admin Control"}
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            {role === "admin"
              ? "Tenant Verification"
              : "Verification Center"}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            {role === "admin"
              ? "Review tenant registrations and tenant-signed tenancy agreements."
              : "Review registrations, room assignments, claim bills, signed agreements and uploaded payment slips from one place."}
          </p>
        </div>
        <div className="rounded-md border border-[#d7dde5] bg-white px-4 py-3 text-sm shadow-sm">
          <span className="text-gray-500">Total pending</span>
          <span className="ml-3 text-xl font-semibold text-gray-950">
            {totalPending}
          </span>
        </div>
      </div>

      <StatusMessage params={params} />

      {agreementArchive.error ? (
        <div className="rounded-md border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {agreementArchive.error}
        </div>
      ) : null}

      <div
        aria-label="Verification sections"
        className="flex gap-2 overflow-x-auto border-b border-[#d7dde5] pb-3"
      >
        {availableViews.map(({ key, label, icon: Icon }) => {
          const active = activeView === key;
          return (
            <Link
              className={`flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition ${
                active
                  ? "border-[#b8892c] bg-[#f6edd9] text-[#7a5618]"
                  : "border-[#d7dde5] bg-white text-gray-600 hover:border-gray-400 hover:text-gray-950"
              }`}
              href={`/verification?view=${key}`}
              key={key}
            >
              <Icon className="h-4 w-4" />
              {label}
              <span
                className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs ${
                  pendingCounts[key]
                    ? "bg-[#b98a2c] text-white"
                    : "bg-[#f0f2f4] text-gray-500"
                }`}
              >
                {pendingCounts[key]}
              </span>
            </Link>
          );
        })}
      </div>

      {activeView === "users" ? (
        <UserRegistrations
          assignments={assignments}
          documentsByProfile={profileDocuments}
          properties={properties}
          users={permissionUsers}
        />
      ) : null}

      {activeView === "tenants" ? (
        <TenantVerificationContent
          embedded
          returnTo="/verification?view=tenants"
          searchParams={searchParams}
        />
      ) : null}

        {activeView === "claims" ? (
          <ClaimBills
            attachmentsByClaim={claimAttachments}
            claims={claims}
            expenses={claimExpenses}
            liabilities={reimbursementLiabilities}
            payoutProofs={payoutProofs}
            payouts={reimbursementPayouts}
            profiles={profiles}
          />
      ) : null}

      {activeView === "agreements" ? (
        <SignedAgreementVerification
          agreements={
            signedAgreementsPendingVerification as AgreementArchiveItem[]
          }
        />
      ) : null}

      {activeView === "payments" ? (
        <PaymentVerificationContent
          embedded
          returnTo="/verification?view=payments"
          searchParams={searchParams}
        />
      ) : null}

      {activeView === "meter_topups" ? (
        <SmartMeterTopUpVerification
          profiles={profiles}
          requests={smartMeterTopUps}
        />
      ) : null}
    </section>
  );
}

function StatusMessage({ params }: { params: Awaited<PageProps["searchParams"]> }) {
  const success = params.reviewed
    ? "Verification record updated."
    : params.topup_credited
      ? "Meter credit confirmed. Top Up Utilities income, the monthly invoice item and its audit receipt are now linked."
    : params.topup_approved
      ? "Payment verified. The request is awaiting physical meter top-up confirmation."
    : params.topup_rejected
      ? "Electricity top-up payment slip rejected. The tenant can submit a replacement."
    : params.agreement_rejected
      ? params.resign_sent === "1"
        ? "Signed agreement rejected. The audit copy was retained, a replacement was created, and the tenant was asked by WhatsApp to sign again."
        : "Signed agreement rejected and retained for audit. The replacement is ready in the tenant portal, but WhatsApp could not be sent."
    : params.payout_recorded
      ? "Staff lump-sum payout recorded. All linked claims are now paid back."
    : params.agreement_verified
      ? "Signed tenancy agreement verified."
    : params.sent
      ? "Agreement signature request sent by WhatsApp."
      : params.renewal
        ? "Renewal agreement prepared and sent by WhatsApp."
        : params.updated === "rent"
          ? "Agreement rent updated for this unsigned term."
        : params.checkout
          ? "Tenant checked out and future billing stopped."
          : null;

  if (success) {
    return (
      <div className="rounded-md border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
        {success}
      </div>
    );
  }

  if (params.error && errorMessages[params.error]) {
    return (
      <div className="rounded-md border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
        {errorMessages[params.error]}
      </div>
    );
  }

  return null;
}

type SmartMeterTopUpRequestView = {
  id: string;
  property_id: string;
  room_id: string;
  tenancy_id: string;
  tenant_profile_id: string;
  meter_id: string | null;
  rent_bill_id: string | null;
  bill_month: string;
  payment_date: string;
  amount: number;
  payment_slip_name: string;
  payment_slip_type: string | null;
  status: string;
  rejection_reason: string | null;
  verified_at: string | null;
  credited_at: string | null;
  provider_reference: string | null;
  credit_before: number | string | null;
  credit_after: number | string | null;
  created_at: string;
  signedSlipUrl: string | null;
  properties: { name: string; property_code: string | null } | { name: string; property_code: string | null }[] | null;
  rooms: { name: string | null; room_number: string | null } | { name: string | null; room_number: string | null }[] | null;
  rent_bills: { invoice_number: string } | { invoice_number: string }[] | null;
};

function SmartMeterTopUpVerification({
  profiles,
  requests,
}: {
  profiles: Map<
    string,
    {
      id: string;
      full_name: string | null;
      phone: string | null;
      bank_name: string | null;
      bank_account_holder: string | null;
      bank_account_number: string | null;
    }
  >;
  requests: SmartMeterTopUpRequestView[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Electricity Top-Up Verification</CardTitle>
            <CardDescription>
              Review the bank slip first. Approval never credits the meter by
              itself; record the provider reference only after the physical meter
              top-up succeeds. Completed top-ups post to Top Up Utilities income
              and the tenant&apos;s monthly invoice automatically.
            </CardDescription>
          </div>
          <Badge>
            {requests.filter((request) => request.status === "pending_verification").length} pending
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {requests.length ? (
          requests.map((request) => {
            const profile = profiles.get(request.tenant_profile_id);
            const property = single(request.properties);
            const room = single(request.rooms);
            const invoice = single(request.rent_bills);
            const statusLabel = request.status.replaceAll("_", " ");

            return (
              <article
                className="rounded-lg border border-[#d7dde5] p-4"
                key={request.id}
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-bold text-gray-950">
                        {money(request.amount)}
                      </p>
                      <Badge className={statusBadgeClass(request.status)}>
                        {statusLabel}
                      </Badge>
                      {!request.meter_id ? (
                        <Badge className="bg-red-100 text-red-700">
                          Meter not assigned
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 font-semibold text-gray-950">
                      {profile?.full_name ?? "Tenant"}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {property?.name ?? property?.property_code ?? "Property"} / {room?.room_number ?? room?.name ?? "Room"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Submitted {formatMalaysiaDateTime(request.created_at)}
                      {profile?.phone ? ` / ${profile.phone}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Billing month {formatMalaysiaDate(request.bill_month)}
                      {invoice?.invoice_number ? ` / ${invoice.invoice_number}` : ""}
                    </p>
                  </div>
                  {request.signedSlipUrl ? (
                    <Button asChild variant="outline">
                      <a href={request.signedSlipUrl} rel="noreferrer" target="_blank">
                        View payment slip
                      </a>
                    </Button>
                  ) : (
                    <span className="text-sm font-medium text-red-600">
                      Payment slip unavailable
                    </span>
                  )}
                </div>

                {request.status === "pending_verification" ? (
                  <form
                    action={reviewSmartMeterTopUp}
                    className="mt-4 grid gap-3 border-t border-[#e5e9ef] pt-4 lg:grid-cols-[1fr_auto_auto]"
                  >
                    <input name="requestId" type="hidden" value={request.id} />
                    <input
                      className="h-11 rounded-md border border-[#d7dde5] px-3 text-sm"
                      name="reason"
                      placeholder="Reason required when rejecting"
                    />
                    <Button name="decision" type="submit" value="approved">
                      Verify Payment
                    </Button>
                    <Button
                      className="border-red-200 text-red-600 hover:bg-red-50"
                      name="decision"
                      type="submit"
                      value="rejected"
                      variant="outline"
                    >
                      Reject
                    </Button>
                  </form>
                ) : null}

                {request.status === "approved_awaiting_top_up" ? (
                  <form
                    action={confirmSmartMeterCredit}
                    className="mt-4 grid gap-3 border-t border-[#e5e9ef] pt-4 lg:grid-cols-[1fr_auto]"
                  >
                    <input name="requestId" type="hidden" value={request.id} />
                    <label className="block">
                      <span className="text-sm font-semibold text-gray-800">
                        Physical meter/provider reference
                      </span>
                      <input
                        className="mt-1 h-11 w-full rounded-md border border-[#d7dde5] px-3 text-sm"
                        name="providerReference"
                        placeholder="Enter only after the meter credit succeeds"
                        required
                      />
                    </label>
                    <Button
                      className="self-end bg-emerald-700 text-white hover:bg-emerald-600"
                      type="submit"
                    >
                      Confirm Meter Credited
                    </Button>
                  </form>
                ) : null}

                {request.status === "rejected" ? (
                  <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
                    Rejected: {request.rejection_reason}
                  </p>
                ) : null}

                {request.status === "credited" ? (
                  <div className="mt-4 grid gap-2 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:grid-cols-2">
                    <p>Provider reference: {request.provider_reference}</p>
                    <p>
                      Credit: {money(Number(request.credit_before ?? 0))} → {money(Number(request.credit_after ?? 0))}
                    </p>
                    <p className="sm:col-span-2">
                      Accounting: Top Up Utilities income posted to {invoice?.invoice_number ?? "the monthly invoice"}; payment slip retained for audit.
                    </p>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <p className="text-sm text-gray-500">
            No electricity top-up slips have been submitted yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SignedAgreementVerification({
  agreements,
}: {
  agreements: AgreementArchiveItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Signed Agreement Verification</CardTitle>
            <CardDescription>
              Only agreements already signed by tenants are shown here. Review
              the signed PDF, then verify it or reject it with a reason and ask
              the tenant to sign a replacement.
            </CardDescription>
          </div>
          <Badge>{agreements.length} pending</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {agreements.length ? (
          <div className="grid gap-4">
            {agreements.map((agreement) => {
              const tenancy = single(agreement.tenancies);
              const tenant = single(tenancy?.tenants);
              const property = single(tenancy?.properties);
              const room = single(tenancy?.rooms);
              const tenantName =
                agreement.tenant_name_snapshot ??
                tenant?.full_name ??
                "Tenant";
              const propertyName =
                agreement.property_name_snapshot ??
                property?.name ??
                property?.property_code ??
                "Property";
              const roomName =
                agreement.room_name_snapshot ??
                room?.room_number ??
                room?.name ??
                "-";

              return (
                <div
                  className="grid gap-4 rounded-md border border-[#d7dde5] p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                  key={agreement.id}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-950">{tenantName}</p>
                      <Badge className="bg-amber-100 text-amber-800">
                        Awaiting Admin verification
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {propertyName} / R{String(roomName).replace(/^room\s*/i, "")}
                    </p>
                    <p className="mt-2 text-sm text-gray-600">
                      Term {formatMalaysiaDate(agreement.term_start_date)} to{" "}
                      {formatMalaysiaDate(agreement.term_end_date)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Signed{" "}
                      {agreement.signed_at
                        ? formatMalaysiaDateTime(agreement.signed_at)
                        : "-"}
                      {" · "}
                      {agreement.term_type === "renewal"
                        ? "Renewal agreement"
                        : "Original agreement"}
                    </p>
                  </div>
                  <div className="grid min-w-72 gap-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                    <Button asChild type="button" variant="outline">
                      <Link
                        href={`/api/tenancy-agreements/${agreement.id}/pdf`}
                        target="_blank"
                      >
                        View Signed PDF
                      </Link>
                    </Button>
                    <form action={verifySignedAgreement}>
                      <input
                        name="agreementId"
                        type="hidden"
                        value={agreement.id}
                      />
                      <Button className="w-full" type="submit">
                        <CheckCircle2 className="h-4 w-4" />
                        Verify
                      </Button>
                    </form>
                    </div>
                    <form
                      action={rejectSignedAgreementForResign}
                      className="grid gap-2 rounded-md border border-red-200 bg-red-50 p-3"
                    >
                      <input
                        name="agreementId"
                        type="hidden"
                        value={agreement.id}
                      />
                      <label className="grid gap-1 text-sm font-medium text-red-900">
                        Reason tenant must sign again *
                        <textarea
                          className="min-h-20 rounded-md border border-red-200 bg-white px-3 py-2 text-gray-950"
                          maxLength={1000}
                          name="reason"
                          placeholder="Example: Signature is incomplete or does not match the tenant."
                          required
                        />
                      </label>
                      <Button
                        className="border-red-300 text-red-700 hover:bg-red-100"
                        type="submit"
                        variant="outline"
                      >
                        <XCircle className="h-4 w-4" />
                        Reject & Ask Sign Again
                      </Button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-[#d7dde5] px-4 py-10 text-center text-sm text-gray-500">
            No signed agreements are waiting for verification.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UserRegistrations({
  users,
  properties,
  assignments,
  documentsByProfile,
}: {
  users: {
    id: string;
    full_name: string | null;
    phone: string | null;
    role: string;
    requested_role: string | null;
    identity_type: string | null;
    identity_number: string | null;
    company_name: string | null;
    company_details: string | null;
    registration_status: string;
    registration_reviewed_at: string | null;
    registration_rejection_reason: string | null;
    created_at: string;
  }[];
  properties: { id: string; company_id: string; name: string }[];
  assignments: { property_id: string; owner_id: string }[];
  documentsByProfile: Map<
    string,
    {
      document_type: string;
      file_name: string | null;
      content_type: string | null;
      id: string;
      signedUrl?: string;
      verification_status: string;
    }[]
  >;
}) {
  const propertyById = new Map(
    properties.map((property) => [property.id, property.name]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Permission Review</CardTitle>
        <CardDescription>
          Assign each new user a permission before they can enter DEKEZ.
          Owners must also be assigned the properties they may view.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {users.length ? (
          <div className="divide-y divide-[#d7dde5]">
            {users.map((user) => {
              const documents = documentsByProfile.get(user.id) ?? [];
              const assignedNames = assignments
                .filter((assignment) => assignment.owner_id === user.id)
                .map(
                  (assignment) =>
                    propertyById.get(assignment.property_id) ?? "Property",
                );
              return (
                <div
                  className="grid gap-5 py-5 first:pt-0 last:pb-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                  key={user.id}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-950">
                        {user.full_name ?? "New user"}
                      </p>
                      <Badge className={statusBadgeClass(user.registration_status)}>
                        {user.registration_status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {user.phone ?? "No phone number"}
                    </p>
                    <p className="mt-2 text-xs text-gray-500">
                      Registered{" "}
                      {formatMalaysiaDateTime(user.created_at)}
                    </p>
                    <p className="mt-2 text-sm text-gray-600">
                      Current permission: {user.role.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      Requested:{" "}
                      {(user.requested_role ?? user.role).replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {user.identity_type?.toUpperCase() ?? "Identity"}:{" "}
                      {user.identity_number ?? "Not supplied"}
                    </p>
                    {user.company_name ? (
                      <p className="mt-1 text-sm text-gray-600">
                        Company: {user.company_name}
                      </p>
                    ) : null}
                    {user.company_details ? (
                      <p className="mt-1 text-xs leading-5 text-gray-500">
                        {user.company_details}
                      </p>
                    ) : null}
                    {documents.length ? (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {documents.map((document) =>
                          document.signedUrl ? (
                            <DocumentPreview
                              contentType={document.content_type}
                              fileName={document.file_name}
                              key={document.id}
                              label={document.document_type.replaceAll("_", " ")}
                              url={document.signedUrl}
                            />
                          ) : (
                            <Badge key={document.id}>
                              {document.document_type.replaceAll("_", " ")}
                            </Badge>
                          ),
                        )}
                      </div>
                    ) : null}
                    <p className="mt-1 text-sm text-gray-600">
                      Assigned:{" "}
                      {assignedNames.length ? assignedNames.join(", ") : "None"}
                    </p>
                    {user.registration_rejection_reason ? (
                      <p className="mt-2 text-sm text-red-600">
                        {user.registration_rejection_reason}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <form action={reviewUserRegistration} className="space-y-3">
                      <input name="profileId" type="hidden" value={user.id} />
                      <input name="decision" type="hidden" value="approved" />
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">
                          User permission
                        </span>
                        <select
                          className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm"
                          defaultValue={user.requested_role ?? user.role}
                          name="role"
                          required
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Management</option>
                          <option value="technician">
                            Maintenance & Cleaning Team
                          </option>
                          <option value="maintenance_staff">
                            Maintenance Team
                          </option>
                          <option value="cleaning_staff">Cleaning Team</option>
                          <option value="tenant">Tenant</option>
                        </select>
                      </label>
                      <fieldset>
                        <legend className="text-sm font-medium text-gray-700">
                          Properties for Owner permission
                        </legend>
                        <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto rounded-md border border-[#d7dde5] p-3 sm:grid-cols-2">
                          {properties.map((property) => (
                            <label
                              className="flex items-start gap-2 text-sm text-gray-700"
                              key={property.id}
                            >
                              <input
                                className="mt-0.5"
                                defaultChecked={assignments.some(
                                  (assignment) =>
                                    assignment.owner_id === user.id &&
                                    assignment.property_id === property.id,
                                )}
                                name="propertyIds"
                                type="checkbox"
                                value={property.id}
                              />
                              <span>{property.name}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <Button className="w-full" type="submit">
                        <CheckCircle2 className="h-4 w-4" />
                        Approve Permission
                      </Button>
                    </form>

                    <form action={reviewUserRegistration} className="space-y-3">
                      <input name="profileId" type="hidden" value={user.id} />
                      <input name="decision" type="hidden" value="rejected" />
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">
                          Rejection reason
                        </span>
                        <textarea
                          className="mt-2 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm"
                          name="reason"
                          placeholder="Explain why this registration is rejected"
                          required
                        />
                      </label>
                      <Button
                        className="w-full border-red-200 text-red-700 hover:bg-red-50"
                        type="submit"
                        variant="outline"
                      >
                        Reject
                      </Button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No user registrations are available for review.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ClaimBills({
  attachmentsByClaim,
  claims,
  expenses,
  liabilities,
  payoutProofs,
  payouts,
  profiles,
}: {
  attachmentsByClaim: Map<
    string,
    {
      id: string;
      content_type: string | null;
      fileName: string;
      signedUrl: string | null;
    }[]
  >;
  claims: {
    id: string;
    submitted_by: string;
    labour_cost: number | string;
    material_cost: number | string;
    total_amount: number | string | null;
    description: string | null;
    funding_source: string;
    bill_date: string;
    status: string;
    submitted_at: string;
    reviewed_at: string | null;
    rejection_reason: string | null;
    properties: { name: string } | { name: string }[] | null;
    rooms:
      | { name: string | null; room_number: string | null }
      | { name: string | null; room_number: string | null }[]
      | null;
    maintenance_tickets:
      | { ticket_number: string }
      | { ticket_number: string }[]
      | null;
  }[];
  expenses: {
    claim_id: string | null;
    funding_source: string;
    amount: number | string;
    status: string;
  }[];
  liabilities: {
    id: string;
    claim_id: string;
    expense_id: string;
    staff_id: string;
    amount: number | string;
    status: string;
    owed_at: string;
    paid_at: string | null;
    payout_id: string | null;
  }[];
  payoutProofs: Map<string, string | null>;
  payouts: {
    id: string;
    staff_id: string;
    total_amount: number | string;
    payment_source: string;
    paid_on: string;
    reference_number: string | null;
    notes: string | null;
    proof_bucket_name: string;
    proof_file_path: string;
    proof_content_type: string | null;
    recorded_by: string;
    created_at: string;
  }[];
  profiles: Map<
    string,
    {
      id: string;
      full_name: string | null;
      phone: string | null;
      bank_name: string | null;
      bank_account_holder: string | null;
      bank_account_number: string | null;
    }
  >;
}) {
  const liabilityByClaim = new Map(
    liabilities.map((liability) => [liability.claim_id, liability]),
  );
  const payoutById = new Map(payouts.map((payout) => [payout.id, payout]));
  const outstandingByStaff = new Map<
    string,
    { liabilityIds: string[]; total: number }
  >();
  for (const liability of liabilities) {
    if (liability.status !== "owed") continue;
    const group = outstandingByStaff.get(liability.staff_id) ?? {
      liabilityIds: [],
      total: 0,
    };
    group.liabilityIds.push(liability.id);
    group.total += Number(liability.amount);
    outstandingByStaff.set(liability.staff_id, group);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim Bills</CardTitle>
        <CardDescription>
          Repair bills paid with company cash or personal money. Every claim
          requires Admin verification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {outstandingByStaff.size ? (
          <section className="space-y-3">
            <div>
              <h3 className="font-semibold text-gray-950">
                Staff money owing — lump-sum knock off
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                One payout proof clips together every verified outstanding
                claim included in the total.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {[...outstandingByStaff.entries()].map(([staffId, group]) => {
                const profile = profiles.get(staffId);
                return (
                  <StaffReimbursementPayoutForm
                    bankAccountHolder={profile?.bank_account_holder ?? null}
                    bankAccountNumber={profile?.bank_account_number ?? null}
                    bankName={profile?.bank_name ?? null}
                    key={staffId}
                    liabilityIds={group.liabilityIds}
                    paidOn={malaysiaToday()}
                    staffId={staffId}
                    staffName={profile?.full_name ?? "Staff member"}
                    total={group.total}
                  />
                );
              })}
            </div>
          </section>
        ) : (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            No verified staff-funded claims are awaiting payout.
          </div>
        )}

        {claims.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill Date</TableHead>
                  <TableHead>Submitted By</TableHead>
                  <TableHead>Property / Room</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Paid From</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-72">Admin Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((claim) => {
                  const property = single(claim.properties);
                  const room = single(claim.rooms);
                  const ticket = single(claim.maintenance_tickets);
                  const expense = expenses.find(
                    (item) => item.claim_id === claim.id,
                  );
                  const attachments = attachmentsByClaim.get(claim.id) ?? [];
                  const liability = liabilityByClaim.get(claim.id);
                  const payout = liability?.payout_id
                    ? payoutById.get(liability.payout_id)
                    : undefined;
                  const total =
                    claim.total_amount ??
                    Number(claim.labour_cost ?? 0) +
                      Number(claim.material_cost ?? 0);
                  return (
                    <TableRow key={claim.id}>
                      <TableCell>
                        {formatMalaysiaDate(claim.bill_date)}
                      </TableCell>
                      <TableCell>
                        {profiles.get(claim.submitted_by)?.full_name ??
                          "Staff member"}
                      </TableCell>
                      <TableCell>
                        <p>{property?.name ?? "-"}</p>
                        <p className="text-xs text-gray-500">
                          {room
                            ? room.room_number ?? room.name ?? "Room"
                            : "No specific room"}
                          {ticket?.ticket_number
                            ? ` - ${ticket.ticket_number}`
                            : ""}
                        </p>
                      </TableCell>
                      <TableCell className="min-w-56">
                        {claim.description ?? "-"}
                      </TableCell>
                      <TableCell>
                        {(expense?.funding_source ?? claim.funding_source) ===
                        "staff_personal"
                          ? "My own money"
                          : "Company money"}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {money(total)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {attachments.map((attachment) => (
                            <DocumentPreview
                              contentType={attachment.content_type}
                              fileName={attachment.fileName}
                              key={attachment.id}
                              label="Claim receipt"
                              showName={false}
                              size="sm"
                              url={attachment.signedUrl}
                            />
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusBadgeClass(claim.status)}>
                          {claim.status === "pending_owner_approval"
                            ? "Pending verification"
                            : claim.status === "paid"
                              ? "Paid back"
                            : claim.status.replaceAll("_", " ")}
                        </Badge>
                        {claim.rejection_reason ? (
                          <p className="mt-2 text-xs text-red-600">
                            {claim.rejection_reason}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {["approved", "paid"].includes(claim.status) ? (
                          claim.funding_source === "staff_personal" &&
                          liability ? (
                            liability.status === "paid" && payout ? (
                              <div className="space-y-2 text-sm">
                                <p className="font-medium text-emerald-700">
                                  Paid back {formatMalaysiaDate(payout.paid_on)}
                                </p>
                                <p className="text-gray-600">
                                  Knock-off batch {money(payout.total_amount)}
                                  {payout.reference_number
                                    ? ` · ${payout.reference_number}`
                                    : ""}
                                </p>
                                <DocumentPreview
                                  contentType={payout.proof_content_type}
                                  fileName={
                                    payout.proof_file_path.split("/").at(-1) ??
                                    "Payout proof"
                                  }
                                  label="Payout proof"
                                  showName={false}
                                  size="sm"
                                  url={payoutProofs.get(payout.id) ?? null}
                                />
                              </div>
                            ) : (
                              <div className="text-sm">
                                <p className="font-semibold text-red-700">
                                  Company owes{" "}
                                  {profiles.get(liability.staff_id)?.full_name ??
                                    "staff"}{" "}
                                  {money(liability.amount)}
                                </p>
                                <p className="mt-1 text-gray-500">
                                  Included in the staff lump-sum payout above.
                                </p>
                              </div>
                            )
                          ) : (
                            <p className="text-sm text-[#126b5f]">
                              Verified by Admin — company-funded expense
                              recorded
                            </p>
                          )
                        ) : (
                          <div className="space-y-2">
                            <form action={reviewClaim}>
                              <input
                                name="claimId"
                                type="hidden"
                                value={claim.id}
                              />
                              <input
                                name="decision"
                                type="hidden"
                                value="approved"
                              />
                              <Button className="w-full" size="sm" type="submit">
                                Approve Claim
                              </Button>
                            </form>
                            <form
                              action={reviewClaim}
                              className="grid gap-2 sm:grid-cols-[1fr_auto]"
                            >
                              <input
                                name="claimId"
                                type="hidden"
                                value={claim.id}
                              />
                              <select
                                className="rounded-md border border-[#d7dde5] px-3 py-2 text-sm"
                                name="decision"
                                defaultValue=""
                                required
                              >
                                <option value="">Choose other action</option>
                                <option value="information_requested">
                                  Request information
                                </option>
                                <option value="rejected">Reject</option>
                              </select>
                              <Button size="sm" type="submit" variant="outline">
                                Save
                              </Button>
                              <textarea
                                className="min-h-16 rounded-md border border-[#d7dde5] px-3 py-2 text-sm sm:col-span-2"
                                name="reason"
                                placeholder="Reason required"
                                required
                              />
                            </form>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No claim bills are waiting for review.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TenancyProgress({
  applications,
  tenancies,
  agreementsByTenancy,
}: {
  applications: {
    id: string;
    property_id: string;
    room_id: string;
    full_name: string;
    verification_status: string;
    payment_status: string;
    status: string;
    proposed_start_date: string;
    proposed_end_date: string | null;
    properties: { name: string } | { name: string }[] | null;
    rooms:
      | { name: string; room_number: string | null }
      | { name: string; room_number: string | null }[]
      | null;
  }[];
  tenancies: {
    id: string;
    property_id: string;
    room_id: string;
    monthly_rental: number | string | null;
    tenancy_start_date: string | null;
    tenancy_end_date: string | null;
    contract_start: string | null;
    contract_end: string | null;
    status: string;
    renewal_status: string | null;
    checkout_date: string | null;
    tenants:
      | { full_name: string; phone: string | null }
      | { full_name: string; phone: string | null }[]
      | null;
    properties:
      | { name: string; is_commercial: boolean }
      | { name: string; is_commercial: boolean }[]
      | null;
    rooms:
      | { name: string; room_number: string | null; status: string }
      | { name: string; room_number: string | null; status: string }[]
      | null;
  }[];
  agreementsByTenancy: Map<
    string,
    {
      id: string;
      tenancy_id: string;
      term_type: "original" | "renewal";
      agreement_type: string;
      version_number: number;
      status: string;
      term_start_date: string | null;
      term_end_date: string | null;
      generated_at: string;
      signed_at: string | null;
      monthly_rent_snapshot: number | string | null;
    }
  >;
}) {
  const approvedApplications = applications.filter(
    (application) => application.verification_status === "verified",
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Approved Tenant Progress</CardTitle>
          <CardDescription>
            Approved tenants move through payment verification, agreement
            signature and check-in without creating duplicate tenancies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {approvedApplications.length ? (
            <div className="divide-y divide-[#d7dde5]">
              {approvedApplications.map((application) => {
                const property = single(application.properties);
                const room = single(application.rooms);
                const converted =
                  application.status === "converted_to_tenancy";
                return (
                  <div
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    key={application.id}
                  >
                    <div>
                      <p className="font-semibold text-gray-950">
                        {application.full_name}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        {property?.name ?? "Property"} /{" "}
                        {room?.room_number ?? room?.name ?? "Room"}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Proposed term {application.proposed_start_date} to{" "}
                        {application.proposed_end_date ?? "-"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className={statusBadgeClass(application.payment_status)}
                      >
                        Payment {application.payment_status.replaceAll("_", " ")}
                      </Badge>
                      <Badge className={converted ? "bg-emerald-100 text-emerald-800" : ""}>
                        {converted ? "Checked in" : "Room reserved"}
                      </Badge>
                      {!converted ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href="/verification?view=payments">
                            Review Payment
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No approved tenant applications are in progress.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Tenancies & Renewals</CardTitle>
          <CardDescription>
            Send unsigned agreements by WhatsApp or check the tenant out. Renewal
            terms are 12 months for commercial properties and 6 months otherwise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tenancies.length ? (
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Property / Room</TableHead>
                    <TableHead>Current Term</TableHead>
                    <TableHead>Agreement</TableHead>
                    <TableHead className="min-w-72">Signature</TableHead>
                    <TableHead className="min-w-72">Renew or Check Out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenancies.map((tenancy) => (
                    <TenancyRow
                      agreement={agreementsByTenancy.get(tenancy.id)}
                      key={tenancy.id}
                      tenancy={tenancy}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No active tenancies found.</p>
          )}

          {tenancies.length ? (
            <div className="grid gap-4 lg:hidden">
              {tenancies.map((tenancy) => (
                <TenancyCard
                  agreement={agreementsByTenancy.get(tenancy.id)}
                  key={tenancy.id}
                  tenancy={tenancy}
                />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

type TenancyItem = Parameters<typeof TenancyProgress>[0]["tenancies"][number];
type AgreementItem = Parameters<
  typeof TenancyProgress
>[0]["agreementsByTenancy"] extends Map<string, infer Value>
  ? Value
  : never;

function tenancyDisplay(tenancy: TenancyItem) {
  const tenant = single(tenancy.tenants);
  const property = single(tenancy.properties);
  const room = single(tenancy.rooms);
  return {
    tenant,
    property,
    room,
    start: formatMalaysiaDate(
      tenancy.tenancy_start_date ?? tenancy.contract_start,
    ),
    end: formatMalaysiaDate(tenancy.tenancy_end_date ?? tenancy.contract_end),
  };
}

function TenancyRow({
  tenancy,
  agreement,
}: {
  tenancy: TenancyItem;
  agreement?: AgreementItem;
}) {
  const display = tenancyDisplay(tenancy);
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium text-gray-950">
          {display.tenant?.full_name ?? "Tenant"}
        </p>
        <p className="text-xs text-gray-500">
          {display.tenant?.phone ?? "No phone"}
        </p>
      </TableCell>
      <TableCell>
        {display.property?.name ?? "-"} /{" "}
        {display.room?.room_number ?? display.room?.name ?? "-"}
      </TableCell>
      <TableCell>
        {display.start}
        <br />
        <span className="text-xs text-gray-500">to {display.end}</span>
      </TableCell>
      <TableCell>
        {agreement ? (
          <>
            <Badge className={statusBadgeClass(agreement.status)}>
              {agreement.status.replaceAll("_", " ")}
            </Badge>
            <p className="mt-1 text-xs text-gray-500">
              {agreement.term_type === "renewal" ? "Renewal" : "Original"}{" "}
              v{agreement.version_number} -{" "}
              {agreementTypeLabel(
                agreement.agreement_type === "commercial_office"
                  ? "commercial_office"
                  : "residential_room",
              )}
            </p>
          </>
        ) : (
          <Badge>Not generated</Badge>
        )}
      </TableCell>
      <TableCell>
        <SignatureActions agreement={agreement} tenancyId={tenancy.id} />
      </TableCell>
      <TableCell>
        <RenewalAndCheckout tenancy={tenancy} />
      </TableCell>
    </TableRow>
  );
}

function TenancyCard({
  tenancy,
  agreement,
}: {
  tenancy: TenancyItem;
  agreement?: AgreementItem;
}) {
  const display = tenancyDisplay(tenancy);
  return (
    <div className="rounded-md border border-[#d7dde5] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-950">
            {display.tenant?.full_name ?? "Tenant"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {display.property?.name ?? "-"} /{" "}
            {display.room?.room_number ?? display.room?.name ?? "-"}
          </p>
        </div>
        <Badge className={statusBadgeClass(agreement?.status ?? "draft")}>
          {agreement?.status.replaceAll("_", " ") ?? "Not generated"}
        </Badge>
      </div>
      <p className="mt-3 text-sm text-gray-600">
        {display.start} to {display.end}
      </p>
      <div className="mt-4 grid gap-3">
        <SignatureActions agreement={agreement} tenancyId={tenancy.id} />
        <RenewalAndCheckout tenancy={tenancy} />
      </div>
    </div>
  );
}

function SignatureActions({
  agreement,
  tenancyId,
}: {
  agreement?: AgreementItem;
  tenancyId: string;
}) {
  if (!agreement) {
    return (
      <Button asChild className="w-full" size="sm" variant="outline">
        <Link href={`/tenancy-agreements/preview/${tenancyId}`}>
          Generate Agreement
        </Link>
      </Button>
    );
  }

  const signed = ["signed", "renewal_signed"].includes(agreement.status);
  return (
    <div className="grid gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={`/e-tenancy/${agreement.id}`}>View Agreement</Link>
      </Button>
      {!signed ? (
        <>
          <form
            action={updateAgreementTermRent}
            className="grid grid-cols-[1fr_auto] gap-2"
          >
            <input name="agreementId" type="hidden" value={agreement.id} />
            <input
              aria-label="Agreement monthly rent"
              className="min-w-0 rounded-md border border-[#d7dde5] px-3 py-2 text-sm"
              defaultValue={Number(agreement.monthly_rent_snapshot ?? 0)}
              min="0.01"
              name="termMonthlyRent"
              step="0.01"
              type="number"
              required
            />
            <Button size="sm" type="submit" variant="outline">
              Save Rent
            </Button>
          </form>
          <form action={sendAgreementWhatsApp}>
            <input name="agreementId" type="hidden" value={agreement.id} />
            <Button className="w-full" size="sm" type="submit">
              <Send className="h-4 w-4" />
              Send / Resend WhatsApp
            </Button>
          </form>
        </>
      ) : (
        <p className="text-xs font-medium text-[#126b5f]">
          Signed {agreement.signed_at ? formatMalaysiaDate(agreement.signed_at) : ""}
        </p>
      )}
    </div>
  );
}

function RenewalAndCheckout({ tenancy }: { tenancy: TenancyItem }) {
  const display = tenancyDisplay(tenancy);
  const property = single(tenancy.properties);
  const duration = property?.is_commercial ? 12 : 6;
  return (
    <div className="grid gap-3">
      <form action={requestRenewalSignature} className="grid gap-2">
        <input name="tenancyId" type="hidden" value={tenancy.id} />
        <div className="rounded-md border border-[#dbc38e] bg-[#fbf6e9] px-3 py-2">
          <p className="text-xs font-medium text-[#8a6418]">
          Agreement type
          </p>
          <p className="mt-0.5 text-sm font-semibold text-gray-950">
            {agreementTypeLabel(
              agreementTypeForProperty(property?.is_commercial ?? false),
            )}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            Selected automatically from the property Commercial switch.
          </p>
        </div>
        <p className="text-xs text-gray-500">
          {duration}-month {property?.is_commercial ? "commercial" : "non-commercial"} renewal
        </p>
        <label className="grid gap-1 text-xs font-medium text-gray-600">
          Renewal rent (RM)
          <input
            className="rounded-md border border-[#d7dde5] px-3 py-2 text-sm text-gray-950"
            defaultValue={Number(tenancy.monthly_rental ?? 0)}
            min="0.01"
            name="renewalMonthlyRent"
            step="0.01"
            type="number"
            required
          />
        </label>
        <Button size="sm" type="submit" variant="outline">
          Prepare & Send Renewal
        </Button>
      </form>
      <form
        action={checkoutRoom}
        className="grid gap-2 sm:grid-cols-[140px_1fr]"
      >
        <input name="propertyId" type="hidden" value={tenancy.property_id} />
        <input name="roomId" type="hidden" value={tenancy.room_id} />
        <input
          name="returnTo"
          type="hidden"
          value="/verification?view=tenancy"
        />
        <input
          aria-label={`Checkout date for ${display.tenant?.full_name ?? "tenant"}`}
          className="rounded-md border border-[#d7dde5] px-3 py-2 text-sm"
          defaultValue={malaysiaToday()}
          name="checkoutDate"
          type="date"
          required
        />
        <Button
          className="border-red-200 text-red-700 hover:bg-red-50"
          size="sm"
          type="submit"
          variant="outline"
        >
          Check Out
        </Button>
      </form>
    </div>
  );
}

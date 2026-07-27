import Link from "next/link";
import {
  Banknote,
  CalendarDays,
  Camera,
  CheckCircle2,
  FileCheck2,
  FileText,
  House,
  Image as ImageIcon,
  LockKeyhole,
  Paperclip,
  Phone,
  ReceiptText,
  Upload,
  UserRound,
  Wrench,
} from "lucide-react";
import { createMaintenanceTicket } from "@/app/maintenance/actions";
import { uploadMonthlyPaymentProof } from "@/app/payments/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { statusBadgeClass } from "@/lib/status-styles";
import type { TenantPortalData } from "@/lib/data/tenant-portal";
import { PrintBillsButton } from "./print-bills-button";

const moneyFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

function money(value: number) {
  return moneyFormatter.format(value);
}

function date(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00+08:00`));
}

function dateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function UnassignedNotice() {
  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle>Your room or tenancy has not been assigned yet.</CardTitle>
        <CardDescription>
          Your registration remains visible while the Management team completes
          verification and room assignment.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function PaymentForm({ data }: { data: NonNullable<TenantPortalData> }) {
  const pendingBills = data.bills.filter(
    (bill) => !["paid", "cancelled", "waived"].includes(String(bill.status)),
  );

  return (
    <Card className="border-[#d8c28c]">
      <CardHeader>
        <CardTitle>Make a Payment</CardTitle>
        <CardDescription>
          Upload your transfer slip. Your balance changes after Admin verification.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pendingBills.length ? (
          <form action={uploadMonthlyPaymentProof} className="space-y-5">
            <label className="block">
              <span className="text-sm font-semibold text-gray-800">
                What are you paying?
              </span>
              <select
                className="mt-2 h-12 w-full rounded-md border border-[#cfd8e5] bg-white px-3 text-base"
                name="rentBillId"
                required
              >
                <option value="">Select a rent bill</option>
                {pendingBills.map((bill) => (
                  <option key={bill.id} value={bill.id}>
                    {date(bill.bill_month)} - {money(bill.outstanding)} outstanding
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-gray-800">
                Amount paid (RM)
              </span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cfd8e5] px-3 text-base"
                min="0.01"
                name="amount"
                placeholder="0.00"
                required
                step="0.01"
                type="number"
              />
            </label>

            <fieldset>
              <legend className="text-sm font-semibold text-gray-800">
                How did you pay?
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="cursor-pointer">
                  <input
                    className="peer sr-only"
                    defaultChecked
                    name="paymentMethod"
                    type="radio"
                    value="bank_transfer"
                  />
                  <span className="flex h-12 items-center justify-center rounded-md border border-[#cfd8e5] bg-white font-medium peer-checked:border-[#b8892c] peer-checked:bg-[#f6edd9] peer-checked:text-[#8a641d]">
                    Online transfer
                  </span>
                </label>
                <label className="cursor-pointer">
                  <input
                    className="peer sr-only"
                    name="paymentMethod"
                    type="radio"
                    value="cash"
                  />
                  <span className="flex h-12 items-center justify-center rounded-md border border-[#cfd8e5] bg-white font-medium peer-checked:border-[#b8892c] peer-checked:bg-[#f6edd9] peer-checked:text-[#8a641d]">
                    Cash
                  </span>
                </label>
              </div>
            </fieldset>

            <label className="block">
              <span className="text-sm font-semibold text-gray-800">
                Transfer slip
              </span>
              <span className="mt-2 flex min-h-14 items-center gap-3 rounded-md border border-dashed border-[#b8892c] bg-[#fbf6e9] px-4 text-sm font-semibold text-[#8a641d]">
                <Paperclip className="h-4 w-4" />
                <input
                  accept="image/*,.pdf"
                  className="min-w-0 flex-1 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#b8892c] file:px-3 file:py-2 file:font-semibold file:text-white"
                  name="receipt"
                  required
                  type="file"
                />
              </span>
            </label>

            <Button className="h-12 w-full sm:w-auto" type="submit">
              <Upload className="h-4 w-4" />
              Submit payment
            </Button>
          </form>
        ) : (
          <div className="flex items-start gap-3 rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            You have no unpaid rent bills.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TenantHome({ data }: { data: NonNullable<TenantPortalData> }) {
  if (!data.hasTenancy || !data.tenancy) {
    return (
      <section className="space-y-5">
        <PortalHeading eyebrow="Home" title={`Hello, ${data.profile.fullName}`} />
        <UnassignedNotice />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <PortalHeading
        eyebrow={`${data.tenancy.propertyName} / ${data.tenancy.roomName}`}
        title={`Hello, ${data.profile.fullName}`}
      />

      <Card className="overflow-hidden border-[#d8c28c]">
        <CardHeader className="border-b border-[#eee5d1] bg-[#fbf8f1]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Rental Terms</CardTitle>
              <CardDescription>{data.tenancy.roomName}</CardDescription>
            </div>
            <House className="h-6 w-6 text-[#b8892c]" />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-5 gap-y-6 pt-5">
          <Term label="Check-in" value={date(data.tenancy.checkIn)} />
          <Term label="Due day" value={data.tenancy.dueDay ? `${data.tenancy.dueDay}` : "-"} />
          <Term label="Monthly rent" value={money(data.tenancy.monthlyRent)} />
          <Term label="Contract end" value={date(data.tenancy.contractEnd)} />
          <Term
            className="col-span-2"
            danger={data.outstandingAmount > 0}
            label="Outstanding"
            value={money(data.outstandingAmount)}
          />
        </CardContent>
      </Card>

      <PaymentForm data={data} />
    </section>
  );
}

function PortalHeading({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase text-[#b8892c]">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-bold text-[#17130d] sm:text-3xl">
        {title}
      </h1>
    </div>
  );
}

function Term({
  className = "",
  danger = false,
  label,
  value,
}: {
  className?: string;
  danger?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className={className}>
      <p className="text-sm text-gray-500">{label}</p>
      <p
        className={`mt-1 text-base font-semibold ${
          danger ? "text-red-600" : "text-gray-950"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function TenantMaintenance({
  data,
  created,
  error,
}: {
  data: NonNullable<TenantPortalData>;
  created?: boolean;
  error?: string;
}) {
  return (
    <section className="space-y-5">
      <PortalHeading eyebrow="Maintenance" title="Report an Issue" />

      {created ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Your report was submitted successfully.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {!data.hasTenancy || !data.tenancy ? (
        <UnassignedNotice />
      ) : (
        <Card className="border-[#d8c28c]">
          <CardHeader>
            <CardTitle>Tell us what happened</CardTitle>
            <CardDescription>
              {data.tenancy.propertyName} / {data.tenancy.roomName}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={createMaintenanceTicket}
              className="space-y-5"
              encType="multipart/form-data"
            >
              <input name="ticketType" type="hidden" value="maintenance" />
              <input name="urgency" type="hidden" value="normal" />
              <label className="block">
                <span className="text-sm font-semibold text-gray-800">
                  What&apos;s the problem?
                </span>
                <textarea
                  className="mt-2 min-h-32 w-full rounded-md border border-[#cfd8e5] px-3 py-3 text-base"
                  name="description"
                  placeholder="For example: The aircond is leaking water"
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-gray-800">
                  Photo (optional)
                </span>
                <span className="mt-2 flex min-h-14 items-center gap-3 rounded-md border border-dashed border-[#b8892c] bg-[#fbf6e9] px-4">
                  <Camera className="h-5 w-5 shrink-0 text-[#b8892c]" />
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="min-w-0 flex-1 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#b8892c] file:px-3 file:py-2 file:font-semibold file:text-white"
                    name="photo"
                    type="file"
                  />
                </span>
              </label>
              <Button className="h-12 w-full sm:w-auto" type="submit">
                <Wrench className="h-4 w-4" />
                Submit report
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Maintenance Reports</CardTitle>
          <CardDescription>Your submitted issues and their latest status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.tickets.length ? (
            data.tickets.map((ticket) => (
              <article
                className="flex items-start gap-4 rounded-md border border-[#d7dde5] p-4"
                key={ticket.id}
              >
                {ticket.attachments[0]?.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-md object-cover"
                    src={ticket.attachments[0].signedUrl}
                  />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-[#f2f4f7] text-gray-400">
                    <ImageIcon className="h-6 w-6" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-gray-950">
                      {ticket.category || ticket.ticket_number}
                    </p>
                    <Badge className={statusBadgeClass(ticket.status)}>
                      {titleCase(ticket.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                    {ticket.description}
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    {ticket.propertyName} / {ticket.roomName} /{" "}
                    {dateTime(ticket.created_at)}
                  </p>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-gray-500">
              You have not submitted a maintenance report yet.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function TenantBills({
  data,
  proofSubmitted,
  error,
}: {
  data: NonNullable<TenantPortalData>;
  proofSubmitted?: boolean;
  error?: string;
}) {
  return (
    <section className="space-y-5 print:bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PortalHeading eyebrow="Bills" title="Bills & Receipts" />
        <PrintBillsButton />
      </div>

      {proofSubmitted ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Payment proof submitted and pending Admin verification.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryTile
          icon={ReceiptText}
          label="Outstanding"
          value={money(data.outstandingAmount)}
        />
        <SummaryTile
          icon={CheckCircle2}
          label="Verified payments"
          value={`${data.payments.filter((payment) => String(payment.status) === "confirmed").length}`}
        />
        <SummaryTile
          icon={CalendarDays}
          label="Due day"
          value={data.tenancy?.dueDay ? `${data.tenancy.dueDay}` : "-"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Rent Bills</CardTitle>
          <CardDescription>Current and historical invoices remain available.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.bills.length ? (
            data.bills.map((bill) => (
              <article
                className="grid gap-3 rounded-md border border-[#d7dde5] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                key={bill.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-950">
                      {date(bill.bill_month)}
                    </p>
                    <Badge className={statusBadgeClass(bill.status)}>
                      {titleCase(bill.status)}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">
                    Due {date(bill.due_date)} / Bill {money(bill.amount)}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs uppercase text-gray-500">Outstanding</p>
                  <p
                    className={`mt-1 font-bold ${
                      bill.outstanding > 0 ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {money(bill.outstanding)}
                  </p>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-gray-500">No rent bills are available yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment & Receipt History</CardTitle>
          <CardDescription>
            Uploaded slips remain pending until Admin verification.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.submissions.length ? (
            data.submissions.map((submission) => (
              <article
                className="rounded-md border border-[#d7dde5] p-4"
                key={submission.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-950">
                      {titleCase(submission.bill_type)}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {date(submission.payment_date)} / {money(submission.amount)}
                    </p>
                    {submission.reference_number ? (
                      <p className="mt-1 text-xs text-gray-500">
                        Reference: {submission.reference_number}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    className={statusBadgeClass(
                      submission.verification_status,
                    )}
                  >
                    {titleCase(submission.verification_status)}
                  </Badge>
                </div>
                {submission.rejection_reason ? (
                  <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    {submission.rejection_reason}
                  </p>
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-sm text-gray-500">
              No payment slips have been submitted yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenancy Agreements</CardTitle>
          <CardDescription>Every agreement term remains available here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.agreements.length ? (
            data.agreements.map((agreement) => (
              <article
                className="flex flex-col justify-between gap-4 rounded-md border border-[#d7dde5] p-4 sm:flex-row sm:items-center"
                key={agreement.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FileCheck2 className="h-5 w-5 text-[#b8892c]" />
                    <p className="font-semibold">
                      {agreement.agreement_type === "renewal"
                        ? "Renewal Agreement"
                        : "Tenancy Agreement"}{" "}
                      v{agreement.version_number}
                    </p>
                    <Badge className={statusBadgeClass(agreement.status)}>
                      {titleCase(agreement.status)}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">
                    {date(agreement.term_start_date)} to{" "}
                    {date(agreement.term_end_date)}
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link href={`/e-tenancy/${agreement.id}`}>
                    <FileText className="h-4 w-4" />
                    View
                  </Link>
                </Button>
              </article>
            ))
          ) : (
            <p className="text-sm text-gray-500">
              Your tenancy agreement has not been issued yet.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#f6edd9] text-[#8a641d]">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="mt-1 font-bold text-gray-950">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function TenantProfile({ data }: { data: NonNullable<TenantPortalData> }) {
  const verified = data.profile.registrationStatus === "approved";
  const documentLabels: Record<string, string> = {
    ic_front: "IC - Front",
    ic_back: "IC - Back",
    passport_photo_page: "Passport Photo Page",
    commercial_supporting_document: "Supporting Document",
  };

  return (
    <section className="space-y-5">
      <PortalHeading eyebrow="Profile" title="My Profile" />

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-md bg-red-50 text-[#ef5c5c]">
              <UserRound className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Personal Details</CardTitle>
              <CardDescription>
                {verified
                  ? "Verified details are locked. Contact Management to change them."
                  : "Your details are awaiting verification."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {verified ? (
            <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              Personal details are locked after Admin verification.
            </div>
          ) : null}
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <ProfileField label="Full name" value={data.profile.fullName} />
            <ProfileField
              icon={Phone}
              label="Phone number"
              value={data.profile.phone ?? "-"}
            />
            <ProfileField
              label="Identity type"
              value={titleCase(data.profile.identityType)}
            />
            <ProfileField
              label="IC / Passport number"
              value={data.profile.identityNumber ?? "-"}
            />
            <ProfileField label="Email" value={data.profile.email ?? "-"} />
            <ProfileField
              label="Verification"
              value={titleCase(data.profile.registrationStatus)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Your private identity and supporting documents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.documents.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.documents.map((document) => (
                <article
                  className="rounded-md border border-[#d7dde5] p-4"
                  key={document.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[#b8892c]" />
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {documentLabels[document.document_type] ??
                            titleCase(document.document_type)}
                        </p>
                        <p className="mt-1 truncate text-xs text-gray-500">
                          {document.file_name ?? "Uploaded document"}
                        </p>
                      </div>
                    </div>
                    <Badge
                      className={statusBadgeClass(
                        document.verification_status,
                      )}
                    >
                      {titleCase(document.verification_status)}
                    </Badge>
                  </div>
                  {document.signedUrl ? (
                    <Button asChild className="mt-4 w-full" variant="outline">
                      <Link href={document.signedUrl} target="_blank">
                        View document
                      </Link>
                    </Button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No documents are available.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rental Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <ProfileField
            label="Property"
            value={data.tenancy?.propertyName ?? "Not assigned"}
          />
          <ProfileField
            label="Room"
            value={data.tenancy?.roomName ?? "Not assigned"}
          />
          <ProfileField
            label="Monthly rent"
            value={money(data.tenancy?.monthlyRent ?? 0)}
          />
          <ProfileField
            label="Contract end"
            value={date(data.tenancy?.contractEnd)}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function ProfileField({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof Phone;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm text-gray-500">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </p>
      <p className="mt-1 break-words font-semibold text-gray-950">{value}</p>
    </div>
  );
}

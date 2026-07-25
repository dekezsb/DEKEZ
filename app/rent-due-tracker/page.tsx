import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Banknote, CalendarClock, CheckCircle2, Clock, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { malaysiaDateString, getRentDueSummary, type RentDueBill, type RentDueBucket } from "@/lib/data/rent-due";
import { money } from "@/lib/e-tenancy";
import { statusBadgeClass } from "@/lib/status-styles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { RentDueActions } from "./rent-due-actions";

type PageProps = {
  searchParams: Promise<{
    bucket?: string;
    property?: string;
    unit?: string;
    room?: string;
    tenant?: string;
    month?: string;
    dueStatus?: string;
    paymentStatus?: string;
    daysOverdue?: string;
    search?: string;
    sent?: string;
    paid?: string;
    verified?: string;
    rejected?: string;
    error?: string;
  }>;
};

const bucketLabels: Array<{ key: RentDueBucket; label: string; group: "before" | "due" | "overdue" }> = [
  { key: "before_7", label: "-7d", group: "before" },
  { key: "before_6", label: "-6d", group: "before" },
  { key: "before_5", label: "-5d", group: "before" },
  { key: "before_4", label: "-4d", group: "before" },
  { key: "before_3", label: "-3d", group: "before" },
  { key: "before_2", label: "-2d", group: "before" },
  { key: "before_1", label: "-1d", group: "before" },
  { key: "due_today", label: "Due Today", group: "due" },
  { key: "overdue_1", label: "+1d", group: "overdue" },
  { key: "overdue_2", label: "+2d", group: "overdue" },
  { key: "overdue_3", label: "+3d", group: "overdue" },
  { key: "overdue_4", label: "+4d", group: "overdue" },
  { key: "overdue_5", label: "+5d", group: "overdue" },
  { key: "overdue_6", label: "+6d", group: "overdue" },
  { key: "overdue_7", label: "+7d", group: "overdue" },
  { key: "overdue_more_7", label: ">7d", group: "overdue" },
];

const errorMessages: Record<string, string> = {
  reminder_missing: "Choose a bill and reminder message.",
  tenant_phone: "This tenant has no WhatsApp or phone number.",
  duplicate_reminder: "A reminder for this bill and stage was already sent.",
  whatsapp_failed: "WhatsApp could not send. The failed attempt was logged.",
  mark_paid_missing: "Enter payment type, amount, date and a reference or note.",
  mark_paid_failed: "Payment could not be recorded.",
  duplicate_payment: "A payment with this bill and reference already exists.",
  bill_not_found: "Bill could not be found or is already closed.",
  verify_missing: "Choose a payment submission to verify.",
  reject_missing: "Choose a payment submission and rejection reason.",
  already_verified: "This payment has already been verified.",
};

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function groupClass(group: "before" | "due" | "overdue", active: boolean) {
  if (active) {
    return "border-[#0b1733] bg-[#0b1733] text-white";
  }
  if (group === "before") {
    return "border-[#d7dde5] bg-white text-[#214066]";
  }
  if (group === "due") {
    return "border-[#b98a2c]/40 bg-[#fff8e8] text-[#7a5618]";
  }
  return "border-red-200 bg-red-50 text-red-700";
}

function statusLabel(bill: RentDueBill) {
  if (bill.paymentStatus === "pending_verification") {
    return "Payment Submitted - Pending Verification";
  }
  if (bill.daysUntilDue === 0) {
    return "Due Today";
  }
  if (bill.daysUntilDue < 0) {
    return `${Math.abs(bill.daysUntilDue)} day(s) overdue`;
  }
  if (bill.daysUntilDue <= 7) {
    return `${bill.daysUntilDue} day(s) before due`;
  }
  return "Upcoming";
}

function statusClass(bill: RentDueBill) {
  if (bill.paymentStatus === "pending_verification") {
    return "bg-amber-100 text-amber-800";
  }
  if (bill.daysUntilDue < 0) {
    return "bg-red-100 text-red-700";
  }
  if (bill.daysUntilDue === 0) {
    return "bg-[#fff2cc] text-[#7a5618]";
  }
  return "bg-blue-100 text-blue-700";
}

function reminderMessage(bill: RentDueBill) {
  const portalLink = `${process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://dekez.vercel.app"}/payments`;
  if (bill.daysUntilDue < 0) {
    return `Hello ${bill.tenantName}, your rental payment of ${money(bill.outstandingAmount)} for ${bill.propertyName} ${bill.roomName} was due on ${bill.due_date} and is now ${Math.abs(bill.daysUntilDue)} day(s) overdue. Please make payment and upload your payment proof as soon as possible through your DEKEZ tenant portal: ${portalLink}`;
  }

  return `Hello ${bill.tenantName}, this is a reminder that your rental of ${money(bill.amount)} for ${bill.propertyName} ${bill.roomName} is due on ${bill.due_date}. Please make payment and upload your payment slip through your DEKEZ tenant portal: ${portalLink}`;
}

export default async function RentDueTrackerPage({ searchParams }: PageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const params = await searchParams;
  const summary = await getRentDueSummary(params);
  const supabase = await getAdmin();
  const [propertiesResult, unitsResult, roomsResult, profilesResult] = await Promise.all([
    supabase.from("properties").select("id, name").order("name", { ascending: true }),
    supabase.from("units").select("id, name, property_id").order("name", { ascending: true }),
    supabase.from("rooms").select("id, name, room_number, property_id, unit_id").order("room_number", { ascending: true }),
    supabase.from("profiles").select("id, full_name, phone").eq("role", "tenant").order("full_name", { ascending: true }),
  ]);

  const receiptUrls = new Map<string, string>();
  for (const bill of summary.bills) {
    if (bill.latestSubmissionId && bill.latestReceiptUrl) {
      const { data } = await supabase.storage.from("payment-receipts").createSignedUrl(bill.latestReceiptUrl, 60 * 10);
      if (data?.signedUrl) {
        receiptUrls.set(bill.latestSubmissionId, data.signedUrl);
      }
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b98a2c]">Rent Reminder</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Rent Due Tracker</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Track upcoming, due today and overdue rent from rent bills and imported tenant records. Uploaded slips stay pending until verified.
          </p>
        </div>
        <div className="grid gap-2 rounded-lg border border-[#d7dde5] bg-white p-4 text-sm shadow-sm sm:grid-cols-3 lg:min-w-[520px]">
          <SummaryMini label="Total due / overdue" value={summary.totalDueOverdue} />
          <SummaryMini label="Total coming up" value={summary.totalComingUp} />
          <SummaryMini label="Outstanding" value={money(summary.totalOutstanding)} />
        </div>
      </div>

      {params.sent === "1" ? <Notice>WhatsApp reminder sent and logged.</Notice> : null}
      {params.paid === "1" ? <Notice>Rent payment recorded and bill updated.</Notice> : null}
      {params.verified === "1" ? <Notice>Payment slip verified and bill updated.</Notice> : null}
      {params.rejected === "1" ? <Notice>Payment proof rejected and tenant can upload again.</Notice> : null}
      {params.error ? <Notice danger>{errorMessages[params.error] ?? "Action could not be completed."}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={CalendarClock} label="Due Today" value={summary.dueToday} />
        <MetricCard icon={Clock} label="Coming Up in 7 Days" value={summary.comingUpIn7Days} />
        <MetricCard icon={AlertTriangle} label="Overdue Tenants" value={summary.overdueTenants} />
        <MetricCard icon={Banknote} label="Total Outstanding" value={money(summary.totalOutstanding)} />
        <MetricCard icon={ReceiptText} label="Slips Pending Verification" value={summary.pendingPaymentSlips} />
        <MetricCard icon={CheckCircle2} label="Rent Collected This Month" value={money(summary.rentCollectedThisMonth)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rent Due Tracker</CardTitle>
          <CardDescription>Click a box to filter tenants and bills below.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto pb-2">
            <div className="grid min-w-[980px] grid-cols-[repeat(16,minmax(76px,1fr))] gap-2">
              {bucketLabels.map((bucket) => {
                const active = params.bucket === bucket.key;
                return (
                  <Link
                    className={`rounded-lg border p-3 text-center shadow-sm transition hover:shadow-md ${groupClass(bucket.group, active)}`}
                    href={`/rent-due-tracker?bucket=${bucket.key}`}
                    key={bucket.key}
                  >
                    <p className="text-xs font-semibold uppercase">{bucket.group === "before" ? "Before Due" : bucket.group === "due" ? "Due" : "Overdue"}</p>
                    <p className="mt-2 text-sm font-semibold">{bucket.label}</p>
                    <p className="mt-2 text-2xl font-bold">{summary.counts[bucket.key] ?? 0}</p>
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="mt-4">
            <Button asChild size="sm" variant="outline">
              <Link href="/rent-due-tracker">Clear tracker filter</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter by property, tenant, month, status or search tenant phone and room number.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-4 xl:grid-cols-5" method="get">
            {params.bucket ? <input name="bucket" type="hidden" value={params.bucket} /> : null}
            <SelectField label="Property" name="property" value={params.property ?? ""} options={(propertiesResult.data ?? []).map((item) => ({ value: item.id, label: item.name }))} />
            <SelectField label="Unit" name="unit" value={params.unit ?? ""} options={(unitsResult.data ?? []).map((item) => ({ value: item.id, label: item.name }))} />
            <SelectField label="Room" name="room" value={params.room ?? ""} options={(roomsResult.data ?? []).map((item) => ({ value: item.id, label: item.room_number ?? item.name }))} />
            <SelectField label="Tenant" name="tenant" value={params.tenant ?? ""} options={(profilesResult.data ?? []).map((item) => ({ value: item.id, label: item.full_name ?? item.phone ?? item.id }))} />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Bill month</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="month" type="month" defaultValue={params.month ?? ""} />
            </label>
            <SelectField label="Due status" name="dueStatus" value={params.dueStatus ?? "all"} options={[
              { value: "all", label: "All" },
              { value: "coming_up", label: "Coming up" },
              { value: "due_today", label: "Due today" },
              { value: "overdue", label: "Overdue" },
              { value: "severely_overdue", label: "More than 7 days overdue" },
            ]} includeAll={false} />
            <SelectField label="Payment status" name="paymentStatus" value={params.paymentStatus ?? "all"} options={[
              { value: "all", label: "All" },
              { value: "unpaid", label: "Unpaid" },
              { value: "pending_verification", label: "Pending verification" },
              { value: "partially_paid", label: "Partially paid" },
              { value: "rejected", label: "Rejected" },
            ]} includeAll={false} />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Days overdue</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="daysOverdue" placeholder="3" defaultValue={params.daysOverdue ?? ""} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Search</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="search" placeholder="Tenant, phone, room" defaultValue={params.search ?? ""} />
            </label>
            <div className="flex items-end gap-2">
              <Button className="w-full" type="submit">Apply</Button>
              <Button asChild className="w-full" variant="outline"><Link href="/rent-due-tracker">Reset</Link></Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant Bills</CardTitle>
          <CardDescription>Only unpaid, partial, submitted, pending and overdue bills are shown.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary.bills.length ? (
            <>
              <div className="hidden overflow-x-auto xl:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Property</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Monthly Rent</TableHead>
                      <TableHead>Bill Month</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>WhatsApp</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Outstanding</TableHead>
                      <TableHead className="min-w-56">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.bills.map((bill) => (
                      <TableRow key={bill.id}>
                        <TableCell className="font-medium text-gray-950">{bill.tenantName}</TableCell>
                        <TableCell>{bill.propertyName}</TableCell>
                        <TableCell>{bill.unitName}</TableCell>
                        <TableCell>{bill.roomName}</TableCell>
                        <TableCell>{money(bill.amount)}</TableCell>
                        <TableCell>{bill.bill_month}</TableCell>
                        <TableCell>{bill.due_date}</TableCell>
                        <TableCell><Badge className={statusClass(bill)}>{statusLabel(bill)}</Badge></TableCell>
                        <TableCell>{bill.tenantPhone ?? "-"}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge className={statusBadgeClass(bill.paymentStatus)}>{bill.paymentStatus}</Badge>
                            {bill.latestSubmissionStatus ? <p className="text-xs text-gray-500">Slip: {bill.latestSubmissionStatus}</p> : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold text-gray-950">{money(bill.outstandingAmount)}</TableCell>
                        <TableCell>
                          {bill.source === "rent_bill" ? (
                            <RentDueActions
                              amountDue={money(bill.amount)}
                              billId={bill.id}
                              billMonth={bill.bill_month}
                              latestSubmissionId={bill.latestSubmissionId}
                              latestSubmissionStatus={bill.latestSubmissionStatus}
                              outstandingAmount={money(bill.outstandingAmount)}
                              paidDateDefault={malaysiaDateString()}
                              propertyName={bill.propertyName}
                              receiptUrl={bill.latestSubmissionId ? receiptUrls.get(bill.latestSubmissionId) : null}
                              reminderMessage={reminderMessage(bill)}
                              roomName={bill.roomName}
                              tenantName={bill.tenantName}
                            />
                          ) : (
                            <p className="max-w-48 text-xs text-gray-500">Imported tenant record. Generate a rent bill before payment actions.</p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid gap-4 xl:hidden">
                {summary.bills.map((bill) => (
                  <div className="rounded-lg border border-[#d7dde5] bg-white p-4 shadow-sm" key={bill.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-gray-950">{bill.tenantName}</p>
                        <p className="mt-1 text-sm text-gray-600">{bill.propertyName} / {bill.roomName}</p>
                        <p className="mt-2 text-xl font-bold">{money(bill.outstandingAmount)}</p>
                        <p className="text-xs text-gray-500">Due {bill.due_date} / {bill.bill_month}</p>
                      </div>
                      <div className="space-y-2">
                        <Badge className={statusClass(bill)}>{statusLabel(bill)}</Badge>
                        <Badge className={statusBadgeClass(bill.paymentStatus)}>{bill.paymentStatus}</Badge>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
                      <p>Unit: {bill.unitName}</p>
                      <p>WhatsApp: {bill.tenantPhone ?? "-"}</p>
                      <p>Monthly rent: {money(bill.amount)}</p>
                      <p>Paid: {money(bill.paid_amount)}</p>
                    </div>
                    <div className="mt-4">
                      {bill.source === "rent_bill" ? (
                        <RentDueActions
                          amountDue={money(bill.amount)}
                          billId={bill.id}
                          billMonth={bill.bill_month}
                          latestSubmissionId={bill.latestSubmissionId}
                          latestSubmissionStatus={bill.latestSubmissionStatus}
                          outstandingAmount={money(bill.outstandingAmount)}
                          paidDateDefault={malaysiaDateString()}
                          propertyName={bill.propertyName}
                          receiptUrl={bill.latestSubmissionId ? receiptUrls.get(bill.latestSubmissionId) : null}
                          reminderMessage={reminderMessage(bill)}
                          roomName={bill.roomName}
                          tenantName={bill.tenantName}
                        />
                      ) : (
                        <p className="text-sm text-gray-500">Imported tenant record. Generate a rent bill before payment actions.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">No rent bills match this filter.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Notice({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white px-4 py-3 text-sm font-medium shadow-sm ${danger ? "border-red-200 text-red-600" : "border-[#126b5f]/30 text-[#126b5f]"}`}>
      {children}
    </div>
  );
}

function SummaryMini({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-950">{value}</p>
    </div>
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

function SelectField({
  label,
  name,
  value,
  options,
  includeAll = true,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  includeAll?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name={name} defaultValue={value}>
        {includeAll ? <option value="">All</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

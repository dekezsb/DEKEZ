import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { collectionHistory, collectionPreview } from "@/lib/rental-collection/service";
import { formatCollectionMessage } from "@/lib/rental-collection/model";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type Preview = Awaited<ReturnType<typeof collectionPreview>>;
type CollectionItem = Preview["items"][number];
type History = Awaited<ReturnType<typeof collectionHistory>>;
type Params = { after?: string; historyAfter?: string; day?: string; stage?: string };
const basePath = "/admin-setup/rental-reminders";
const linkClass = "inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium";

const stageLabels: Record<string, string> = {
  advance_7: "Due in 7 days", due_in_7: "Due in 7 days", due_today: "Due today",
  overdue_1_6: "Overdue days 1–6", day_7_review: "Day 7 · account review",
  overdue_8_13: "Overdue days 8–13", day_14_review: "Day 14 · termination review",
  overdue_15_plus: "Overdue days 15+", pending_verification: "Pending verification", resolved: "Resolved",
  tracking: "Not due for a reminder today", exception: "Source exception · review required",
};
const exceptionLabels: Record<string, string> = {
  consent_missing: "WhatsApp opt-in evidence required", no_consent: "WhatsApp opt-in evidence required",
  opted_out: "WhatsApp opt-out recorded", communication_hold: "Communication hold",
  disputed: "Dispute requires Management review", pending_verification: "Payment verification pending",
  pending_payment: "Payment verification pending", verification_mismatch: "Verified payment reconciliation required",
  policy_disabled: "Collection policy disabled", compliance_not_approved: "Compliance approval required",
  ambiguous_phone: "Shared or ambiguous phone · privacy review", invalid_phone: "Phone requires review",
  protected_recipient: "Management/sender number — never a tenant reminder recipient",
  whatsapp_ownership_unverified: "Verify intended tenant's ownership of this WhatsApp number",
  consent_number_mismatch: "Consent must match the current portal login phone",
  previous_tenant_or_room_mismatch: "Current tenancy and room assignment require review",
  opt_out_not_ready: "STOP / opt-out intake is not ready",
  inactive_tenancy: "Tenancy is not eligible for active collection", missing_agreement: "Agreement review required",
};
function label(stage: string) { return stageLabels[stage] ?? stage.replaceAll("_", " "); }
function exceptionLabel(code: string) { return exceptionLabels[code] ?? `Review required: ${code.replaceAll("_", " ")}`; }
function money(value: number | string | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? `RM ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Unavailable";
}
function maskedPhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "Phone unavailable";
}
function timestamp(value: string | null | undefined) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short",
  }).format(date) + " MYT" : "Unavailable";
}
function safeCursor(value: string | undefined) {
  return value && /^[A-Za-z0-9:_-]{1,200}$/.test(value) ? value : undefined;
}
function safeDay(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
function url(params: Params, changes: Partial<Params> = {}) {
  const next = { ...params, ...changes };
  const query = new URLSearchParams();
  for (const key of ["after", "historyAfter", "day", "stage"] as const) if (next[key]) query.set(key, next[key]);
  return query.size ? `${basePath}?${query}` : basePath;
}
function messagePreview(item: CollectionItem) {
  if (item.resolved) return "No reminder: the verified balance is settled.";
  if (item.pending_verification) return "No payment demand will be sent while verification is pending. This case is referred to Admin for payment review.";
  try { return formatCollectionMessage(item) ?? "No outgoing message is eligible for this record. Review the source exceptions and communication restrictions."; }
  catch { return "A message preview is unavailable for this exception. No message has been sent."; }
}
function pendingReference(value: unknown) {
  return value && typeof value === "object" && "reference" in value && typeof value.reference === "string"
    ? value.reference.slice(0, 100) : "Submitted payment";
}
function policyHolds(item: CollectionItem) {
  const policy = item.policy;
  return [
    policy?.enabled !== true ? "Collection policy disabled" : null,
    policy?.consent === "opted_out" ? "WhatsApp opt-out recorded — no contact" : policy?.consent !== "opted_in" ? "WhatsApp opt-in evidence required" : null,
    policy?.compliance_approved !== true ? "Compliance approval required" : null,
    policy?.opt_out_ready !== true ? "Opt-out handling is not ready" : null,
    item.whatsapp_ownership_verified !== true ? "WhatsApp ownership is not verified — portal login is not proof" : null,
    item.protected_recipient === true ? "Management/sender number is blocked for tenant reminders" : null,
    item.recipient_source !== "tenant_portal_login" ? "Recipient must come from the verified tenant portal login profile" : null,
    policy?.hold && policy.hold !== "none" ? `Communication hold: ${policy.hold.replaceAll("_", " ")}` : null,
    policy?.consent === "opted_in" && policy.approved_recipient !== item.phone ? "Approved recipient requires confirmation" : null,
  ].filter((reason): reason is string => reason !== null);
}

function TenantCard({ item }: { item: CollectionItem }) {
  const holds = policyHolds(item);
  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><CardTitle>{item.name || "Tenant reference unavailable"}</CardTitle>
          <CardDescription>{maskedPhone(item.phone)} · {label(item.stage)} · {item.days_overdue === null ? "Due date requires review" : item.days_overdue > 0 ? `${item.days_overdue} days overdue` : "Not overdue"}</CardDescription></div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${item.send_eligible ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
          {item.send_eligible ? "Eligible · preview only" : "Sending withheld"}
        </span>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="text-xs text-gray-600">Recipient source: tenant portal login profile. No alternate WhatsApp address is used. A login number is not proof of WhatsApp ownership or consent.</p>
      {(item.delivery_blocks?.length ?? 0) > 0 ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-medium">Admin follow-up required — no message</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">{item.delivery_blocks!.map(code => <li key={code}>{exceptionLabel(code)}</li>)}</ul>
        <p className="mt-2 text-xs">Daily review retains these restrictions without changing the invoice deadline. This read-only preview does not create a production task.</p>
      </div> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <p className="text-sm text-gray-600">Recorded invoice balance · verify exceptions<span className="mt-1 block text-lg font-semibold text-gray-950">{money(item.outstanding)}</span></p>
        <p className="text-sm text-gray-600">Verified collectible balance<span className="mt-1 block text-lg font-semibold text-gray-950">{money(item.collectible_outstanding)}</span></p>
        <p className="text-sm text-gray-600">Part-paid invoices<span className="mt-1 block font-medium text-gray-950">{item.partial_invoices}</span></p>
        <p className="text-sm text-gray-600">Payment review<span className="mt-1 block font-medium text-gray-950">{item.pending_verification ? "Pending · no demand" : "No pending submission flagged"}</span></p>
      </div>
      <p className="text-xs text-gray-600">Verified arrears: {money(item.arrears_outstanding)}. Future invoices are not demanded early. Partial payments reduce balances but never restart the original due-date clock.
        {item.arrears_resolved ? " Verified arrears are settled; any future invoice remains on its own due date." : ""}
        {item.recorded_days_overdue !== null && item.recorded_days_overdue !== item.days_overdue ? ` Raw recorded aging: ${item.recorded_days_overdue} days (audit only; not the collectible escalation clock).` : ""}</p>
      {holds.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-medium">Policy holds — sending is not authorized</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">{holds.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </div> : null}
      {item.exceptions.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-medium">Exceptions / communication restrictions</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">{item.exceptions.map((code) => <li key={code}>{exceptionLabel(code)}</li>)}</ul>
      </div> : null}
      <details className="rounded-lg border p-3">
        <summary className="min-h-8 cursor-pointer text-sm font-medium">Invoice and original due-date breakdown ({item.invoices.length})</summary>
        <div className="mt-3 space-y-3">{item.invoices.map((invoice) => <div key={invoice.id} className="rounded-lg border bg-white/70 p-3 text-sm">
          <p className="break-words font-medium">{invoice.property} · {invoice.room} · {invoice.reference || invoice.id}</p>
          <p className="mt-1 text-xs text-gray-600">{invoice.collectible ? "Included in verified collectible balance; its own due date still applies." : "Excluded from collectible balance and escalation; retained for audit review."}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><dt className="text-xs text-gray-600">Original due date</dt><dd>{invoice.due_date || "Unavailable"}</dd></div>
            <div><dt className="text-xs text-gray-600">Original charge + extra lines</dt><dd>{money(invoice.base_amount == null || invoice.extra_amount == null ? null : Number(invoice.base_amount) + Number(invoice.extra_amount))}</dd></div>
            <div><dt className="text-xs text-gray-600">Recorded paid amount</dt><dd>{money(invoice.paid_amount)}</dd></div>
            <div><dt className="text-xs text-gray-600">Verified payment evidence</dt><dd>{money(invoice.verified_paid)}</dd></div>
            <div><dt className="text-xs text-gray-600">Recorded invoice balance</dt><dd className="font-semibold">{money(invoice.outstanding)}</dd></div>
            <div><dt className="text-xs text-gray-600">Invoice status</dt><dd>{invoice.status.replaceAll("_", " ")}</dd></div>
          </dl>
          {invoice.pending.length ? <p className="mt-3 text-amber-900">Pending: {invoice.pending.map(pendingReference).join(", ")}. Verification is not a confirmed payment.</p> : null}
        </div>)}</div>
      </details>
      <details className="rounded-lg border p-3">
        <summary className="min-h-8 cursor-pointer text-sm font-medium">Candidate preview — not sent</summary>
        <p className="mt-2 text-xs text-gray-600">Exact proposed text when available. Consent, communication holds, provider restrictions and legal review must all permit sending; a preview grants no permission.</p>
        <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6">{messagePreview(item)}</pre>
      </details>
    </CardContent>
  </Card>;
}

function DailySummary({ preview }: { preview: Preview }) {
  return <Card><CardHeader><CardTitle>9 AM collection review · {preview.report_date}</CardTitle>
    <CardDescription>Malaysia reporting date. Company-wide source counts; opening this page does not create a run or an escalation.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm">{preview.summary.tenants} identified tenants reviewed · {preview.summary.groups ?? "Unavailable"} source groups · {preview.summary.unlinked_records ?? "Unavailable"} unlinked records (not counted as tenants) · {preview.summary.pending_verification} with payment verification pending</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{preview.summary.stages.map((stage) => <div key={stage.stage} className="rounded-lg border bg-white/70 p-3">
        <p className="text-sm font-medium">{label(stage.stage)}</p><p className="mt-2 text-lg font-semibold">{stage.tenants} identified tenants · {money(stage.amount)} collectible</p>
        <p className="mt-1 text-xs text-gray-600">Recorded balance: {money(stage.recorded_amount)} · {stage.groups ?? "Unavailable"} source groups · {stage.unlinked_records ?? "Unavailable"} unlinked records</p>
        <p className="mt-1 text-xs text-gray-600">{stage.partial_tenants} partly paid · {stage.send_eligible} send-eligible</p>
      </div>)}</div>
      {preview.summary.exceptions.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-medium">Company-wide exceptions · counts may overlap</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">{preview.summary.exceptions.map((exception) => <li key={exception.code}>{exceptionLabel(exception.code)}: {exception.tenants}</li>)}</ul>
      </div> : null}
      {preview.summary.delivery_blocks?.length ? <div className="rounded-lg border p-3 text-sm">
        <p className="font-medium">Communication follow-ups · separate from rental balance · reasons overlap</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">{preview.summary.delivery_blocks.map(block => <li key={block.code}>{exceptionLabel(block.code)}: {block.tenants} identified tenants · {block.unlinked_records} unlinked records</li>)}</ul>
      </div> : null}
    </CardContent></Card>;
}

function HistorySection({ history, params }: { history: History | null; params: Params }) {
  return <Card><CardHeader><CardTitle>Collection and delivery history</CardTitle>
    <CardDescription>Stored outcomes only. Provider acceptance does not prove delivery. Uncertain attempts must not be retried blindly.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
        <div><label htmlFor="history-day" className="mb-1 block text-sm font-medium">History date · Malaysia</label>
          <input id="history-day" name="day" type="date" defaultValue={params.day} className="min-h-11 rounded-md border bg-white px-3" /></div>
        <button type="submit" className={linkClass}>View history</button>
      </form>
      {!history ? <p className="text-sm text-amber-900">History is unavailable. The reviewed migration or collection configuration may not be installed. No data was changed.</p> : <>
        <p className="text-sm">New Day 7 reviews: {history.new_day_7_reviews} · New Day 14 reviews: {history.new_day_14_reviews}. These are internal reviews, not lockout or termination actions.</p>
        {!history.items.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-gray-600">No collection history for this date. A preview does not create delivery records.</p> : <div className="space-y-3">{history.items.map((entry) => <div key={entry.tenant_key} className="rounded-lg border p-3 text-sm">
          <p className="break-words font-medium">{entry.snapshot?.name || "Tenant record"} · {label(entry.stage)} · {money(entry.outstanding)}</p>
          <p className="mt-1 text-gray-600">Last checked: {timestamp(entry.last_checked_at)}</p>
          <p className="mt-1">Message status: {entry.delivery?.state === "accepted" ? "Provider accepted · delivery not confirmed" : entry.delivery?.state?.replaceAll("_", " ") || "Not attempted"}</p>
          {entry.delivery?.provider_message_id ? <p className="mt-1 break-all text-xs text-gray-600">Provider reference: {entry.delivery.provider_message_id}</p> : null}
          {entry.delivery?.error_code ? <p className="mt-1 text-amber-900">Delivery exception: {exceptionLabel(entry.delivery.error_code)}</p> : null}
        </div>)}</div>}
        {history.next_cursor ? <a className={linkClass} href={url(params, { historyAfter: history.next_cursor })}>Next 25 history records</a> : null}
      </>}
    </CardContent></Card>;
}

export default async function RentalRemindersPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireRole(["super_admin"], { module: "admin_setup", level: "manage" });
  if (!await reportAdministrator()) redirect("/");
  const raw = await searchParams;
  const params: Params = { after: safeCursor(raw.after), historyAfter: safeCursor(raw.historyAfter), day: safeDay(raw.day),
    stage: raw.stage && /^[a-z0-9_]{1,40}$/.test(raw.stage) ? raw.stage : undefined };
  const [previewResult, historyResult] = await Promise.allSettled([
    collectionPreview(new Date(), params.after, 25), collectionHistory(params.day, params.historyAfter, 25),
  ]);
  const preview = previewResult.status === "fulfilled" ? previewResult.value : null;
  const history = historyResult.status === "fulfilled" ? historyResult.value : null;
  const visible = preview?.items.filter((item) => !params.stage || item.stage === params.stage) ?? [];
  const pageStages = [...new Set(preview?.items.map((item) => item.stage) ?? [])];
  return <section className="space-y-6">
    <div><h1 className="text-2xl font-semibold sm:text-3xl">Rental Reminder Management</h1>
      <p className="mt-2 text-sm text-gray-600">Private, read-only collection review. This page never sends messages, changes balances or activates the schedule.</p>
      <div className="mt-3 flex flex-wrap gap-3"><a className={linkClass} href="/admin-setup">Admin setup</a><a className={linkClass} href="/admin-setup/management-report">Daily Management Report</a></div>
    </div>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      Day 7 is an internal account review. Day 14 is a formal termination review, not a termination notice or eviction. No physical access, utilities or tenancy dates may be changed by this reminder process.
    </div>
    {!preview ? <Card><CardHeader><CardTitle>Preview unavailable</CardTitle></CardHeader><CardContent>
      <p className="text-sm">Check the reviewed collection migration and company configuration. No sample figures are displayed and no messages have been sent.</p>
      <a className={`${linkClass} mt-3`} href={url(params)}>Retry read-only preview</a>
    </CardContent></Card> : <>
      <DailySummary preview={preview} />
      <div className="space-y-3"><div><h2 className="text-xl font-semibold">Tenant preview · up to 25 records</h2>
        <p className="mt-1 text-sm text-gray-600">Stage filters below apply only to this loaded page, not the company-wide summary.</p></div>
        <nav aria-label="Filter current preview page" className="flex flex-wrap gap-2"><a className={linkClass} aria-current={!params.stage ? "page" : undefined} href={url(params, { stage: undefined })}>All on this page</a>
          {pageStages.map((stage) => <a key={stage} className={linkClass} aria-current={params.stage === stage ? "page" : undefined} href={url(params, { stage })}>{label(stage)}</a>)}</nav>
        {!visible.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-gray-600">No matching records on this page. Clear the filter or continue to the next page.</p> : visible.map((item) => <TenantCard key={item.key} item={item} />)}
        <div className="flex flex-wrap gap-3">{params.after ? <a className={linkClass} href={url(params, { after: undefined, stage: undefined })}>First preview page</a> : null}
          {preview.next_cursor ? <a className={linkClass} href={url(params, { after: preview.next_cursor, stage: undefined })}>Next 25 tenant records</a> : null}</div>
      </div>
    </>}
    <HistorySection history={history} params={params} />
  </section>;
}

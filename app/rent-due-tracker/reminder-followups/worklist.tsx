import { reminderWorklist, type ReminderFollowupAccount, type ReminderQueue } from "@/lib/rental-collection/workflow";
import { collectionContactCategoryLabels } from "@/lib/rental-collection/failure-report";

const base = "/rent-due-tracker/reminder-followups";
const link = (queue: ReminderQueue, page = 1) => `${base}?${new URLSearchParams({queue, page: String(page)})}`;
const button = "inline-flex min-h-11 items-center rounded-lg border px-3 text-sm";

export function ReminderWorklist({accounts, queue, page}: {accounts: ReminderFollowupAccount[]; queue?: string; page?: string}) {
  const view = reminderWorklist(accounts, queue, page);
  return <section className="space-y-3" aria-labelledby="reminder-worklist-title">
    <h2 id="reminder-worklist-title" className="text-lg font-semibold">Rosley / Management action list</h2>
    <p className="text-sm text-gray-600">Only authorized company records. A tenant may appear in more than one queue. Consent/holds includes opt-outs and readiness holds—not proof that every tenant needs new consent. Payment/source includes identity and reconciliation exceptions—not a verified demand.</p>
    <nav aria-label="Reminder follow-up queues" className="flex flex-wrap gap-2">{view.counts.map(item => <a key={item.key} className={button} href={link(item.key)} aria-current={item.key === view.queue ? "page" : undefined}>{item.label} ({item.count})</a>)}</nav>
    <p className="text-sm">{view.total} accounts · page {view.page} of {view.pages} · up to 25 accounts per page</p>
    {!view.rows.length ? <p className="rounded-lg border border-dashed p-4 text-sm">No accounts in this queue. This is not approval to send reminders.</p> : <div className="grid gap-3 lg:grid-cols-2">{view.rows.map(row => <article className="min-w-0 space-y-2 rounded-lg border bg-white p-4 text-sm" key={row.key}>
      <h3 className="break-words font-semibold">{row.name}{row.tenant_id ? "" : " · account link needs review"}</h3>
      <p className="break-words">{row.propertyRooms.join(" · ") || "Property / room needs review"}</p>
      <p className="break-words">Registered login number: {row.loginPhone || "Missing or unusable — Admin verification required"}</p>
      <p>Verified collectible balance: {row.verifiedCollectibleBalance === null ? "Unavailable — reconcile source records" : `RM ${row.verifiedCollectibleBalance.toLocaleString("en-MY", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}</p>
      <p>{row.categories.map(category => collectionContactCategoryLabels[category]).join(" · ")}</p>
      <ul className="list-disc space-y-1 pl-5">{row.reasons.map(reason => <li className="break-words" key={reason}>{reason}</li>)}</ul>
      <p className="text-xs text-gray-600">Collect the actual evidence and give its reference/date to Admin. Do not change a login number, mark payment verified or assume WhatsApp consent from this list.</p>
    </article>)}</div>}
    <nav aria-label="Follow-up pages" className="flex flex-wrap gap-2">{view.page > 1 ? <a className={button} href={link(view.queue, view.page - 1)}>Previous 25</a> : null}{view.page < view.pages ? <a className={button} href={link(view.queue, view.page + 1)}>Next 25</a> : null}</nav>
  </section>;
}

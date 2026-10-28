import type { CollectionDigestStatus } from "@/lib/rental-collection/failure-service";

const states: Record<string, string> = {sending: "Reserved — outcome not confirmed", accepted: "Provider accepted — not proof of delivery",
  rejected: "Provider rejected — Admin follow-up required", uncertain: "Outcome uncertain — do not resend"};
const receipts: Record<string, string> = {unconfirmed: "No delivery confirmation", sent: "Sent — delivery not confirmed",
  delivered: "Delivery confirmed", read: "Read confirmed", failed: "Delivery failure confirmed", unknown: "Delivery outcome unknown",
  conflict: "Conflicting delivery evidence — review required"};
function Status({item}: {item: CollectionDigestStatus}) {
  return <p className="break-words text-sm">{item.report_date} · {states[item.state] ?? "Outcome needs review"} · {receipts[item.delivery_state] ?? "Delivery evidence unavailable"}</p>;
}
export function ReminderDigestStatus({available, current, alerts, alertCount}: {
  available: boolean; current: CollectionDigestStatus | null; alerts: CollectionDigestStatus[]; alertCount: number;
}) {
  return <section className="space-y-3 rounded-lg border bg-white p-4" aria-labelledby="digest-status-title">
    <h2 id="digest-status-title" className="text-lg font-semibold">Rosley daily report · delivery monitoring</h2>
    {!available ? <p role="status" className="text-sm text-amber-900">Delivery monitoring unavailable. Verify the reviewed migration and configuration; do not assume the report was delivered.</p> : <>
      {current ? <Status item={current} /> : <p className="text-sm">No report reserved today. This does not confirm that the schedule ran or that every account is clear.</p>}
      {alertCount > 0 ? <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
        <p className="font-medium">Admin action required: {alertCount} report delivery exceptions</p>
        <p className="text-sm">Rosley may not have received the follow-up list. Use the secure action list below and contact him through an approved channel. Do not automatically resend an uncertain report.</p>
        {alerts.slice(0, 25).map(item => <Status key={item.report_date} item={item} />)}
        {alertCount > alerts.length ? <p className="text-sm">Showing the latest {Math.min(alerts.length, 25)} of {alertCount}. Earlier exceptions remain recorded in the private audit history.</p> : null}
      </div> : <p className="text-sm">No recorded report-delivery alerts. Pending delivery is not confirmed delivery.</p>}
    </>}
    <p className="text-xs text-gray-600">After initial policy activation, this report runs automatically with the daily checks. No daily manual approval, extra alert message or resend is triggered by this page.</p>
  </section>;
}

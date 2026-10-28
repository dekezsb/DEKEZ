import { evidenceKinds, evidenceSources, type ReminderEvidence } from "@/lib/rental-collection/proposals";
import { ReminderEvidenceReview } from "./evidence-form";

export function ReminderEvidenceList({result, mayReview}: {result: {items: ReminderEvidence[]; next_cursor: string | null} | null; mayReview: boolean}) {
  return <section className="space-y-3 rounded-lg border bg-white p-4" aria-labelledby="pending-evidence-title">
    <h2 id="pending-evidence-title" className="text-lg font-semibold">Management evidence · pending review / history</h2>
    <p className="text-sm text-gray-600">Submitted evidence is not approved consent. Number corrections are proposals only. Only Super Admin can record a disposition; use existing Admin verification for consent or account changes. Nothing here sends a message.</p>
    {!result ? <p role="status" className="text-sm text-amber-900">Evidence review is unavailable until its reviewed migration is installed. Existing follow-ups remain available.</p>
      : !result.items.length ? <p className="text-sm">No evidence submissions on this page. Do not create evidence unless actually obtained.</p>
      : <div className="space-y-3">{result.items.map(item => <article key={item.id} className="min-w-0 space-y-2 rounded-lg border p-3 text-sm">
        <h3 className="break-words font-semibold">{item.tenant_name} · {evidenceKinds[item.kind]}</h3>
        <p>Status: {item.status.replaceAll("_", " ")} · observed {item.observed_on} · {evidenceSources[item.source]}</p>
        <p className="break-words">Login number at submission: {item.login_phone_snapshot || "Unavailable"}{item.proposed_phone ? ` · Proposed correction: ${item.proposed_phone} (not applied)` : ""}</p>
        <p className="break-words">Reference: {item.reference}</p><p className="whitespace-pre-wrap break-words">{item.notes}</p>
        <p className="break-words text-xs text-gray-600">Evidence ID: {item.id} · submitted {item.submitted_at} · staff account {item.actor}</p>
        {item.review ? <p className="break-words">Review: {item.review.reason} · {item.review.reviewed_at}</p> : null}
        {mayReview && item.status === "pending" ? <ReminderEvidenceReview proposal={item.id} /> : null}
      </article>)}</div>}
    {result?.next_cursor ? <a className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm" href={`/rent-due-tracker/reminder-followups?${new URLSearchParams({evidenceAfter: result.next_cursor})}`}>Older evidence (25)</a> : null}
  </section>;
}

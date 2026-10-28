"use client";
import { useActionState, useId, useState } from "react";
import { evidenceKinds, evidenceSources } from "@/lib/rental-collection/proposals";
import { submitReminderEvidence, reviewReminderEvidence, recordManagementStop } from "./evidence-actions";

const field = "mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2 text-sm";
export function ReminderEvidenceForm({tenant, request, today}: {tenant: string; request: string; today: string}) {
  const id = useId(), [kind, setKind] = useState("");
  const [state, action, pending] = useActionState(submitReminderEvidence, {ok: false, message: ""});
  return <details className="rounded-lg border p-3">
    <summary className="min-h-8 cursor-pointer font-medium">Record genuine evidence / propose a number correction</summary>
    <p className="mt-2 text-xs text-gray-600">Pending Super Admin review only. Record what the tenant actually confirmed, including their exact consent scope or refusal. Do not invent a response or send a WhatsApp message to obtain consent. For an urgent STOP, use the separate immediate STOP control; this evidence form does not change suppression. If that control is unavailable or fails, contact Admin immediately.</p>
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="tenant" value={tenant} /><input type="hidden" name="request" value={request} />
      <label className="block" htmlFor={`${id}-kind`}>Evidence type<select className={field} id={`${id}-kind`} name="kind" value={kind} onChange={event => setKind(event.target.value)} required>
        <option value="" disabled>Select actual evidence</option>{Object.entries(evidenceKinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <label className="block" htmlFor={`${id}-date`}>Actual confirmation date (Malaysia)<input className={field} id={`${id}-date`} type="date" name="observed_on" max={today} required /></label>
      <label className="block" htmlFor={`${id}-source`}>Evidence source<select className={field} id={`${id}-source`} name="source" defaultValue="" required>
        <option value="" disabled>Select source</option>{Object.entries(evidenceSources).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      {kind === "phone_correction" ? <label className="block" htmlFor={`${id}-phone`}>Proposed corrected number (not a login change)<input className={field} id={`${id}-phone`} name="proposed_phone" type="tel" maxLength={25} required autoComplete="off" /></label> : null}
      <label className="block" htmlFor={`${id}-reference`}>Evidence reference<input className={field} id={`${id}-reference`} name="reference" minLength={10} maxLength={500} required placeholder="Existing document or communication reference" /></label>
      <label className="block" htmlFor={`${id}-notes`}>Actual tenant response / factual notes<textarea className={field} id={`${id}-notes`} name="notes" minLength={10} maxLength={500} rows={3} required placeholder="What was confirmed, which number, and any actual consent scope or refusal. No passwords or bank details." /></label>
      <label className="flex min-h-11 items-start gap-3"><input className="mt-1" name="confirmed" value="yes" type="checkbox" required />This is genuine evidence I obtained, not assumed consent. Super Admin must verify it separately.</label>
      <button disabled={pending || state.ok} className="min-h-11 rounded-lg border px-4 font-medium disabled:opacity-50" type="submit">{pending ? "Saving pending evidence…" : "Submit for review"}</button>
      {state.message ? <p role="status" className={state.ok ? "text-emerald-800" : "text-red-800"}>{state.message}</p> : null}
    </form>
  </details>;
}

export function ManagementStopForm({tenant, recipient, today}: {tenant: string; recipient: string; today: string}) {
  const id = useId(), [state, action, pending] = useActionState(recordManagementStop, {ok: false, message: ""});
  return <details className="rounded-lg border border-red-200 p-3">
    <summary className="min-h-8 cursor-pointer font-medium">Record an actual STOP immediately</summary>
    <p className="mt-2 break-words text-xs text-gray-600">Registered number: {recipient}. Use only for an actual tenant withdrawal. This suppresses rental WhatsApp reminders now; it cannot grant consent, change the number or clear a restriction.</p>
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="tenant" value={tenant} /><input type="hidden" name="recipient" value={recipient} />
      <label className="block" htmlFor={`${id}-date`}>Actual STOP date (Malaysia)<input id={`${id}-date`} name="observed_on" className={field} type="date" max={today} required /></label>
      <label className="block" htmlFor={`${id}-source`}>STOP evidence source<select id={`${id}-source`} name="source" className={field} defaultValue="" required>
        <option value="" disabled>Select actual source</option>{Object.entries(evidenceSources).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label className="block" htmlFor={`${id}-reference`}>Evidence reference<input id={`${id}-reference`} name="reference" className={field} minLength={10} maxLength={500} required /></label>
      <label className="block" htmlFor={`${id}-notes`}>Actual STOP / withdrawal response<textarea id={`${id}-notes`} name="notes" className={field} minLength={10} maxLength={400} rows={2} required /></label>
      <label className="flex min-h-11 items-start gap-3"><input className="mt-1" name="confirmed_stop" value="yes" type="checkbox" required />The tenant actually withdrew permission for rental WhatsApp reminders to this exact number. I am recording their real STOP, not granting consent.</label>
      <button className="min-h-11 rounded-lg border border-red-300 px-4 font-medium text-red-900 disabled:opacity-50" disabled={pending || state.ok} type="submit">{pending ? "Recording STOP…" : "Record STOP / suppress reminders"}</button>
      {state.message ? <p role="status" className={state.ok ? "text-emerald-800" : "text-red-800"}>{state.message}</p> : null}
    </form>
  </details>;
}

export function ReminderEvidenceReview({proposal}: {proposal: string}) {
  const id = useId(), [state, action, pending] = useActionState(reviewReminderEvidence, {ok: false, message: ""});
  return <form action={action} className="mt-3 space-y-3">
    <input type="hidden" name="proposal" value={proposal} />
    <label className="block" htmlFor={`${id}-decision`}>Super Admin evidence disposition<select className={field} id={`${id}-decision`} name="decision" defaultValue="" required>
      <option value="" disabled>Select disposition</option><option value="reviewed">Reviewed evidence — separate approval still required</option><option value="needs_information">More information required</option><option value="rejected">Reject evidence</option>
    </select></label>
    <label className="block" htmlFor={`${id}-reason`}>Review reason<textarea id={`${id}-reason`} name="reason" className={field} minLength={10} maxLength={500} rows={2} required /></label>
    <label className="flex min-h-11 items-start gap-3"><input className="mt-1" type="checkbox" name="confirmed" value="yes" required />I reviewed the actual evidence. This disposition does not approve consent or change a login number.</label>
    <button className="min-h-11 rounded-lg border px-4 font-medium disabled:opacity-50" disabled={pending || state.ok} type="submit">Save evidence disposition</button>
    {state.message ? <p role="status" className={state.ok ? "text-emerald-800" : "text-red-800"}>{state.message}</p> : null}
  </form>;
}

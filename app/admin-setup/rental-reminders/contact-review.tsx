"use client";

import { useActionState, useId } from "react";
import { reviewReminderContact } from "./actions";

export function ContactReview({tenant, recipient, ownershipVerified}: {tenant: string; recipient: string; ownershipVerified: boolean}) {
  const [state, action, pending] = useActionState(reviewReminderContact, {ok: false, message: ""});
  const id = useId();
  const field = "mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2 text-sm";
  return <details className="rounded-lg border p-3">
    <summary className="min-h-8 cursor-pointer text-sm font-medium">Consent, opt-out and communication hold review</summary>
    <p className="mt-2 text-xs text-gray-600">Verify the intended person and this exact current Tenant Portal login number. Login access alone is not WhatsApp ownership or consent. Record a real evidence reference; do not assume permission from an unsigned agreement or a phone number.</p>
    <p className="mt-2 break-words text-sm"><strong>Current registered number:</strong> {recipient} · {ownershipVerified ? "Step 1: ownership verified; review explicit consent separately." : "Step 1: ownership evidence required before opt-in."}</p>
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="tenant" value={tenant} /><input type="hidden" name="recipient" value={recipient} />
      <div><label htmlFor={`${id}-action`} className="text-sm font-medium">Review action</label>
        <select id={`${id}-action`} name="action" required className={field} defaultValue="">
          <option value="" disabled>Select an evidence-backed action</option>
          <option value="verify_ownership">Verify WhatsApp number ownership</option>
          <option value="record_opt_in" disabled={!ownershipVerified}>Record explicit rental-reminder consent</option>
          <option value="record_opt_out">Record opt-out / STOP received elsewhere</option>
          <option value="set_dispute_hold">Hold disputed payment for Admin review</option>
          <option value="set_manual_hold">Hold all rental reminder communication</option>
          <option value="clear_hold">Clear a reviewed communication hold</option>
          <option value="review_resubscription">Review fresh consent after an opt-out</option>
        </select></div>
      <div><label htmlFor={`${id}-reference`} className="text-sm font-medium">Evidence reference</label>
        <input id={`${id}-reference`} name="reference" required minLength={10} maxLength={500} className={field} placeholder="Real evidence reference · original date/time · exact number" /></div>
      <div><label htmlFor={`${id}-reason`} className="text-sm font-medium">Review reason</label>
        <textarea id={`${id}-reason`} name="reason" required minLength={10} maxLength={500} rows={3} className={field} placeholder="Describe the actual identity check, consent statement and scope, or STOP request. Do not copy an assumed response." /></div>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1" name="confirmed" value="yes" type="checkbox" required />
        I reviewed the evidence for this person and number. Opt-in must explicitly cover DEKEZ rental payment reminders; a STOP cannot be overridden without fresh documented consent.</label>
      <button disabled={pending} type="submit" className="min-h-11 rounded-lg border px-4 text-sm font-medium disabled:opacity-50">{pending ? "Saving review…" : "Save reviewed evidence"}</button>
      {state.message ? <p role="status" className={`text-sm ${state.ok ? "text-emerald-800" : "text-red-800"}`}>{state.message}</p> : null}
      <p className="text-xs text-gray-600">This does not send messages, activate reminders, change a tenant login number or alter payment verification.</p>
    </form>
  </details>;
}

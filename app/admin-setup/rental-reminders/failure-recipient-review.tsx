"use client";
import { useActionState, useId } from "react";
import { reviewFailureRecipient } from "./actions";

export function FailureRecipientReview({profile}: {profile: string | null}) {
  const [state, action, pending] = useActionState(reviewFailureRecipient, {ok: false, message: ""});
  const id = useId(), field = "mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2 text-sm";
  if (!profile) return <p className="text-sm text-amber-900">No unique authorized management account is verified for 60188702371. Resolve the account scope through existing Admin controls; do not substitute another recipient.</p>;
  return <details className="rounded-lg border p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">Rosley · 60188702371 · recipient consent review</summary>
    <form action={action} className="mt-3 space-y-3"><input type="hidden" name="profile" value={profile} />
      <div><label htmlFor={`${id}-action`} className="text-sm">Action</label><select id={`${id}-action`} name="action" required defaultValue="" className={field}>
        <option value="" disabled>Select reviewed evidence</option><option value="verify_ownership">Verify ownership of 60188702371</option>
        <option value="record_opt_in">Record explicit daily follow-up report consent</option><option value="record_opt_out">Record opt-out</option></select></div>
      <div><label htmlFor={`${id}-reference`} className="text-sm">Evidence reference and date</label><input id={`${id}-reference`} name="reference" required minLength={10} maxLength={500} className={field} /></div>
      <div><label htmlFor={`${id}-reason`} className="text-sm">Reason</label><textarea id={`${id}-reason`} name="reason" required minLength={10} maxLength={500} rows={3} className={field} /></div>
      <label className="flex min-h-11 gap-3 text-sm"><input type="checkbox" name="confirmed" value="yes" required />I verified the intended management recipient and real evidence. I am not assuming WhatsApp ownership or consent from the account role.</label>
      <button type="submit" disabled={pending} className="min-h-11 rounded-lg border px-4 text-sm disabled:opacity-50">{pending ? "Saving…" : "Save recipient evidence"}</button>
      {state.message ? <p role="status" className="text-sm">{state.message}</p> : null}
      <p className="text-xs text-gray-600">Fixed recipient only. This does not send a report or enable automation.</p>
    </form></details>;
}

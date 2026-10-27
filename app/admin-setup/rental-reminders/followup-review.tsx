"use client";
import { useActionState, useId } from "react";
import { resolveReminderFollowup } from "./actions";

export function FollowupReview({attempts}: {attempts: {id: string; name: string; state: string}[]}) {
  const [state, action, pending] = useActionState(resolveReminderFollowup, {ok: false, message: ""});
  const id = useId(), field = "mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2 text-sm";
  if (!attempts.length) return null;
  return <details className="rounded-lg border p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">Record a completed delivery follow-up</summary>
    <form action={action} className="mt-3 space-y-3">
      <p className="text-sm">Use only after documented manual follow-up. This does not mark a message delivered, clear arrears, change consent or permit a resend. Changed delivery evidence will reopen review.</p>
      <div><label htmlFor={`${id}-attempt`} className="text-sm">Unresolved delivery attempt</label><select id={`${id}-attempt`} name="attempt" required defaultValue="" className={field}>
        <option value="" disabled>Select the reviewed attempt</option>{attempts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.state} · {item.id.slice(-8)}</option>)}</select></div>
      <div><label htmlFor={`${id}-reference`} className="text-sm">Evidence reference and date</label><input id={`${id}-reference`} name="reference" required minLength={10} maxLength={500} className={field} /></div>
      <div><label htmlFor={`${id}-reason`} className="text-sm">Follow-up outcome</label><textarea id={`${id}-reason`} name="reason" required minLength={10} maxLength={500} rows={3} className={field} /></div>
      <label className="flex min-h-11 gap-3 text-sm"><input type="checkbox" name="confirmed" value="yes" required />I reviewed the evidence and completed the manual follow-up. I am not overriding payment, consent or delivery facts.</label>
      <button type="submit" disabled={pending} className="min-h-11 rounded-lg border px-4 text-sm disabled:opacity-50">{pending ? "Saving…" : "Record reviewed follow-up"}</button>
      {state.message ? <p role="status" className="text-sm">{state.message}</p> : null}
    </form></details>;
}

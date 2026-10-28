"use client";

import { useActionState, useId } from "react";
import { callbackSetupAction } from "./actions";

export function CallbackSetupControl() {
  const [state, action, pending] = useActionState(callbackSetupAction, {state: "idle", message: ""});
  const id = useId();
  const finished = ["verified", "consumed_review_required"].includes(state.state);
  return <div className="space-y-4">
    <p className="text-sm">This temporary control can only add the DEKEZ rental STOP/delivery callback. It cannot send messages, enable reminders, approve consent or change login numbers.</p>
    <form action={action}>
      <input type="hidden" name="operation" value="preview" />
      <button disabled={pending || finished} className="min-h-11 rounded-lg border px-4 text-sm disabled:opacity-50">{pending ? "Checking…" : "Read channel settings and prepare preview"}</button>
    </form>
    <form action={action}>
      <input type="hidden" name="operation" value="verify" />
      <button disabled={pending} className="min-h-11 rounded-lg border px-4 text-sm disabled:opacity-50">Inspect consumed setup · read only</button>
    </form>
    {state.message ? <p role="status" className="break-words rounded-lg border p-3 text-sm">{state.message}</p> : null}
    {state.state === "preview" && state.ticket ? <form action={action} className="space-y-3">
      <p className="text-sm">Existing callbacks to preserve: {state.existingWebhookCount}. The confirmation expires within two minutes.</p>
      <input type="hidden" name="operation" value="execute" /><input type="hidden" name="ticket" value={state.ticket} />
      <label htmlFor={id} className="flex min-h-11 items-start gap-3 text-sm"><input id={id} type="checkbox" name="confirmed" value="yes" required className="mt-1" />
        I authorize this single settings operation. No other operator will change Whapi settings during this window. Tenant and Rosley sending must remain disabled.</label>
      <button disabled={pending} className="min-h-11 rounded-lg border px-4 text-sm font-medium disabled:opacity-50">{pending ? "Verifying setup…" : "Confirm one-time callback setup"}</button>
    </form> : null}
    <p className="text-xs text-gray-600">A timeout or interrupted update requires private review, not another click. The one-use permit cannot be reopened by this page. Remove this installer after setup; callback delivery still needs separate verification.</p>
  </div>;
}

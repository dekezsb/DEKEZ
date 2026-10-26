"use client";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { oneTimeTestAction, type OneTimeTestState } from "./actions";

const initialState: OneTimeTestState = { phase: "idle", message: "Requesting an authorization prepares a preview only. It does not send a WhatsApp message." };

function expiryLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "medium",
  }).format(new Date(value));
}

export function TestReportControl({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(oneTimeTestAction, initialState);
  const [confirmed, setConfirmed] = useState(false);
  const [expired, setExpired] = useState(false);
  const authorization = state.phase === "ready" ? state.authorization : undefined;

  useEffect(() => {
    setConfirmed(false);
    setExpired(false);
    if (!authorization) return;
    const remaining = new Date(authorization.expiresAt).getTime() - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [authorization]);

  return <div className="space-y-3">
    {state.phase === "idle" ? <form action={action}>
      <input type="hidden" name="intent" value="request" />
      <Button type="submit" disabled={!enabled || pending}>{pending ? "Preparing authorization…" : "Request one-time test"}</Button>
    </form> : null}

    {authorization ? <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-semibold">Review one authorized [TEST] report</h3>
      <p className="break-words text-sm">Recipient: <strong>{authorization.recipient}</strong> · Malaysia report date: {authorization.reportDate}</p>
      <p className="text-sm">Expires: {expiryLabel(authorization.expiresAt)} MYT. This authorization can be consumed only once.</p>
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-white p-3 font-sans text-sm leading-6">{authorization.body}</pre>
      <form action={action} className="space-y-3">
        <input type="hidden" name="intent" value="execute" />
        <input type="hidden" name="authorizationId" value={authorization.authorizationId} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" value="send-once" required checked={confirmed}
            onChange={event => setConfirmed(event.target.checked)} disabled={!enabled || pending || expired} className="mt-1 size-4 shrink-0" />
          <span>I authorize sending this exact [TEST] report once to {authorization.recipient}. I understand it cannot be recalled and uncertain delivery will not be retried.</span>
        </label>
        <Button type="submit" disabled={!enabled || pending || !confirmed || expired}>{pending ? "Processing authorization…" : "Send one [TEST] report"}</Button>
      </form>
      <form action={action}>
        <input type="hidden" name="intent" value="cancel" />
        <input type="hidden" name="authorizationId" value={authorization.authorizationId} />
        <Button type="submit" variant="outline" disabled={pending || expired}>Cancel authorization</Button>
      </form>
      {expired ? <p role="alert" className="text-sm text-red-700">Authorization expired. No further sending is permitted with this authorization.</p> : null}
    </div> : null}

    <p role="status" aria-live="polite" className="text-sm text-gray-600">{state.message}</p>
    <p className="text-sm text-gray-600">One test attempt per company, recipient and Malaysia date. Ordinary sending and test switches can remain disabled. This control never enables the daily schedule.</p>
    {!enabled ? <p className="text-sm text-gray-600">One-time testing requires complete server configuration, recipient 60168173911 and the daily schedule disabled.</p> : null}
  </div>;
}

"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { temporarySetupAction } from "./actions";
import type { SetupState } from "@/lib/management-report/temporary-whapi-setup";

const initial: SetupState = { phase: "idle", message: "Read-only preview first. This control never sends WhatsApp messages." };

export function TemporarySetupControl() {
  const [state, action, pending] = useActionState(temporarySetupAction, initial);
  return <form action={action} className="space-y-4">
    <p role="status" className="text-sm whitespace-pre-wrap">{state.message}</p>
    {state.expiresAt && <p className="text-sm">Setup expiry (UTC): {state.expiresAt}</p>}
    {typeof state.existingWebhooks === "number" && <p className="text-sm">Existing callbacks to preserve: {state.existingWebhooks}</p>}
    {state.ticket && <input type="hidden" name="ticket" value={state.ticket} />}
    {state.phase === "idle" && <Button name="intent" value="preview" disabled={pending}>Inspect channel and preview setup</Button>}
    {state.phase === "preview" && <>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="configure-callback-only" required disabled={pending} />
        <span>I confirm configuring only the authenticated DEKEZ reporting callback on FALCON-D9NS9, preserving existing settings. No WhatsApp message will be sent.</span></label>
      <Button name="intent" value="apply" disabled={pending}>Confirm authenticated webhook setup</Button>
    </>}
    {(state.phase === "uncertain" || state.phase === "verified") && <Button name="intent" value="verify" disabled={pending}>Verify settings only — no update</Button>}
    {pending && <p className="text-sm">Checking securely. Please do not submit again.</p>}
  </form>;
}

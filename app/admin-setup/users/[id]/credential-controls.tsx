"use client";

import {
  CheckCircle2,
  Copy,
  KeyRound,
  MessageCircle,
  RefreshCcw,
  WandSparkles,
} from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  manageUserCredentials,
  type CredentialActionState,
} from "../../actions";

const initialState: CredentialActionState = {
  status: "idle",
  message: "",
};

type CredentialControlsProps = {
  phone: string | null;
  profileId: string;
};

export function CredentialControls({
  phone,
  profileId,
}: CredentialControlsProps) {
  const [state, formAction, pending] = useActionState(
    manageUserCredentials,
    initialState,
  );
  const [copied, setCopied] = useState(false);

  async function copyTemporaryPassword() {
    if (!state.temporaryPassword) {
      return;
    }

    await navigator.clipboard.writeText(state.temporaryPassword);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-5 space-y-4 border-t border-[#e4e8ee] pt-5">
      <div>
        <h3 className="font-semibold text-gray-950">Password assistance</h3>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          Existing passwords cannot be viewed. Replace one with a temporary
          password, reset it to the phone PIN, or send a secure reset link by
          WhatsApp.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <input name="profileId" type="hidden" value={profileId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-800">
              New temporary password
            </span>
            <input
              autoComplete="new-password"
              className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] px-3 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
              minLength={8}
              name="password"
              placeholder="At least 8 characters"
              type="password"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-800">
              Confirm password
            </span>
            <input
              autoComplete="new-password"
              className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] px-3 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
              minLength={8}
              name="confirmPassword"
              placeholder="Repeat the password"
              type="password"
            />
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            disabled={pending}
            name="operation"
            type="submit"
            value="set_custom"
          >
            <KeyRound aria-hidden="true" className="h-4 w-4" />
            Set temporary password
          </Button>
          <Button
            disabled={pending}
            name="operation"
            type="submit"
            value="generate_temporary"
            variant="outline"
          >
            <WandSparkles aria-hidden="true" className="h-4 w-4" />
            Generate password
          </Button>
          <Button
            disabled={pending || !phone}
            name="operation"
            type="submit"
            value="phone_pin"
            variant="outline"
          >
            <RefreshCcw aria-hidden="true" className="h-4 w-4" />
            Use phone last 4 digits
          </Button>
          <Button
            disabled={pending || !phone}
            name="operation"
            type="submit"
            value="send_whatsapp_reset"
            variant="outline"
          >
            <MessageCircle aria-hidden="true" className="h-4 w-4" />
            Send reset link on WhatsApp
          </Button>
        </div>

        {phone ? (
          <p className="text-xs text-gray-500">
            WhatsApp destination: <span className="font-medium">{phone}</span>
          </p>
        ) : (
          <p className="text-xs font-medium text-red-600">
            Add a valid phone number before using phone PIN or WhatsApp reset.
          </p>
        )}
      </form>

      {state.message ? (
        <div
          className={
            state.status === "error"
              ? "rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700"
              : "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800"
          }
          role="status"
        >
          {state.message}
        </div>
      ) : null}

      {state.temporaryPassword ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold uppercase text-amber-800">
            Shown once
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-3 py-2 text-sm font-semibold text-gray-950">
              {state.temporaryPassword}
            </code>
            <Button
              aria-label="Copy temporary password"
              onClick={copyTemporaryPassword}
              size="icon"
              title="Copy temporary password"
              type="button"
              variant="outline"
            >
              {copied ? (
                <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Send this securely. DEKEZ will not store or show it again.
          </p>
        </div>
      ) : null}
    </div>
  );
}

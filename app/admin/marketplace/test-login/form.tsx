"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createPreviewLogin, type PreviewLoginState } from "./actions";

const initial: PreviewLoginState = { status: "idle", message: "" };
const input = "mt-2 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base";
export function PreviewLoginForm() {
  const [state, action, pending] = useActionState(createPreviewLogin, initial);
  return <form action={action} className="mt-6 space-y-5">
    <label className="block text-sm font-medium">Test phone number<input className={input} name="phone" type="tel" inputMode="tel" autoComplete="off" required disabled={pending || state.status === "success"} /></label>
    <label className="block text-sm font-medium">Temporary password<input className={input} name="password" type="password" autoComplete="new-password" minLength={5} maxLength={128} required disabled={pending || state.status === "success"} /></label>
    <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" name="confirm" value="yes" className="mt-1 size-5 shrink-0" required disabled={pending || state.status === "success"} /><span>Create a new restricted, read-only test account only. No Admin access, rental/financial records, subscriptions or live marketplace services.</span></label>
    {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`rounded-lg p-4 text-sm ${state.status === "success" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>{state.message}</p> : null}
    {state.status !== "success" ? <button disabled={pending} className="min-h-11 rounded-lg bg-[#94702f] px-5 py-3 font-semibold text-white disabled:opacity-50">{pending ? "Creating restricted login…" : "Create restricted test login"}</button> : <Link href="/login/contractor" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border px-5">Open Contractor Login</Link>}
  </form>;
}

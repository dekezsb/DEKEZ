"use server";

import { headers } from "next/headers";
import { executeCallbackSetup, inspectCallbackSetup, previewCallbackSetup, type SetupResult } from "@/lib/rental-collection/callback-setup";

export async function callbackSetupAction(_previous: SetupResult, form: FormData): Promise<SetupResult> {
  // Next's Server Action origin protection remains enabled; additionally accept
  // only the canonical production Admin page, never a preview or forwarded host.
  const requestHeaders = await headers();
  if (requestHeaders.get("origin") !== "https://dekez.vercel.app"
    || requestHeaders.get("sec-fetch-site") !== "same-origin") {
    return {state: "denied", message: "Open this control from the production Admin Portal."};
  }
  if (form.get("operation") === "preview") return previewCallbackSetup();
  if (form.get("operation") === "verify") return inspectCallbackSetup();
  const ticket = form.get("ticket");
  if (form.get("operation") !== "execute" || typeof ticket !== "string" || ticket.length > 2048) {
    return {state: "denied", message: "A fresh setup preview and explicit confirmation are required."};
  }
  return executeCallbackSetup(ticket, form.get("confirmed") === "yes");
}

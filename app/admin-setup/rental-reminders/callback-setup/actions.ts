"use server";

import { headers } from "next/headers";
import { diagnoseCallbackSetup, executeCallbackSetup, inspectCallbackSetup, previewCallbackSetup, type SetupResult } from "@/lib/rental-collection/callback-setup";

export async function callbackSetupAction(_previous: SetupResult, form: FormData): Promise<SetupResult> {
  // Next's Server Action origin protection remains enabled; additionally accept
  // only the canonical production Admin page, never a preview or forwarded host.
  const requestHeaders = await headers();
  if (requestHeaders.get("origin") !== "https://dekez.vercel.app"
    || requestHeaders.get("sec-fetch-site") !== "same-origin") {
    return {state: "denied", message: "Open this control from the production Admin Portal."};
  }
  if (form.get("operation") === "diagnose") {
    const result = await diagnoseCallbackSetup();
    // Diagnostic output consists exclusively of fixed codes, allowlisted field
    // names and a numeric status. Never render raw provider errors/settings.
    return {state: "diagnostic", message: `Read-only check: ${result.stage} / ${result.code}`
      + (result.field ? ` · Field: ${result.field}` : "")
      + (result.httpStatus !== undefined ? ` · HTTP ${result.httpStatus}` : "")
      + (result.callbackPresent !== undefined ? ` · Rental callback ${result.callbackPresent ? "present" : "not present"}.` : ".")
      + (result.settingsShape ? ` Settings shape (types only): root=${result.settingsShape.rootType}; `
        + result.settingsShape.fields.map(item => `${item.field}=${item.type}`
          + (item.finite !== undefined ? ` (finite=${item.finite}, in-range=${item.inRange})` : "")).join("; ")
        + `; unknown-root-fields=${result.settingsShape.unknownFieldsPresent}; unknown-media-fields=${result.settingsShape.unknownMediaFieldsPresent}.` : "")
      + (result.rentalCallbackComparison ? ` Saved rental callback comparison (fixed types, matches and hashes only): ${JSON.stringify(result.rentalCallbackComparison)}.` : "")
      + " No settings, messages or setup permits were changed. This does not verify actual provider callback delivery."};
  }
  if (form.get("operation") === "preview") return previewCallbackSetup();
  if (form.get("operation") === "verify") return inspectCallbackSetup();
  const ticket = form.get("ticket");
  if (form.get("operation") !== "execute" || typeof ticket !== "string" || ticket.length > 2048) {
    return {state: "denied", message: "A fresh setup preview and explicit confirmation are required."};
  }
  return executeCallbackSetup(ticket, form.get("confirmed") === "yes");
}

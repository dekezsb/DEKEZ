import { tenantReminderRecipient } from "./recipient";

export const evidenceKinds = {
  contact_confirmation: "Tenant / number confirmation",
  consent_evidence: "Tenant's actual consent response",
  phone_correction: "Proposed login-number correction",
} as const;
export const evidenceSources = {
  in_person: "In person", tenant_initiated_whatsapp: "Tenant-initiated WhatsApp",
  phone_call: "Phone call", document: "Existing document", other: "Other documented source",
} as const;
export type EvidenceKind = keyof typeof evidenceKinds;
export type EvidenceSource = keyof typeof evidenceSources;
export type EvidenceState = {ok: boolean; message: string};
export type ReminderEvidence = {
  id: string; tenant_id: string; tenant_name: string; actor: string; kind: EvidenceKind;
  observed_on: string; source: EvidenceSource; reference: string; notes: string;
  proposed_phone: string | null; login_phone_snapshot: string | null; submitted_at: string;
  status: "pending" | "reviewed" | "rejected" | "needs_information";
  review: {actor: string; reason: string; reviewed_at: string} | null;
};
export const evidenceUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const evidenceText = (value: string) => value.length >= 10 && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value);
export const evidenceToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
}).format(now);
export function evidenceObservedDate(value: string, now = new Date()) {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime())
    && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= evidenceToday(now);
}

export function parseReminderEvidence(form: FormData, now = new Date()) {
  const text = (name: string) => typeof form.get(name) === "string" ? String(form.get(name)).trim() : "";
  const tenant = text("tenant"), request = text("request"), kind = text("kind"), source = text("source");
  const observedOn = text("observed_on"), reference = text("reference"), notes = text("notes"), rawPhone = text("proposed_phone");
  if (!evidenceUuid(tenant) || !evidenceUuid(request) || !Object.hasOwn(evidenceKinds, kind)
    || !Object.hasOwn(evidenceSources, source) || !evidenceObservedDate(observedOn, now)
    || !evidenceText(reference) || !evidenceText(notes) || text("confirmed") !== "yes") return null;
  const proposedPhone = kind === "phone_correction" ? tenantReminderRecipient(rawPhone) : null;
  if (kind === "phone_correction" ? !proposedPhone : !!rawPhone) return null;
  return {tenant, request, kind: kind as EvidenceKind, source: source as EvidenceSource, observedOn, reference, notes, proposedPhone};
}

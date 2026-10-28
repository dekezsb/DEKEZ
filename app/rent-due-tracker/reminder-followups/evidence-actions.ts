"use server";

import { revalidatePath } from "next/cache";
import { reminderManager } from "@/lib/rental-collection/authorization";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { collectionConfig } from "@/lib/rental-collection/config";
import { collectionRpc } from "@/lib/rental-collection/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { evidenceObservedDate, evidenceSources, evidenceText, evidenceUuid, parseReminderEvidence, type EvidenceState } from "@/lib/rental-collection/proposals";
import { tenantReminderRecipient } from "@/lib/rental-collection/recipient";

// Withdrawal is effective immediately; it is never a pending opt-in proposal.
// Management has no parameter permitting opt-in, ownership or hold clearance.
export async function recordManagementStop(_previous: EvidenceState, form: FormData): Promise<EvidenceState> {
  const actor = await reminderManager(), config = collectionConfig();
  if (!actor || !config.scopeReady) return {ok: false, message: "You are not authorized to record a STOP for this company."};
  const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  const tenant = text("tenant"), recipient = text("recipient"), date = text("observed_on"), source = text("source");
  const reference = text("reference"), notes = text("notes");
  if (!evidenceUuid(tenant) || tenantReminderRecipient(recipient) !== recipient || !evidenceObservedDate(date)
    || !Object.hasOwn(evidenceSources, source) || !evidenceText(reference) || !evidenceText(notes) || notes.length > 400
    || text("confirmed_stop") !== "yes") return {ok: false, message: "Confirm the genuine STOP, exact registered number, actual date, source and evidence. Do not assume a STOP or opt-in."};
  try {
    const {data, error} = await collectionRpc(createAdminClient().rpc("dekez_collection_review_contact", {
      p_company: config.companyId, p_actor: actor, p_tenant: tenant, p_recipient: recipient,
      p_action: "record_opt_out", p_reference: reference, p_reason: `STOP received ${date} (${source}): ${notes}`,
    }));
    if (error || data?.state !== "reviewed" || data.consent !== "opted_out" || data.suppressed !== true) throw Error("not_recorded");
    revalidatePath("/rent-due-tracker/reminder-followups"); revalidatePath("/admin-setup/rental-reminders");
    return {ok: true, message: "STOP recorded: rental WhatsApp reminders to this number are suppressed. No message was sent, and no login or financial record was changed."};
  } catch {return {ok: false, message: "STOP could not be confirmed as recorded. Contact Admin immediately to verify the current tenant and exact number; do not treat this as consent or a successful opt-out."};}
}

export async function submitReminderEvidence(_previous: EvidenceState, form: FormData): Promise<EvidenceState> {
  const actor = await reminderManager(), config = collectionConfig();
  if (!actor || !config.scopeReady) return {ok: false, message: "You are not authorized to submit evidence for this company."};
  const value = parseReminderEvidence(form);
  if (!value) return {ok: false, message: "Check the actual date, source, reference, tenant response and confirmation. A corrected number is a proposal only."};
  try {
    const {data, error} = await collectionRpc(createAdminClient().rpc("dekez_collection_submit_evidence", {
      p_company: config.companyId, p_actor: actor, p_tenant: value.tenant, p_request: value.request,
      p_kind: value.kind, p_observed_on: value.observedOn, p_source: value.source,
      p_reference: value.reference, p_notes: value.notes, p_proposed_phone: value.proposedPhone,
    }));
    if (error || !["pending", "already_submitted"].includes(data?.state)) throw Error("not_saved");
    revalidatePath("/rent-due-tracker/reminder-followups");
    return {ok: true, message: "Evidence submitted for Super Admin review. No consent, login number, payment record or sending permission was changed."};
  } catch {return {ok: false, message: "Evidence could not be saved. Refresh the account and check your access. If the result is uncertain, retry this same submission without changing its fields."};}
}

export async function reviewReminderEvidence(_previous: EvidenceState, form: FormData): Promise<EvidenceState> {
  const actor = await reportAdministrator(), config = collectionConfig();
  if (!actor || !config.scopeReady) return {ok: false, message: "Only an authorized Super Admin can review pending evidence."};
  const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  const proposal = text("proposal"), decision = text("decision"), reason = text("reason");
  if (!evidenceUuid(proposal) || !["reviewed", "rejected", "needs_information"].includes(decision)
    || !evidenceText(reason) || text("confirmed") !== "yes") return {ok: false, message: "Select a disposition and record the actual review reason and confirmation."};
  try {
    const {data, error} = await collectionRpc(createAdminClient().rpc("dekez_collection_review_evidence", {
      p_company: config.companyId, p_actor: actor, p_proposal: proposal, p_decision: decision, p_reason: reason,
    }));
    if (error || !["reviewed", "already_reviewed"].includes(data?.state)) throw Error("not_saved");
    revalidatePath("/rent-due-tracker/reminder-followups");
    return {ok: true, message: "Evidence disposition recorded. Any consent approval or login correction still requires its separate existing Admin verification workflow."};
  } catch {return {ok: false, message: "Unable to record the disposition. Refresh and check the current tenant, login number, evidence and permissions."};}
}

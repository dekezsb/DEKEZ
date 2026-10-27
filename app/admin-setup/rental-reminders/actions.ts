"use server";

import { revalidatePath } from "next/cache";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectionConfig } from "@/lib/rental-collection/config";
import { tenantReminderRecipient } from "@/lib/rental-collection/recipient";

export type ContactReviewState = {ok: boolean; message: string};
const actions = new Set(["verify_ownership", "record_opt_in", "record_opt_out", "set_dispute_hold", "set_manual_hold", "clear_hold", "review_resubscription"]);

export async function reviewReminderContact(_previous: ContactReviewState, form: FormData): Promise<ContactReviewState> {
  // Never trust actor/company/approval from hidden fields or user metadata.
  const actor = await reportAdministrator();
  const config = collectionConfig();
  if (!actor || !config.scopeReady) return {ok: false, message: "You are not authorized to review these contact permissions."};
  const value = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  const tenant = value("tenant"), recipient = value("recipient"), action = value("action");
  const reference = value("reference"), reason = value("reason");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)
    || tenantReminderRecipient(recipient) !== recipient || !actions.has(action)
    || reference.length < 10 || reference.length > 500 || reason.length < 10 || reason.length > 500
    || /[\u0000-\u001f]/.test(reference + reason) || value("confirmed") !== "yes")
    return {ok: false, message: "Review the current login number, evidence reference, reason and confirmation before saving."};
  try {
    const {data, error} = await createAdminClient().rpc("dekez_collection_review_contact", {
      p_company: config.companyId, p_tenant: tenant, p_recipient: recipient, p_actor: actor,
      p_action: action, p_reference: reference, p_reason: reason,
    });
    if (error || !data || data.state !== "reviewed") return {ok: false, message: "The review could not be saved. Refresh the current record and verify your evidence and permissions."};
    revalidatePath("/admin-setup/rental-reminders");
    return {ok: true, message: "Contact review recorded with audit history. No message was sent, and no login or financial record was changed."};
  } catch { return {ok: false, message: "Unable to save the contact review. Please try again after checking the current record."}; }
}

export async function reviewFailureRecipient(_previous: ContactReviewState, form: FormData): Promise<ContactReviewState> {
  const actor = await reportAdministrator(), config = collectionConfig();
  if (!actor || !config.scopeReady) return {ok: false, message: "Only authorized administrators may review this recipient."};
  const value = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  const profile = value("profile"), action = value("action"), reference = value("reference"), reason = value("reason");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile)
    || !["verify_ownership", "record_opt_in", "record_opt_out"].includes(action)
    || reference.length < 10 || reference.length > 500 || reason.length < 10 || reason.length > 500
    || /[\u0000-\u001f]/.test(reference + reason) || value("confirmed") !== "yes")
    return {ok: false, message: "Select the approved management account and provide reviewed evidence and confirmation."};
  try {
    const {data, error} = await createAdminClient().rpc("dekez_collection_review_failure_recipient", {
      p_company: config.companyId, p_actor: actor, p_recipient_profile: profile, p_action: action, p_reference: reference, p_reason: reason,
    });
    if (error || !data || data.state !== "reviewed") return {ok: false, message: "Recipient review was not saved. Check the current account, number, permissions and evidence."};
    revalidatePath("/rent-due-tracker/reminder-followups");
    return {ok: true, message: "Management recipient evidence recorded. No report was sent and no sending switch was enabled."};
  } catch {return {ok: false, message: "Unable to save the recipient review. No report was sent."};}
}

export async function resolveReminderFollowup(_previous: ContactReviewState, form: FormData): Promise<ContactReviewState> {
  const actor = await reportAdministrator(), config = collectionConfig();
  if (!actor || !config.scopeReady) return {ok: false, message: "Only authorized administrators may resolve a reviewed follow-up."};
  const value = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  const attempt = value("attempt"), reference = value("reference"), reason = value("reason");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt)
    || reference.length < 10 || reference.length > 500 || reason.length < 10 || reason.length > 500
    || /[\u0000-\u001f]/.test(reference + reason) || value("confirmed") !== "yes")
    return {ok: false, message: "Provide the reviewed attempt, evidence reference, reason and confirmation."};
  try {
    const {data, error} = await createAdminClient().rpc("dekez_collection_resolve_followup", {
      p_company: config.companyId, p_actor: actor, p_attempt: attempt, p_reference: reference, p_reason: reason,
    });
    if (error || !data || !["resolved", "already_resolved"].includes(data.state))
      return {ok: false, message: "The follow-up was not resolved. Refresh the evidence and verify your permissions."};
    revalidatePath("/rent-due-tracker/reminder-followups");
    return {ok: true, message: "Reviewed follow-up recorded. Delivery facts, balances and consent are unchanged. No retry was enabled."};
  } catch {return {ok: false, message: "Unable to record this follow-up review. No message was sent."};}
}

import { normalizeInternationalPhone } from "@/lib/auth/phone";
import type { CollectionPreviewItem } from "./model";

// These are the management recipient and sender, never tenant destinations.
// This does not change the separate management-report recipient/command allowlist.
const protectedRecipients = new Set(["60198894911", "60168173911", "60188702371"]);

export function tenantReminderRecipient(loginPhone: string | null): string | null {
  const normalized = normalizeInternationalPhone(loginPhone ?? "")?.digits;
  if (!normalized || !/^[1-9][0-9]{8,14}$/.test(normalized)) return null;
  if (normalized.startsWith("60") && !/^601[0-9]{8,9}$/.test(normalized)) return null;
  return protectedRecipients.has(normalized) ? null : normalized;
}

// The login number is an address source, never proof of WhatsApp ownership or
// permission to contact. This is additional defense; database claims stay final.
export function collectionCommunicationHolds(item: CollectionPreviewItem): string[] {
  const policy = item.policy;
  const recipient = tenantReminderRecipient(item.phone);
  const holds = new Set(item.delivery_blocks ?? []);
  if (!recipient) holds.add("recipient_requires_review");
  if (item.recipient_source !== "tenant_portal_login") holds.add("login_recipient_unverified");
  if (item.whatsapp_ownership_verified !== true) holds.add("whatsapp_ownership_unverified");
  if (policy.consent === "opted_out") holds.add("opted_out");
  else if (policy.consent !== "opted_in") holds.add("consent_missing");
  if (!recipient || policy.approved_recipient !== recipient) holds.add("consent_number_mismatch");
  if (policy.hold !== "none") holds.add("communication_hold");
  if (!policy.enabled) holds.add("policy_disabled");
  if (!policy.compliance_approved) holds.add("compliance_not_approved");
  if (!policy.opt_out_ready) holds.add("opt_out_not_ready");
  if (item.pending_verification) holds.add("pending_verification");
  return [...holds];
}

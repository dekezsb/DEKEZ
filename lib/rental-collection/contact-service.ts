import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectionConfig } from "./config";
import { COLLECTION_CHANNEL, type CollectionEvent } from "./contact-events";

export function collectionIntakeConfig() {
  const config = collectionConfig();
  const secret = process.env.WHAPI_COLLECTION_WEBHOOK_SECRET ?? "";
  return {companyId: config.companyId, secret,
    ready: config.scopeReady && process.env.DEKEZ_COLLECTION_INTAKE_ENABLED === "true" && /^[A-Za-z0-9_-]{32,256}$/.test(secret)
      && ![process.env.WHAPI_REPORT_WEBHOOK_SECRET, process.env.CRON_SECRET, config.token].includes(secret)};
}

export async function recordCollectionEvent(event: CollectionEvent, deadline = Date.now() + 5_000) {
  const config = collectionIntakeConfig();
  if (!config.ready) throw new Error("Payment reminder intake is unavailable.");
  const remaining = Number.isFinite(deadline) ? Math.min(5_000, Math.floor(deadline - Date.now())) : 0;
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Payment reminder intake deadline reached.");
  const common = {p_company: config.companyId, p_channel: COLLECTION_CHANNEL, p_event_id: event.id,
    p_provider_message_id: event.messageId, p_recipient: event.recipient, p_occurred_at: event.occurredAt};
  try {
    const {error} = await createAdminClient().rpc(event.type === "contact"
      ? "dekez_collection_ingest_contact_event" : "dekez_collection_ingest_receipt",
      event.type === "contact" ? {...common, p_kind: event.kind} : {...common, p_status: event.status})
      .abortSignal(AbortSignal.timeout(remaining));
    if (error) throw new Error("not_recorded");
  } catch {throw new Error("Payment reminder event could not be recorded.");}
}

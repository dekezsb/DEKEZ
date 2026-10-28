import "server-only";
import { reminderManager } from "./authorization";
import { collectionConfig } from "./config";
import { collectionRpc } from "./service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReminderEvidence } from "./proposals";

export async function reminderEvidenceList(after: string | null = null): Promise<{items: ReminderEvidence[]; next_cursor: string | null} | null> {
  const actor = await reminderManager(), config = collectionConfig();
  if (!actor || !config.scopeReady) return null;
  if (after && !/^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]+\|[0-9a-f-]{36}$/i.test(after)) return null;
  try {
    const {data, error} = await collectionRpc(createAdminClient().rpc("dekez_collection_list_evidence", {
      p_company: config.companyId, p_actor: actor, p_after: after, p_limit: 25,
    }));
    return !error && data && Array.isArray(data.items) ? data : null;
  } catch {return null;}
}

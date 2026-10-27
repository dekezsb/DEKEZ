import "server-only";
import { getOptionalUserAccess } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectionConfig } from "./config";

// Existing Management permission only; no global Reports/Admin access granted.
export async function reminderManager() {
  const context = await getOptionalUserAccess(), config = collectionConfig();
  if (!context || !["super_admin", "admin"].includes(context.role) || !config.scopeReady
    || !hasModuleAccess(context.access, "rent_due_tracker", "manage")) return null;
  const {data, error} = await (await createClient()).auth.getUser();
  if (error || data.user?.id !== context.user.id) return null;
  const {error: permissionError} = await createAdminClient().rpc("dekez_collection_assert_admin", {
    p_company: config.companyId, p_actor: context.user.id,
  });
  return permissionError ? null : context.user.id;
}

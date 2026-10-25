import "server-only";
import { getOptionalUserAccess } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export async function reportAdministrator() {
  const context = await getOptionalUserAccess();
  if (!context || context.role !== "super_admin" || !hasModuleAccess(context.access, "admin_setup", "manage")) return null;
  const client = await createClient();
  // Refresh identity and profile for this sensitive operation; metadata alone
  // must not authorize a deleted, suspended or demoted administrator.
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || identity.user?.id !== context.user.id) return null;
  const { data: profile, error } = await client.from("profiles")
    .select("role, registration_status").eq("id", context.user.id).maybeSingle();
  return !error && profile?.role === "super_admin" && profile.registration_status === "approved" ? context.user.id : null;
}

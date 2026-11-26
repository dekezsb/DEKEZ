// No "server-only" marker: the proxy (middleware) imports this too. It only
// runs on the server because it needs the service-role client.
import { createAdminClient } from "@/lib/supabase/admin";
import {
  decideTenantLoginAccess,
  type TenancyAccessRow,
  type TenantLoginDecision,
} from "@/lib/auth/tenant-login-rules";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function tenanciesForProfile(
  admin: AdminClient,
  profileId: string,
) {
  const { data: tenants, error: tenantError } = await admin
    .from("tenants")
    .select("id")
    .eq("profile_id", profileId);
  if (tenantError) throw tenantError;
  const tenantIds = (tenants ?? []).map((tenant) => tenant.id as string);
  if (!tenantIds.length) return [] as TenancyAccessRow[];
  const { data, error } = await admin
    .from("tenancies")
    .select("status,checkout_date")
    .in("tenant_id", tenantIds);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    status: row.status == null ? null : String(row.status),
    checkout_date: (row.checkout_date as string | null) ?? null,
  }));
}

/**
 * Server-side guard (second layer behind the auth ban). Fails open on a
 * lookup error so a database hiccup never locks out every current tenant;
 * the ban set at checkout remains the primary control.
 */
export async function getTenantLoginDecision(input: {
  profileId: string;
  role: string | null | undefined;
  revokedMarker?: boolean;
  admin?: AdminClient;
}): Promise<TenantLoginDecision> {
  if (input.role !== "tenant") return "allowed";
  try {
    const admin = input.admin ?? createAdminClient();
    const tenancies = await tenanciesForProfile(admin, input.profileId);
    return decideTenantLoginAccess({
      role: input.role,
      tenancies,
      revokedMarker: input.revokedMarker,
    });
  } catch (error) {
    console.error("Tenant login access could not be checked.", {
      profileId: input.profileId,
      error,
    });
    return "allowed";
  }
}

export type { TenancyAccessRow };

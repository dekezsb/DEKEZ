import { redirect } from "next/navigation";
import type { JwtPayload, User } from "@supabase/supabase-js";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  hasModuleAccess,
  resolveUserAccess,
  type AccessLevel,
  type AccessModule,
  type UserAccess,
} from "./access";
import { normalizeRole, type AppRole } from "./roles";
import { getTenantLoginDecision } from "./tenant-login-lookup";

function verifiedUserFromClaims(claims: JwtPayload): User {
  return {
    id: claims.sub,
    app_metadata: claims.app_metadata ?? {},
    user_metadata: claims.user_metadata ?? {},
    aud: Array.isArray(claims.aud) ? claims.aud[0] : claims.aud,
    created_at: new Date(claims.iat * 1000).toISOString(),
    email: claims.email,
    phone: claims.phone,
    role: claims.role,
  } as User;
}

export async function resolveUserRole(user: User) {
  const metadataRole = normalizeRole(user.app_metadata?.role);

  let dataClient;
  try {
    dataClient = createAdminClient();
  } catch {
    dataClient = await createClient();
  }

  const { data: profile } = await dataClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return normalizeRole(profile?.role) ?? metadataRole ?? "tenant";
}

const loadUserAccess = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return null;
  }

  const user = verifiedUserFromClaims(data.claims);
  const role = await resolveUserRole(user);

  // Second layer behind the checkout ban: a tenant with no active or
  // upcoming tenancy is refused on every server page, action and API.
  if (role === "tenant") {
    const decision = await getTenantLoginDecision({
      profileId: user.id,
      role,
      revokedMarker: Boolean(user.user_metadata?.checkout_login_revoked_at),
    });
    if (decision === "tenancy_ended") {
      return { tenancyEnded: true as const };
    }
  }
  const access = await resolveUserModuleAccess(user, role);

  return { tenancyEnded: false as const, context: { access, role, user } };
});

/** Signed-in user, or null. A checked-out tenant counts as signed out. */
export const getOptionalUserAccess = cache(async () => {
  const loaded = await loadUserAccess();
  if (!loaded || loaded.tenancyEnded) return null;
  return loaded.context;
});

async function requireUserAccess() {
  const loaded = await loadUserAccess();
  if (!loaded) redirect("/");
  if (loaded.tenancyEnded) redirect("/tenancy-ended");
  return loaded.context;
}

export async function getCurrentUserRole() {
  const context = await requireUserAccess();
  return context.role;
}

export async function resolveUserModuleAccess(
  user: User,
  role: AppRole,
): Promise<UserAccess> {
  if (role === "super_admin") {
    return resolveUserAccess(role);
  }
  if (role === "client_owner" || role === "contractor_preview") return resolveUserAccess(role);

  let dataClient;
  try {
    dataClient = createAdminClient();
  } catch {
    dataClient = await createClient();
  }

  const { data } = await dataClient
    .from("user_module_permissions")
    .select("module_key, access_level")
    .eq("profile_id", user.id);

  return resolveUserAccess(role, data ?? []);
}

export async function getCurrentUserAccess() {
  return requireUserAccess();
}

export async function requireRole(
  allowedRoles: AppRole[],
  requirement?: {
    module: AccessModule;
    level?: Exclude<AccessLevel, "none">;
  },
) {
  const { access, role } = await getCurrentUserAccess();

  if (!allowedRoles.includes(role)) {
    if (role === "contractor_preview") redirect("/admin/marketplace/contractor-preview/dashboard");
    if (role === "client_owner") redirect("/owner/home");
    redirect(role === "technician" ? "/maintenance" : "/dashboard");
  }

  if (
    requirement &&
    !hasModuleAccess(
      access,
      requirement.module,
      requirement.level ?? "view",
    )
  ) {
    redirect("/dashboard?error=access_denied");
  }

  return role;
}

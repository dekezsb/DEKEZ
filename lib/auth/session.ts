import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
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

export async function resolveUserRole(user: User) {
  const metadataRole = normalizeRole(user.app_metadata?.role);

  if (metadataRole) {
    return metadataRole;
  }

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

  return normalizeRole(profile?.role) ?? "tenant";
}

export const getOptionalUserAccess = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const role = await resolveUserRole(user);
  const access = await resolveUserModuleAccess(user, role);

  return { access, role, user };
});

export async function getCurrentUserRole() {
  const context = await getOptionalUserAccess();

  if (!context) {
    redirect("/");
  }

  return context.role;
}

export async function resolveUserModuleAccess(
  user: User,
  role: AppRole,
): Promise<UserAccess> {
  if (role === "super_admin") {
    return resolveUserAccess(role);
  }

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
  const context = await getOptionalUserAccess();

  if (!context) {
    redirect("/");
  }

  return context;
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

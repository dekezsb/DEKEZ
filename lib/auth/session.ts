import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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

export async function getCurrentUserRole() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return resolveUserRole(user);
}

export async function requireRole(allowedRoles: AppRole[]) {
  const role = await getCurrentUserRole();

  if (!allowedRoles.includes(role)) {
    redirect(role === "technician" ? "/maintenance" : "/dashboard");
  }

  return role;
}

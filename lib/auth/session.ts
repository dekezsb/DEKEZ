import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeRole, type AppRole } from "./roles";

export async function getCurrentUserRole() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return normalizeRole(user.user_metadata?.role) ?? "tenant";
}

export async function requireRole(allowedRoles: AppRole[]) {
  const role = await getCurrentUserRole();

  if (!allowedRoles.includes(role)) {
    redirect(role === "technician" ? "/maintenance" : "/dashboard");
  }

  return role;
}

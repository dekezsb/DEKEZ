import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "./roles";

export type CurrentProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  global_role: AppRole;
};

export type CompanyMembership = {
  id: string;
  company_id: string;
  profile_id: string;
  role: AppRole;
  status: "active" | "inactive" | "invited";
  companies: {
    id: string;
    name: string;
    status: "active" | "inactive" | "suspended";
  } | null;
};

export async function getCurrentUserContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, phone, global_role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Unable to load user profile.");
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("company_users")
    .select("id, company_id, profile_id, role, status, companies(id, name, status)")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (membershipsError) {
    throw new Error("Unable to load company memberships.");
  }

  return {
    user,
    profile: profile as CurrentProfile,
    memberships: (memberships ?? []) as CompanyMembership[],
  };
}

export function isSuperAdmin(role: AppRole) {
  return role === "super_admin";
}

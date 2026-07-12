import { createClient } from "@/lib/supabase/server";
import {
  getCurrentUserContext,
  isSuperAdmin,
  type CompanyMembership,
} from "./session";

export type ManageableCompany = {
  id: string;
  name: string;
  status: "active" | "inactive" | "suspended";
};

const managerRoles = ["owner", "admin_team"] as const;

export async function getManageableCompanies() {
  const context = await getCurrentUserContext();

  if (isSuperAdmin(context.profile.global_role)) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, status")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error("Unable to load companies.");
    }

    return {
      ...context,
      companies: (data ?? []) as ManageableCompany[],
    };
  }

  return {
    ...context,
    companies: context.memberships
      .filter((membership) => canManageMembership(membership))
      .map((membership) => membership.companies)
      .filter((company): company is ManageableCompany => Boolean(company)),
  };
}

export async function assertCanManageCompany(companyId: string) {
  const context = await getManageableCompanies();
  const canManage = context.companies.some((company) => company.id === companyId);

  if (!canManage) {
    throw new Error("You do not have permission to manage this company.");
  }

  return context;
}

function canManageMembership(membership: CompanyMembership) {
  return (
    membership.status === "active" &&
    managerRoles.some((role) => role === membership.role)
  );
}

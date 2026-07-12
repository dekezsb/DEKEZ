"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserContext, isSuperAdmin } from "@/lib/auth/session";
import type { AppRole } from "@/lib/auth/roles";

const assignableRoles: AppRole[] = [
  "owner",
  "admin_team",
  "technician_team",
  "tenant",
];

export type ActionState = {
  ok: boolean;
  message: string;
};

export async function createCompanyAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user, profile } = await getCurrentUserContext();

  if (!isSuperAdmin(profile.global_role)) {
    return {
      ok: false,
      message: "Only Super Admin can create companies.",
    };
  }

  const name = String(formData.get("name") ?? "").trim();
  const registrationNumber = String(formData.get("registration_number") ?? "").trim();

  if (!name) {
    return {
      ok: false,
      message: "Company name is required.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("companies").insert({
    name,
    registration_number: registrationNumber || null,
    created_by: user.id,
  });

  if (error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings");

  return {
    ok: true,
    message: "Company created.",
  };
}

export async function createCompanyUserAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile, memberships } = await getCurrentUserContext();
  const companyId = String(formData.get("company_id") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;

  const canManageCompany =
    isSuperAdmin(profile.global_role) ||
    memberships.some(
      (membership) =>
        membership.company_id === companyId &&
        membership.role === "owner" &&
        membership.status === "active",
    );

  if (!canManageCompany) {
    return {
      ok: false,
      message: "Only Super Admin or company Owner can add users.",
    };
  }

  if (!companyId || !fullName || !email || !password || !assignableRoles.includes(role)) {
    return {
      ok: false,
      message: "Please complete all user fields.",
    };
  }

  if (password.length < 6) {
    return {
      ok: false,
      message: "Password must be at least 6 characters.",
    };
  }

  const admin = createAdminClient();
  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  });

  if (createUserError || !createdUser.user) {
    return {
      ok: false,
      message: createUserError?.message ?? "Unable to create user.",
    };
  }

  const userId = createdUser.user.id;

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    full_name: fullName,
    global_role: role,
  });

  if (profileError) {
    return {
      ok: false,
      message: profileError.message,
    };
  }

  const { error: membershipError } = await admin.from("company_users").upsert(
    {
      company_id: companyId,
      profile_id: userId,
      role,
      status: "active",
    },
    {
      onConflict: "company_id,profile_id",
    },
  );

  if (membershipError) {
    return {
      ok: false,
      message: membershipError.message,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings");

  return {
    ok: true,
    message: "User created and assigned to company.",
  };
}

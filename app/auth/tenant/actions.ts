"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type TenantSignupState = {
  ok: boolean;
  message: string;
};

export async function tenantSignupAction(
  _previousState: TenantSignupState,
  formData: FormData,
): Promise<TenantSignupState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const identityNumber = String(formData.get("identity_number") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!fullName || !email || !phone || !password || !confirmPassword) {
    return {
      ok: false,
      message: "Please complete all required fields.",
    };
  }

  if (password.length < 6) {
    return {
      ok: false,
      message: "Password must be at least 6 characters.",
    };
  }

  if (password !== confirmPassword) {
    return {
      ok: false,
      message: "Passwords do not match.",
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    phone,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      identity_number: identityNumber || null,
      signup_type: "tenant",
    },
  });

  if (error || !data.user) {
    return {
      ok: false,
      message: error?.message ?? "Unable to create tenant account.",
    };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    full_name: fullName,
    phone,
    global_role: "tenant",
  });

  if (profileError) {
    return {
      ok: false,
      message: profileError.message,
    };
  }

  return {
    ok: true,
    message: "Tenant account created. You can login now.",
  };
}

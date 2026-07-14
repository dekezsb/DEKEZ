"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createTenant(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"]);
  const [currentUser, company] = await Promise.all([getCurrentUser(), getFirstCompany()]);

  const fullName = textValue(formData, "fullName");
  const email = textValue(formData, "email").toLowerCase();
  const phone = textValue(formData, "phone");
  const password = textValue(formData, "password");

  if (!fullName || !email || !password) {
    redirect("/tenants?error=missing");
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    redirect("/tenants?error=service_key");
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: "tenant",
      full_name: fullName,
      phone,
    },
  });

  if (error || !data.user) {
    redirect(`/tenants?error=create&message=${encodeURIComponent(error?.message ?? "Unable to create tenant")}`);
  }

  await admin.from("profiles").upsert({
    id: data.user.id,
    full_name: fullName,
    phone: phone || null,
    role: "tenant",
  });

  if (company && currentUser) {
    await admin.from("company_users").upsert({
      company_id: company.id,
      user_id: data.user.id,
      role: "tenant",
      status: "active",
      created_by: currentUser.id,
    });
  }

  revalidatePath("/tenants");
  revalidatePath("/admin-setup");
  redirect("/tenants?created=1");
}

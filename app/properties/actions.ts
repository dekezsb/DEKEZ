"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createProperty(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"]);

  const user = await getCurrentUser();
  const company = await getFirstCompany();

  if (!user || !company) {
    redirect("/setup?error=missing");
  }

  const name = textValue(formData, "name");
  const address = textValue(formData, "address");
  const notes = textValue(formData, "notes");

  if (!name || !address) {
    redirect("/properties?error=missing");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("properties").insert({
    company_id: company.id,
    name,
    address,
    notes: notes || null,
    created_by: user.id,
  });

  if (error) {
    redirect("/properties?error=create");
  }

  revalidatePath("/properties");
  revalidatePath("/dashboard");
  redirect("/properties?created=1");
}

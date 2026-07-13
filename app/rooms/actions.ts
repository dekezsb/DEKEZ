"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

export async function createRoom(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"]);

  const user = await getCurrentUser();
  const properties = await getProperties();
  const propertyId = textValue(formData, "propertyId");
  const property = properties.find((item) => item.id === propertyId);

  if (!user || !property) {
    redirect("/rooms?error=property");
  }

  const name = textValue(formData, "name");
  const status = textValue(formData, "status") || "vacant";
  const monthlyRent = numberValue(formData, "monthlyRent");

  if (!name) {
    redirect("/rooms?error=missing");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("rooms").insert({
    company_id: property.company_id,
    property_id: property.id,
    name,
    status,
    monthly_rent: monthlyRent,
    created_by: user.id,
  });

  if (error) {
    redirect("/rooms?error=create");
  }

  revalidatePath("/rooms");
  revalidatePath("/dashboard");
  redirect("/rooms?created=1");
}

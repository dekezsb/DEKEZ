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
  const role = await requireRole(["super_admin", "owner", "admin"]);

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
  const { data: property, error } = await supabase
    .from("properties")
    .insert({
      company_id: company.id,
      name,
      address,
      notes: notes || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !property) {
    redirect("/properties?error=create");
  }

  if (role === "owner") {
    const { error: ownerError } = await supabase.rpc("set_property_owner", {
      target_owner_id: user.id,
      target_property_id: property.id,
    });

    if (ownerError) {
      redirect("/properties?created=1&error=owner_assign");
    }
  }

  revalidatePath("/properties");
  revalidatePath("/dashboard");
  redirect("/properties?created=1");
}

export async function updatePropertyOwner(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"]);

  const propertyId = textValue(formData, "propertyId");
  const ownerId = textValue(formData, "ownerId");

  if (!propertyId || !ownerId) {
    redirect("/properties?error=owner_missing");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_property_owner", {
    target_owner_id: ownerId,
    target_property_id: propertyId,
  });

  if (error) {
    redirect("/properties?error=owner_assign");
  }

  revalidatePath("/properties");
  revalidatePath("/dashboard");
  redirect("/properties?updated=owner");
}

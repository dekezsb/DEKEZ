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
  await requireRole(["super_admin", "admin"]);

  const user = await getCurrentUser();
  const company = await getFirstCompany();

  if (!user || !company) {
    redirect("/setup?error=missing");
  }

  const propertyCode = textValue(formData, "propertyCode");
  const area = textValue(formData, "area");
  const address = textValue(formData, "address");
  const ownerId = textValue(formData, "ownerId");
  const roomCount = Number(textValue(formData, "roomCount"));
  const isCommercial = formData.get("isCommercial") === "on";

  if (
    !propertyCode ||
    !area ||
    !address ||
    !Number.isInteger(roomCount) ||
    roomCount < 1 ||
    roomCount > 10000
  ) {
    redirect("/properties?error=missing");
  }

  const supabase = await createClient();
  const { data: propertyId, error } = await supabase.rpc(
    "create_property_with_rooms",
    {
      target_address: address,
      target_area: area,
      target_company_id: company.id,
      target_is_commercial: isCommercial,
      target_owner_id: ownerId || null,
      target_property_code: propertyCode,
      target_room_count: roomCount,
    },
  );

  if (error || !propertyId) {
    redirect("/properties?error=create");
  }

  revalidatePath("/properties");
  revalidatePath("/dashboard");
  redirect("/properties?created=1");
}

export async function updatePropertyOwner(formData: FormData) {
  await requireRole(["super_admin", "admin"]);

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

export async function updatePropertyCommercial(formData: FormData) {
  await requireRole(["super_admin", "admin"]);

  const propertyId = textValue(formData, "propertyId");
  const isCommercial = formData.get("isCommercial") === "on";
  if (!propertyId) {
    redirect("/properties?error=property");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({
      is_commercial: isCommercial,
      updated_at: new Date().toISOString(),
    })
    .eq("id", propertyId);

  if (error) {
    redirect("/properties?error=commercial");
  }

  revalidatePath("/properties");
  revalidatePath(`/properties/${propertyId}`);
  redirect("/properties?updated=commercial");
}

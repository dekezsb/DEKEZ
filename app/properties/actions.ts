"use server";

import { revalidatePath } from "next/cache";
import { assertCanManageCompany } from "@/lib/auth/companies";
import { createClient } from "@/lib/supabase/server";

export type PropertyActionState = {
  ok: boolean;
  message: string;
};

export async function createPropertyAction(
  _previousState: PropertyActionState,
  formData: FormData,
): Promise<PropertyActionState> {
  const companyId = String(formData.get("company_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();

  if (!companyId || !name) {
    return {
      ok: false,
      message: "Company and property name are required.",
    };
  }

  try {
    await assertCanManageCompany(companyId);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("properties").insert({
    company_id: companyId,
    name,
    property_type: propertyType || null,
    address: address || null,
    city: city || null,
    state: state || null,
    postcode: postcode || null,
  });

  if (error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/properties");
  revalidatePath("/rooms");

  return {
    ok: true,
    message: "Property created.",
  };
}

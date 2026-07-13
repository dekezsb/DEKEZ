"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

export async function createOwnerSetup(formData: FormData) {
  await requireRole(["owner", "super_admin"]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const companyName = textValue(formData, "companyName");
  const companyPhone = textValue(formData, "companyPhone");
  const companyEmail = textValue(formData, "companyEmail");
  const propertyName = textValue(formData, "propertyName");
  const propertyAddress = textValue(formData, "propertyAddress");
  const propertyNotes = textValue(formData, "propertyNotes");
  const firstRoomName = textValue(formData, "firstRoomName");
  const monthlyRent = numberValue(formData, "monthlyRent");

  if (!companyName || !propertyName || !propertyAddress || !firstRoomName) {
    redirect("/setup?error=missing");
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({
      name: companyName,
      phone: companyPhone || null,
      email: companyEmail || user.email,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (companyError || !company) {
    redirect("/setup?error=company");
  }

  const { error: membershipError } = await supabase.from("company_users").insert({
    company_id: company.id,
    user_id: user.id,
    role: "owner",
    status: "active",
    created_by: user.id,
  });

  if (membershipError) {
    redirect("/setup?error=membership");
  }

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .insert({
      company_id: company.id,
      name: propertyName,
      address: propertyAddress,
      notes: propertyNotes || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (propertyError || !property) {
    redirect("/setup?error=property");
  }

  const { error: roomError } = await supabase.from("rooms").insert({
    company_id: company.id,
    property_id: property.id,
    name: firstRoomName,
    status: "vacant",
    monthly_rent: monthlyRent,
    created_by: user.id,
  });

  if (roomError) {
    redirect("/setup?error=room");
  }

  redirect("/dashboard?setup=complete");
}

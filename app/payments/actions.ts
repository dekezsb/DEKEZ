"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

export async function createPayment(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"]);

  const user = await getCurrentUser();
  const tenantId = textValue(formData, "tenantId");
  const tenancyId = textValue(formData, "tenancyId");
  const category = textValue(formData, "category");
  const amount = numberValue(formData, "amount");
  const paymentDate = textValue(formData, "paymentDate") || new Date().toISOString().slice(0, 10);
  const paymentMethod = textValue(formData, "paymentMethod") || "cash";
  const referenceNumber = textValue(formData, "referenceNumber");
  const notes = textValue(formData, "notes");

  if (!user || !tenantId || !category || amount <= 0) {
    redirect("/payments?error=missing");
  }

  const supabase = await createClient();
  let tenancy:
    | {
        id: string;
        organization_id: string | null;
        property_id: string;
        unit_id: string | null;
        room_id: string;
      }
    | null = null;

  if (tenancyId) {
    const { data } = await supabase
      .from("tenancies")
      .select("id, organization_id, property_id, unit_id, room_id")
      .eq("id", tenancyId)
      .maybeSingle();
    tenancy = data;
  } else {
    const { data } = await supabase
      .from("tenancies")
      .select("id, organization_id, property_id, unit_id, room_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle();
    tenancy = data;
  }

  const { error } = await supabase.from("payments").insert({
    organization_id: tenancy?.organization_id ?? null,
    tenant_id: tenantId,
    tenancy_id: tenancy?.id ?? null,
    property_id: tenancy?.property_id ?? null,
    unit_id: tenancy?.unit_id ?? null,
    room_id: tenancy?.room_id ?? null,
    category,
    amount,
    payment_date: paymentDate,
    payment_method: paymentMethod,
    reference_number: referenceNumber || null,
    notes: notes || null,
    status: "confirmed",
    recorded_by: user.id,
  });

  if (error) {
    redirect("/payments?error=create");
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  redirect("/payments?created=1");
}

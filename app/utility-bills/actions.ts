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

export async function createUtilityBill(formData: FormData) {
  await requireRole(["super_admin", "admin", "owner"]);

  const user = await getCurrentUser();
  const roomId = textValue(formData, "roomId");
  const utilityType = textValue(formData, "utilityType");
  const billMonth = textValue(formData, "billMonth");
  const amount = numberValue(formData, "amount");
  const notes = textValue(formData, "notes");

  if (!user || !roomId || !utilityType || !billMonth || amount <= 0) {
    redirect("/utility-bills?error=missing");
  }

  const supabase = await createClient();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, property_id, unit_id, organization_id")
    .eq("id", roomId)
    .single();

  if (!room?.property_id) {
    redirect("/utility-bills?error=room");
  }

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("tenant_id")
    .eq("room_id", room.id)
    .eq("status", "active")
    .maybeSingle();

  const { error } = await supabase.from("utility_bills").insert({
    organization_id: room.organization_id ?? null,
    tenant_id: tenancy?.tenant_id ?? null,
    property_id: room.property_id,
    unit_id: room.unit_id ?? null,
    room_id: room.id,
    utility_type: utilityType,
    bill_month: `${billMonth}-01`,
    amount,
    paid_amount: 0,
    status: "unpaid",
    notes: notes || null,
    created_by: user.id,
  });

  if (error) {
    redirect("/utility-bills?error=create");
  }

  revalidatePath("/utility-bills");
  revalidatePath("/dashboard");
  redirect("/utility-bills?created=1");
}

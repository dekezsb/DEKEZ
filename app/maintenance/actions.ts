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

export async function createMaintenanceTicket(formData: FormData) {
  const role = await requireRole(["super_admin", "owner", "admin", "tenant"]);
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const supabase = await createClient();
  const ticketType = textValue(formData, "ticketType") || "maintenance";
  const category = textValue(formData, "category");
  const description = textValue(formData, "description");
  const urgency = textValue(formData, "urgency") || "normal";
  let tenantId = textValue(formData, "tenantId");
  let roomId = textValue(formData, "roomId");

  if (!description || !ticketType || !urgency) {
    redirect("/maintenance?error=missing");
  }

  if (role === "tenant") {
    tenantId = user.id;
    const { data: tenancy } = await supabase
      .from("tenancies")
      .select("tenant_id, room_id")
      .eq("tenant_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    roomId = tenancy?.room_id ?? "";
  }

  if (!tenantId || !roomId) {
    redirect("/maintenance?error=assignment");
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("id, property_id, unit_id, organization_id")
    .eq("id", roomId)
    .single();

  if (!room?.property_id) {
    redirect("/maintenance?error=room");
  }

  const { error } = await supabase.from("maintenance_tickets").insert({
    organization_id: room.organization_id ?? null,
    tenant_id: tenantId,
    property_id: room.property_id,
    unit_id: room.unit_id ?? null,
    room_id: room.id,
    ticket_type: ticketType,
    category: category || null,
    description,
    urgency,
    status: "submitted",
    created_by: user.id,
  });

  if (error) {
    redirect("/maintenance?error=create");
  }

  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
  redirect("/maintenance?created=1");
}

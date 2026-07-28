"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function claimPath(result: string) {
  return `/maintenance?${result}#claim-bills`;
}

export async function createMaintenanceTicket(formData: FormData) {
  const role = await requireRole(
    ["super_admin", "owner", "admin", "tenant"],
    {
      module: "maintenance",
      level: "manage",
    },
  );
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const supabase = await createClient();
  const ticketType = textValue(formData, "ticketType") || "maintenance";
  const category = textValue(formData, "category");
  const description = textValue(formData, "description");
  const urgency = textValue(formData, "urgency") || "normal";
  const photo = fileValue(formData, "photo");
  let tenantId = textValue(formData, "tenantId");
  let roomId = textValue(formData, "roomId");

  if (!description || !ticketType || !urgency) {
    redirect("/maintenance?error=missing");
  }

  if (
    photo &&
    (photo.size > 10 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(photo.type))
  ) {
    redirect("/maintenance?error=photo_type");
  }

  if (role === "tenant") {
    tenantId = user.id;
    const requestedRoomId = roomId;
    const { data: tenantRecords } = await supabase
      .from("tenants")
      .select("id")
      .eq("profile_id", user.id);
    const tenantIds = (tenantRecords ?? []).map((tenant) => tenant.id);
    const { data: tenancies } = tenantIds.length
      ? await supabase
          .from("tenancies")
          .select("tenant_id, room_id")
          .in("tenant_id", tenantIds)
          .eq("status", "active")
          .order("created_at", { ascending: false })
      : { data: [] };

    const tenancy =
      (tenancies ?? []).find(
        (candidate) => candidate.room_id === requestedRoomId,
      ) ??
      tenancies?.[0] ??
      null;
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

  const { data: ticket, error } = await supabase
    .from("maintenance_tickets")
    .insert({
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
    })
    .select("id")
    .single();

  if (error || !ticket) {
    redirect("/maintenance?error=create");
  }

  if (photo) {
    const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${user.id}/${ticket.id}/problem-${Date.now()}-${safeName}`;
    const bytes = Buffer.from(await photo.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from("maintenance-attachments")
      .upload(path, bytes, {
        contentType: photo.type,
        upsert: false,
      });

    if (uploadError) {
      redirect("/maintenance?error=photo_upload");
    }

    const { error: attachmentError } = await supabase
      .from("maintenance_attachments")
      .insert({
        ticket_id: ticket.id,
        uploaded_by: user.id,
        attachment_type: "problem",
        bucket_name: "maintenance-attachments",
        file_path: path,
        content_type: photo.type,
      });

    if (attachmentError) {
      await supabase.storage.from("maintenance-attachments").remove([path]);
      redirect("/maintenance?error=photo_upload");
    }
  }

  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
  redirect("/maintenance?created=1");
}

export async function createClaimBill(formData: FormData) {
  const role = await requireRole(
    [
      "super_admin",
      "admin",
      "technician",
      "maintenance_staff",
      "cleaning_staff",
    ],
    {
      module: "claims",
      level: "manage",
    },
  );
  const user = await getCurrentUser();
  if (!user) {
    redirect("/");
  }

  const description = textValue(formData, "description");
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const ticketId = textValue(formData, "ticketId");
  const fundingSource = textValue(formData, "fundingSource");
  const amount = Number(textValue(formData, "amount"));
  const receipt = fileValue(formData, "receipt");
  const canSubmitWithoutTicket = ["super_admin", "admin"].includes(role);

  if (
    !description ||
    !propertyId ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 999999999 ||
    !["company_cash", "staff_personal"].includes(fundingSource) ||
    (!canSubmitWithoutTicket && !ticketId)
  ) {
    redirect(claimPath("claim_error=missing"));
  }

  if (
    !receipt ||
    receipt.size > 10 * 1024 * 1024 ||
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ].includes(receipt.type)
  ) {
    redirect(claimPath("claim_error=receipt_type"));
  }

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id, company_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (!property) {
    redirect(claimPath("claim_error=property"));
  }

  if (roomId) {
    const { data: room } = await supabase
      .from("rooms")
      .select("id, property_id")
      .eq("id", roomId)
      .maybeSingle();
    if (!room || room.property_id !== property.id) {
      redirect(claimPath("claim_error=room"));
    }
  }

  if (ticketId) {
    const { data: ticket } = await supabase
      .from("maintenance_tickets")
      .select("id, property_id, room_id")
      .eq("id", ticketId)
      .maybeSingle();
    if (
      !ticket ||
      ticket.property_id !== property.id ||
      (roomId && ticket.room_id && ticket.room_id !== roomId)
    ) {
      redirect(claimPath("claim_error=ticket"));
    }
  }

  const admin = createAdminClient();
  const { data: ownership } = await admin
    .from("property_owners")
    .select("owner_id")
    .eq("property_id", property.id)
    .is("end_date", null)
    .order("ownership_percentage", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ownership?.owner_id) {
    redirect(claimPath("claim_error=owner"));
  }

  const { data: claim, error: claimError } = await supabase
    .from("claims")
    .insert({
      ticket_id: ticketId || null,
      property_id: property.id,
      room_id: roomId || null,
      owner_id: ownership.owner_id,
      submitted_by: user.id,
      labour_cost: 0,
      material_cost: amount,
      description,
      funding_source: fundingSource,
      status: "pending_owner_approval",
    })
    .select("id")
    .single();

  if (claimError || !claim) {
    redirect(claimPath("claim_error=create"));
  }

  const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${user.id}/${claim.id}/${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await receipt.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("claim-attachments")
    .upload(path, bytes, {
      contentType: receipt.type,
      upsert: false,
    });

  if (uploadError) {
    await admin.from("claims").delete().eq("id", claim.id);
    redirect(claimPath("claim_error=receipt_upload"));
  }

  const { error: attachmentError } = await supabase
    .from("claim_attachments")
    .insert({
      claim_id: claim.id,
      uploaded_by: user.id,
      bucket_name: "claim-attachments",
      file_path: path,
      content_type: receipt.type,
    });

  if (attachmentError) {
    await admin.storage.from("claim-attachments").remove([path]);
    await admin.from("claims").delete().eq("id", claim.id);
    redirect(claimPath("claim_error=receipt_upload"));
  }

  revalidatePath("/maintenance");
  revalidatePath("/verification");
  revalidatePath("/dashboard");
  redirect(claimPath("claim_submitted=1"));
}

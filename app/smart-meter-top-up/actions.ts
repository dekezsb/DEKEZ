"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { hasTenantElectricityTopUpAccess } from "@/lib/smart-meter/top-up-access";
import { createAdminClient } from "@/lib/supabase/admin";

const allowedSlipTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function topUpResult(result: string) {
  return `/dashboard?${result}`;
}

export async function submitSmartMeterTopUp(formData: FormData) {
  await requireRole(["tenant"], {
    module: "payments",
    level: "manage",
  });

  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");
  const amount = Number(textValue(formData, "amount"));
  const slip = fileValue(formData, "paymentSlip");

  if (
    !user ||
    !tenancyId ||
    !Number.isInteger(amount) ||
    amount < 10 ||
    amount > 500 ||
    !slip ||
    slip.size > 5 * 1024 * 1024 ||
    !allowedSlipTypes.has(slip.type)
  ) {
    redirect(topUpResult("topup_error=invalid"));
  }

  const supabase = createAdminClient();
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, tenant_id, property_id, room_id, status, billing_status")
    .eq("id", tenancyId)
    .maybeSingle();

  if (
    !tenancy ||
    tenancy.status !== "active" ||
    ["completed", "terminated"].includes(String(tenancy.billing_status))
  ) {
    redirect(topUpResult("topup_error=tenancy"));
  }

  const { data: property } = await supabase
    .from("properties")
    .select("property_code, name")
    .eq("id", tenancy.property_id)
    .maybeSingle();
  if (
    !hasTenantElectricityTopUpAccess(
      property?.property_code,
      property?.name,
    )
  ) {
    redirect(topUpResult("topup_error=access"));
  }

  const [{ data: tenant }, { data: existingRequest }] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("id, profile_id")
        .eq("id", tenancy.tenant_id)
        .eq("profile_id", user.id)
        .maybeSingle(),
      supabase
        .from("smart_meter_top_up_requests")
        .select("id")
        .eq("tenant_profile_id", user.id)
        .eq("room_id", tenancy.room_id)
        .in("status", [
          "pending_verification",
          "approved_awaiting_top_up",
        ])
        .limit(1)
        .maybeSingle(),
    ]);

  if (!tenant || existingRequest) {
    redirect(
      topUpResult(existingRequest ? "topup_error=pending" : "topup_error=access"),
    );
  }

  const { data: meter } = await supabase
    .from("smart_meters")
    .select("id")
    .eq("room_id", tenancy.room_id)
    .eq("meter_type", "electricity")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const safeName = slip.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${user.id}/${tenancy.room_id}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("smart-meter-top-up-slips")
    .upload(path, Buffer.from(await slip.arrayBuffer()), {
      contentType: slip.type,
      upsert: false,
    });

  if (uploadError) {
    redirect(topUpResult("topup_error=upload"));
  }

  const { error: createError } = await supabase
    .from("smart_meter_top_up_requests")
    .insert({
      property_id: tenancy.property_id,
      room_id: tenancy.room_id,
      tenancy_id: tenancy.id,
      tenant_record_id: tenant.id,
      tenant_profile_id: user.id,
      meter_id: meter?.id ?? null,
      amount,
      payment_slip_path: path,
      payment_slip_name: slip.name,
      payment_slip_type: slip.type,
      status: "pending_verification",
    });

  if (createError) {
    await supabase.storage.from("smart-meter-top-up-slips").remove([path]);
    redirect(topUpResult("topup_error=create"));
  }

  revalidatePath("/dashboard");
  revalidatePath("/verification");
  redirect(topUpResult("topup_submitted=1"));
}

/**
 * Staff-assisted version of submitSmartMeterTopUp: for tenants who can't (or
 * don't know how to) submit their own electricity top-up slip. Staff pick
 * the tenant's active tenancy, enter the amount, and attach a photo of the
 * bank-in slip on the tenant's behalf. It lands in the same
 * pending_verification queue as a tenant's own submission, so the normal
 * Verification review and meter-crediting steps still apply afterwards.
 */
export async function submitSmartMeterTopUpForTenant(formData: FormData) {
  await requireRole(
    ["super_admin", "admin", "technician", "maintenance_staff", "cleaning_staff"],
    {
      module: "claims",
      level: "manage",
    },
  );

  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");
  const amount = Number(textValue(formData, "amount"));
  const slip = fileValue(formData, "paymentSlip");

  if (
    !user ||
    !tenancyId ||
    !Number.isInteger(amount) ||
    amount < 10 ||
    amount > 500 ||
    !slip ||
    slip.size > 5 * 1024 * 1024 ||
    !allowedSlipTypes.has(slip.type)
  ) {
    redirect(topUpResult("topup_error=invalid"));
  }

  const supabase = createAdminClient();
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, tenant_id, property_id, room_id, status, billing_status")
    .eq("id", tenancyId)
    .maybeSingle();

  if (
    !tenancy ||
    tenancy.status !== "active" ||
    ["completed", "terminated"].includes(String(tenancy.billing_status))
  ) {
    redirect(topUpResult("topup_error=tenancy"));
  }

  const { data: property } = await supabase
    .from("properties")
    .select("property_code, name")
    .eq("id", tenancy.property_id)
    .maybeSingle();
  if (
    !hasTenantElectricityTopUpAccess(
      property?.property_code,
      property?.name,
    )
  ) {
    redirect(topUpResult("topup_error=access"));
  }

  const [{ data: tenant }, { data: existingRequest }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, profile_id")
      .eq("id", tenancy.tenant_id)
      .maybeSingle(),
    supabase
      .from("smart_meter_top_up_requests")
      .select("id")
      .eq("tenancy_id", tenancy.id)
      .in("status", ["pending_verification", "approved_awaiting_top_up"])
      .limit(1)
      .maybeSingle(),
  ]);

  if (!tenant || existingRequest) {
    redirect(
      topUpResult(existingRequest ? "topup_error=pending" : "topup_error=tenancy"),
    );
  }

  const { data: meter } = await supabase
    .from("smart_meters")
    .select("id")
    .eq("room_id", tenancy.room_id)
    .eq("meter_type", "electricity")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const safeName = slip.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${tenant.profile_id}/${tenancy.room_id}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("smart-meter-top-up-slips")
    .upload(path, Buffer.from(await slip.arrayBuffer()), {
      contentType: slip.type,
      upsert: false,
    });

  if (uploadError) {
    redirect(topUpResult("topup_error=upload"));
  }

  const { data: createdRequest, error: createError } = await supabase
    .from("smart_meter_top_up_requests")
    .insert({
      property_id: tenancy.property_id,
      room_id: tenancy.room_id,
      tenancy_id: tenancy.id,
      tenant_record_id: tenant.id,
      tenant_profile_id: tenant.profile_id,
      meter_id: meter?.id ?? null,
      amount,
      payment_slip_path: path,
      payment_slip_name: slip.name,
      payment_slip_type: slip.type,
      status: "pending_verification",
    })
    .select("id")
    .maybeSingle();

  if (createError || !createdRequest) {
    await supabase.storage.from("smart-meter-top-up-slips").remove([path]);
    redirect(topUpResult("topup_error=create"));
  }

  await supabase.from("audit_logs").insert({
    actor_profile_id: user.id,
    action: "staff_submitted_electricity_topup",
    entity_table: "smart_meter_top_up_requests",
    entity_id: createdRequest.id,
    metadata: {
      tenancy_id: tenancy.id,
      room_id: tenancy.room_id,
      tenant_profile_id: tenant.profile_id,
      amount,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/verification");
  redirect(topUpResult("topup_submitted=1"));
}

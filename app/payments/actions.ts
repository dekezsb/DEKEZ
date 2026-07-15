"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

export async function uploadMonthlyPaymentProof(formData: FormData) {
  await requireRole(["tenant"]);

  const user = await getCurrentUser();
  const rentBillId = textValue(formData, "rentBillId");
  const amount = numberValue(formData, "amount");
  const receipt = fileValue(formData, "receipt");

  if (!user || !rentBillId || amount <= 0 || !receipt) {
    redirect("/payments?error=proof_missing");
  }

  const supabase = await getAdmin();
  const { data: bill } = await supabase
    .from("rent_bills")
    .select("id, tenancy_id, tenant_id, property_id, unit_id, room_id, bill_month, amount")
    .eq("id", rentBillId)
    .eq("tenant_id", user.id)
    .maybeSingle();

  if (!bill) {
    redirect("/payments?error=proof_missing");
  }

  const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${user.id}/${bill.id}/monthly-rent-${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await receipt.arrayBuffer());
  const { error: uploadError } = await supabase.storage.from("payment-receipts").upload(path, bytes, {
    contentType: receipt.type || "application/octet-stream",
    upsert: true,
  });

  if (uploadError) {
    redirect("/payments?error=proof_upload");
  }

  const { data: submission, error } = await supabase
    .from("payment_submissions")
    .insert({
      tenant_id: user.id,
      tenancy_id: bill.tenancy_id,
      rent_bill_id: bill.id,
      property_id: bill.property_id,
      unit_id: bill.unit_id,
      room_id: bill.room_id,
      bill_month: bill.bill_month,
      bill_type: "monthly_rent",
      payment_type: "monthly_rent",
      amount,
      payment_date: textValue(formData, "paymentDate") || new Date().toISOString().slice(0, 10),
      payment_method: textValue(formData, "paymentMethod") || "bank_transfer",
      reference_number: textValue(formData, "referenceNumber") || null,
      receipt_url: path,
      verification_status: "pending_verification",
    })
    .select("id")
    .single();

  if (error || !submission) {
    redirect("/payments?error=proof_create");
  }

  await supabase.from("payment_attachments").insert({
    payment_submission_id: submission.id,
    tenant_id: user.id,
    file_path: path,
    file_name: receipt.name,
    content_type: receipt.type || null,
  });

  await supabase
    .from("rent_bills")
    .update({ status: "submitted", updated_at: new Date().toISOString() })
    .eq("id", bill.id);

  revalidatePath("/payments");
  revalidatePath("/payment-verification");
  redirect("/payments?proof=1");
}

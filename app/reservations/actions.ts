"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPaymentPurpose } from "@/lib/payments/payment-purpose";
import { supportsReservations } from "@/lib/tenancy/reservation-policy";
import { formFile, isValidTenantDocument } from "@/lib/tenant-documents";

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function context(form: FormData) {
  await requireRole(["super_admin", "admin"], { module: "properties", level: "manage" });
  const actor = await getCurrentUser();
  if (!actor) redirect("/");
  const db = createAdminClient();
  const { data: application, error } = await db.from("tenant_applications")
    .select("id, property_id, room_id, unit_id, tenant_id, status, registration_mode, verification_status, proposed_end_date")
    .eq("id", text(form, "applicationId")).single();
  const property = (await getProperties()).find((item) => item.id === application?.property_id);
  if (error || !application || !property || !supportsReservations(property.property_code)
    || application.registration_mode !== "reservation" || !["submitted", "pending_verification", "approved"].includes(application.status)) {
    redirect("/reservations?error=unavailable");
  }
  return { db, actor, application };
}

export async function addReservationPayment(form: FormData) {
  const { db, actor, application } = await context(form);
  const amount = Number(text(form, "amount"));
  const purpose = text(form, "paymentPurpose");
  const date = text(form, "paymentDate");
  const file = formFile(form, "receipt");
  const key = text(form, "submissionKey");
  if (!Number.isFinite(amount) || amount <= 0 || !isPaymentPurpose(purpose)
    || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !file || !isValidTenantDocument(file)
    || !/^[0-9a-f-]{36}$/i.test(key)) redirect("/reservations?error=payment");
  const { data: existing } = await db.from("payment_submissions").select("id").eq("submission_key", key).maybeSingle();
  if (existing) redirect("/reservations?saved=1");
  const path = `${actor.id}/${application.id}/${key}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const { error: uploadError } = await db.storage.from("payment-receipts").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (uploadError) redirect("/reservations?error=payment");
  const { data: payment, error } = await db.from("payment_submissions").insert({
    tenant_application_id: application.id, tenant_id: application.tenant_id,
    property_id: application.property_id, room_id: application.room_id, unit_id: application.unit_id,
    bill_type: "check_in", payment_type: purpose, amount, payment_date: date,
    payment_method: "bank_transfer", receipt_url: path, verification_status: "pending_verification",
    instalment: true, submission_key: key, payment_note: text(form, "paymentNote") || null,
    reference_number: text(form, "referenceNumber") || null,
  }).select("id").single();
  if (error || !payment) {
    await db.storage.from("payment-receipts").remove([path]);
    redirect("/reservations?error=payment");
  }
  const { error: attachmentError } = await db.from("payment_attachments").insert({
    payment_submission_id: payment.id, tenant_id: application.tenant_id,
    file_path: path, file_name: file.name, content_type: file.type,
  });
  if (attachmentError) {
    await db.from("payment_submissions").delete().eq("id", payment.id);
    await db.storage.from("payment-receipts").remove([path]);
    redirect("/reservations?error=payment");
  }
  await db.from("tenant_applications").update({ payment_status: "pending_verification", updated_at: new Date().toISOString() }).eq("id", application.id);
  revalidatePath("/reservations");
  revalidatePath("/verification");
  redirect("/reservations?saved=1");
}

export async function cancelReservation(form: FormData) {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });
  const { db, actor, application } = await context(form);
  const reason = text(form, "reason");
  if (!reason || text(form, "confirm") !== "1") redirect("/reservations?error=cancel");
  const { error } = await db.rpc("cancel_room_reservation", { p_application: application.id, p_actor: actor.id, p_reason: reason });
  if (error) redirect("/reservations?error=cancel");
  revalidatePath("/reservations"); revalidatePath("/properties"); revalidatePath("/register-tenant"); revalidatePath("/room-availability");
  redirect("/reservations?cancelled=1");
}

export async function requestReservationCheckIn(form: FormData) {
  const { db, actor, application } = await context(form);
  const date = text(form, "checkInDate");
  const end = text(form, "contractEnd");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (end && end < date)) redirect("/reservations?error=date");
  const { data, error } = await db.from("tenant_applications").update({
    registration_mode: "check_in", status: "submitted", verification_status: "pending_verification",
    proposed_start_date: date, proposed_end_date: end || null,
    reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString(),
  }).eq("id", application.id).eq("registration_mode", "reservation").select("id").maybeSingle();
  if (error || !data) redirect("/reservations?error=unavailable");
  await db.from("tenant_verifications").insert({ tenant_application_id: application.id,
    tenant_id: application.tenant_id, status: "pending_verification", reviewed_by: actor.id,
    notes: `Reservation check-in requested for ${date}. Main account approval required.` });
  revalidatePath("/reservations");
  revalidatePath("/verification");
  revalidatePath("/tenant-verification");
  redirect("/reservations?requested=1");
}

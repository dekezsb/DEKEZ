"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import {
  OTHER_PAYMENT_BILL_TYPE,
  OTHER_PAYMENT_FIELD_MESSAGES,
  OTHER_PAYMENT_MAX_FILE_BYTES,
  isAllowedSlipType,
  otherPaymentNote,
  validateOtherPaymentFields,
  type OtherPaymentType,
} from "@/lib/payments/other-payment";
import { inferUploadType } from "@/lib/registration/upload-files";
import { hasElectricityTopUpAccess } from "@/lib/smart-meter/top-up-access";
import { createAdminClient } from "@/lib/supabase/admin";

export type OtherPaymentResult = {
  ok: boolean;
  message: string;
  /** Machine-readable reason, used by tests and the form. */
  code?:
    | "saved"
    | "duplicate"
    | "fields"
    | "slip"
    | "tenancy"
    | "meter_top_up"
    | "upload"
    | "create";
};

type Db = ReturnType<typeof createAdminClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

type TenancyForOtherPayment = {
  id: string;
  tenant_id: string;
  property_id: string;
  unit_id: string | null;
  room_id: string;
  status: string;
  checkout_date: string | null;
};

type Submitter =
  | { kind: "tenant"; userId: string }
  | { kind: "staff"; userId: string; name: string | null };

async function meterTopUpFlowExists(db: Db, roomId: string) {
  const { data: meter } = await db
    .from("smart_meters")
    .select("id, provider")
    .eq("room_id", roomId)
    .eq("meter_type", "electricity")
    .eq("provider", "ttlock")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return hasElectricityTopUpAccess({
    provider: meter?.provider,
    hasElectricityMeter: Boolean(meter?.id),
  });
}

/**
 * Shared by the tenant portal and the management portal. The slip is saved as a
 * pending payment_submissions row with bill_type "other_payment". It has no
 * rent_bill_id and no tenancy_id until staff verify it, so it never counts as a
 * pending rent slip and never touches a rent invoice.
 */
async function recordOtherPayment(input: {
  db: Db;
  formData: FormData;
  tenancy: TenancyForOtherPayment;
  tenantProfileId: string | null;
  tenantRecordId: string | null;
  submitter: Submitter;
}): Promise<OtherPaymentResult> {
  const { db, formData, tenancy, submitter } = input;

  const parsed = validateOtherPaymentFields({
    type: textValue(formData, "paymentType"),
    amount: Number(textValue(formData, "amount")),
    paymentDate: textValue(formData, "paymentDate"),
    paymentMethod: textValue(formData, "paymentMethod"),
    referenceNumber: textValue(formData, "referenceNumber"),
    description: textValue(formData, "description"),
    note: textValue(formData, "note"),
  });
  if (!parsed.ok) {
    return {
      ok: false,
      code: "fields",
      message: OTHER_PAYMENT_FIELD_MESSAGES[parsed.error],
    };
  }
  const fields = parsed.value;

  if (fields.type === "top_up" && (await meterTopUpFlowExists(db, tenancy.room_id))) {
    return {
      ok: false,
      code: "meter_top_up",
      message:
        submitter.kind === "staff"
          ? "This room has a smart electricity meter. Use the electricity top-up request for that room so the meter is credited."
          : "This room has a smart electricity meter. Please use the Electricity Top-Up box on the Home page instead.",
    };
  }

  const file = fileValue(formData, "receipt");
  const slipType = file ? inferUploadType(file.name, file.type) : "";
  if (
    !file ||
    !isAllowedSlipType(slipType) ||
    file.size > OTHER_PAYMENT_MAX_FILE_BYTES
  ) {
    return {
      ok: false,
      code: "slip",
      message:
        "Attach the payment slip as a JPG, PNG, WebP or PDF under 3 MB.",
    };
  }

  const key = textValue(formData, "submissionKey");
  if (!UUID.test(key)) {
    return {
      ok: false,
      code: "fields",
      message: "Please reload the page and try again.",
    };
  }
  const { data: sameKey } = await db
    .from("payment_submissions")
    .select("id")
    .eq("submission_key", key)
    .maybeSingle();
  if (sameKey) {
    return {
      ok: true,
      code: "duplicate",
      message: "Already saved. Awaiting verification.",
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { data: sameSlip } = await db
    .from("payment_submissions")
    .select("id")
    .eq("receipt_sha256", hash)
    .neq("verification_status", "rejected")
    .limit(1)
    .maybeSingle();
  if (sameSlip) {
    return {
      ok: false,
      code: "duplicate",
      message:
        "This slip has already been submitted. Please do not upload the same slip twice.",
    };
  }

  const owner = input.tenantProfileId ?? input.tenantRecordId ?? tenancy.id;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${owner}/other-payments/${key}-${safeName}`;
  const { error: uploadError } = await db.storage
    .from("payment-receipts")
    .upload(path, bytes, { contentType: slipType, upsert: false });
  if (uploadError) {
    return {
      ok: false,
      code: "upload",
      message: "The slip could not be uploaded. Please try again.",
    };
  }

  const { data: submission, error } = await db
    .from("payment_submissions")
    .insert({
      tenant_id: input.tenantProfileId,
      tenant_record_id: input.tenantProfileId ? null : input.tenantRecordId,
      // Deliberately no rent_bill_id / tenancy_id / bill_month: see header.
      property_id: tenancy.property_id,
      unit_id: tenancy.unit_id,
      room_id: tenancy.room_id,
      bill_type: OTHER_PAYMENT_BILL_TYPE,
      payment_type: fields.type satisfies OtherPaymentType,
      amount: fields.amount,
      payment_date: fields.paymentDate,
      payment_method: fields.paymentMethod,
      reference_number: fields.referenceNumber,
      receipt_url: path,
      receipt_sha256: hash,
      submission_key: key,
      payment_note:
        otherPaymentNote({
          description: fields.description,
          note: fields.note,
          submittedByStaffName:
            submitter.kind === "staff"
              ? submitter.name ?? "staff"
              : null,
        }) || null,
      submitted_by_staff_id: submitter.kind === "staff" ? submitter.userId : null,
      verification_status: "pending_verification",
    })
    .select("id")
    .single();

  if (error || !submission) {
    await db.storage.from("payment-receipts").remove([path]);
    if (error?.code === "23505") {
      return { ok: true, code: "duplicate", message: "Already saved. Awaiting verification." };
    }
    return {
      ok: false,
      code: "create",
      message: "The payment could not be submitted. Please try again.",
    };
  }

  await db.from("payment_attachments").insert({
    payment_submission_id: submission.id,
    tenant_id: input.tenantProfileId,
    tenant_record_id: input.tenantProfileId ? null : input.tenantRecordId,
    file_path: path,
    file_name: file.name,
    content_type: slipType,
  });

  for (const target of [
    "/payment-verification",
    "/verification",
    "/payments",
    "/dashboard",
  ]) {
    revalidatePath(target);
  }

  return {
    ok: true,
    code: "saved",
    message:
      submitter.kind === "staff"
        ? "Saved. It is now waiting in Payment Verification."
        : "Submitted. Management will check your slip. Your payment shows as Pending until it is verified.",
  };
}

/** Tenant portal: a tenant submits an other payment for one of their own rooms. */
export async function submitOtherPayment(
  formData: FormData,
): Promise<OtherPaymentResult> {
  await requireRole(["tenant"], { module: "payments", level: "manage" });
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "tenancy", message: "Please sign in again." };
  }

  const db = createAdminClient();
  const { data: tenantRows } = await db
    .from("tenants")
    .select("id")
    .eq("profile_id", user.id);
  const tenantIds = (tenantRows ?? []).map((tenant) => tenant.id);
  if (!tenantIds.length) {
    return {
      ok: false,
      code: "tenancy",
      message: "No active room was found for your account.",
    };
  }

  const requestedTenancy = textValue(formData, "tenancyId");
  const { data: tenancies } = await db
    .from("tenancies")
    .select(
      "id, tenant_id, property_id, unit_id, room_id, status, billing_status, checkout_date",
    )
    .in("tenant_id", tenantIds)
    .eq("status", "active")
    .is("checkout_date", null);
  const usable = (tenancies ?? []).filter(
    (tenancy) =>
      !["completed", "terminated"].includes(String(tenancy.billing_status)),
  );
  const tenancy =
    usable.find((item) => item.id === requestedTenancy) ??
    (usable.length === 1 && !requestedTenancy ? usable[0] : null);
  if (!tenancy) {
    return {
      ok: false,
      code: "tenancy",
      message: "Choose which room this payment is for.",
    };
  }

  return recordOtherPayment({
    db,
    formData,
    tenancy,
    tenantProfileId: user.id,
    tenantRecordId: null,
    submitter: { kind: "tenant", userId: user.id },
  });
}

/**
 * Management portal: staff submit the same kind of payment on a tenant's
 * behalf, with the slip. It waits in Payment Verification exactly like a
 * tenant's own submission (the rent slip upload for staff behaves the same).
 */
export async function submitOtherPaymentForTenant(
  formData: FormData,
): Promise<OtherPaymentResult> {
  await requireRole(["super_admin", "admin"], {
    module: "payments",
    level: "manage",
  });
  const actor = await getCurrentUser();
  if (!actor) {
    return { ok: false, code: "tenancy", message: "Please sign in again." };
  }

  const tenancyId = textValue(formData, "tenancyId");
  if (!tenancyId) {
    return { ok: false, code: "tenancy", message: "Choose the tenant and room first." };
  }

  const db = createAdminClient();
  const { data: tenancy } = await db
    .from("tenancies")
    .select(
      "id, tenant_id, property_id, unit_id, room_id, status, checkout_date, tenants(profile_id)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  const accessible = (await getProperties()).some(
    (property) => property.id === tenancy?.property_id,
  );
  if (
    !tenancy ||
    !accessible ||
    tenancy.status !== "active" ||
    tenancy.checkout_date
  ) {
    return {
      ok: false,
      code: "tenancy",
      message: "That tenant has no active tenancy you can submit for.",
    };
  }

  const tenantRelation = Array.isArray(tenancy.tenants)
    ? tenancy.tenants[0]
    : tenancy.tenants;
  let tenantProfileId: string | null = tenantRelation?.profile_id ?? null;
  let tenantRecordId: string | null = null;
  if (!tenantProfileId) {
    const { data: record } = await db
      .from("tenant_records")
      .select("id")
      .eq("tenancy_id", tenancy.id)
      .limit(1)
      .maybeSingle();
    tenantRecordId = record?.id ?? null;
    if (!tenantRecordId) {
      return {
        ok: false,
        code: "tenancy",
        message:
          "This tenant has no portal account or tenant record yet, so the slip cannot be linked. Record it through Add Payment instead.",
      };
    }
  }

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", actor.id)
    .maybeSingle();

  return recordOtherPayment({
    db,
    formData,
    tenancy,
    tenantProfileId,
    tenantRecordId,
    submitter: {
      kind: "staff",
      userId: actor.id,
      name: profile?.full_name ?? null,
    },
  });
}

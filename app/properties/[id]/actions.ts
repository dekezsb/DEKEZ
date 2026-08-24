"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { activateTenantAccount } from "@/lib/auth/tenant-account";
import {
  dueDateForBillMonth,
  generateRecurringRentBills,
} from "@/lib/billing/rent-billing";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  reconcileSmartLockAccessForTenancy,
} from "@/lib/ttlock/access";
import {
  formFile,
  isValidTenantDocument,
  type TenantDocumentType,
  uploadTenantDocuments,
} from "@/lib/tenant-documents";
import { agreementTypeForProperty } from "@/lib/tenancy/agreement-types";
import { calculateTermEndDate } from "@/lib/e-tenancy";
import {
  FACILITY_OPTIONS,
  OPTIONAL_CLAUSES,
  PROPERTY_TYPES,
} from "@/lib/tenancy/property-settings";
import { executeTenantCheckout } from "@/lib/tenancy/checkout";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

function optionalNumberValue(formData: FormData, key: string) {
  const text = textValue(formData, key);
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

async function accessibleProperty(propertyId: string) {
  return (await getProperties()).find((property) => property.id === propertyId) ?? null;
}

function propertyPath(propertyId: string, suffix = "") {
  return `/properties/${propertyId}${suffix}`;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function ensureCanonicalTenancy(
  supabase: Awaited<ReturnType<typeof getAdmin>>,
  property: Awaited<ReturnType<typeof accessibleProperty>>,
  roomId: string,
  tenantRecordId: string,
  userId: string,
) {
  if (!property) {
    return null;
  }

  const [{ data: room }, { data: record }] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, unit_id, monthly_rent")
      .eq("id", roomId)
      .eq("property_id", property.id)
      .maybeSingle(),
    supabase
      .from("tenant_records")
      .select("id, tenant_id, tenancy_id, full_name, email, phone, identification_number, monthly_rent, deposit, due_day, contract_start, contract_end")
      .eq("id", tenantRecordId)
      .eq("property_id", property.id)
      .maybeSingle(),
  ]);

  if (!room || !record) {
    return null;
  }

  if (record.tenancy_id) {
    return record.tenancy_id;
  }

  let tenantId = record.tenant_id as string | null;
  if (!tenantId && record.identification_number) {
    const { data } = await supabase
      .from("tenants")
      .select("id")
      .eq("company_id", property.company_id)
      .eq("identity_number", record.identification_number)
      .maybeSingle();
    tenantId = data?.id ?? null;
  }
  if (!tenantId && record.phone) {
    const { data } = await supabase
      .from("tenants")
      .select("id")
      .eq("company_id", property.company_id)
      .eq("phone", record.phone)
      .maybeSingle();
    tenantId = data?.id ?? null;
  }
  if (!tenantId) {
    const { data: tenant, error } = await supabase
      .from("tenants")
      .insert({
        company_id: property.company_id,
        full_name: record.full_name,
        email: record.email,
        phone: record.phone,
        identity_number: record.identification_number,
        status: "active",
      })
      .select("id")
      .single();
    if (error || !tenant) {
      return null;
    }
    tenantId = tenant.id;
  }

  const startDate = record.contract_start ?? today();
  const dueDay = record.due_day ?? Number(startDate.slice(8, 10));
  const monthlyRent = Number(record.monthly_rent ?? room.monthly_rent ?? 0);
  const { data: tenancy, error: tenancyError } = await supabase
    .from("tenancies")
    .insert({
      company_id: property.company_id,
      tenant_id: tenantId,
      room_id: room.id,
      monthly_rent: monthlyRent,
      deposit: Number(record.deposit ?? 0),
      start_date: startDate,
      end_date: record.contract_end,
      due_day: dueDay,
      status: "active",
      property_id: property.id,
      unit_id: room.unit_id,
      monthly_rental: monthlyRent,
      contract_start: startDate,
      contract_end: record.contract_end,
      tenancy_start_date: startDate,
      tenancy_end_date: record.contract_end,
      rent_due_day: dueDay,
      check_in_date: startDate,
      billing_status: "active",
      created_by: userId,
    })
    .select("id")
    .single();

  if (tenancyError || !tenancy) {
    return null;
  }

  await Promise.all([
    supabase
      .from("tenant_records")
      .update({ tenant_id: tenantId, tenancy_id: tenancy.id })
      .eq("id", record.id),
    supabase
      .from("rooms")
      .update({ current_tenancy_id: tenancy.id, status: "occupied" })
      .eq("id", room.id),
    supabase
      .from("rent_bills")
      .update({ tenant_id: tenantId, tenancy_id: tenancy.id })
      .eq("tenant_record_id", record.id)
      .is("tenancy_id", null),
  ]);

  return tenancy.id;
}

export async function updateProperty(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const property = await accessibleProperty(propertyId);
  const name = textValue(formData, "name");
  const code = textValue(formData, "propertyCode");
  const area = textValue(formData, "area");
  const address = textValue(formData, "address");
  const targetRooms = Math.max(0, Math.floor(numberValue(formData, "totalRooms")));

  if (!user || !property || !name || !address) {
    redirect(propertyPath(propertyId, "?error=property"));
  }

  const supabase = await getAdmin();
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, unit_id, room_number, status")
    .eq("property_id", property.id);
  const currentRooms = rooms ?? [];

  if (targetRooms > currentRooms.length) {
    let unitId = currentRooms.find((room) => room.unit_id)?.unit_id;
    if (!unitId) {
      const { data: unit } = await supabase
        .from("units")
        .select("id")
        .eq("property_id", property.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      unitId = unit?.id;
    }
    if (!unitId) {
      redirect(propertyPath(property.id, "?error=room_structure"));
    }

    const usedNumbers = new Set(
      currentRooms
        .map((room) => Number(String(room.room_number ?? "").replace(/\D/g, "")))
        .filter((value) => Number.isFinite(value) && value > 0),
    );
    const additions = [];
    let candidate = 1;
    while (additions.length < targetRooms - currentRooms.length) {
      if (!usedNumbers.has(candidate)) {
        additions.push({
          company_id: property.company_id,
          property_id: property.id,
          unit_id: unitId,
          room_number: `Room ${candidate}`,
          name: `Room ${candidate}`,
          status: "vacant",
          monthly_rent: 0,
          created_by: user.id,
        });
      }
      candidate += 1;
    }
    const { error } = await supabase.from("rooms").insert(additions);
    if (error) {
      redirect(propertyPath(property.id, "?error=rooms_add"));
    }
  }

  if (targetRooms < currentRooms.length) {
    const removeCount = currentRooms.length - targetRooms;
    const vacant = currentRooms.filter((room) => room.status === "vacant");
    if (vacant.length < removeCount) {
      redirect(propertyPath(property.id, "?error=occupied_remove"));
    }
    const candidates = vacant
      .sort((a, b) => String(b.room_number).localeCompare(String(a.room_number), undefined, { numeric: true }))
      .slice(0, removeCount);
    const candidateIds = candidates.map((room) => room.id);
    const [tenantLinks, tenancyLinks, billLinks, paymentLinks] = await Promise.all([
      supabase.from("tenant_records").select("room_id").in("room_id", candidateIds),
      supabase.from("tenancies").select("room_id").in("room_id", candidateIds),
      supabase.from("rent_bills").select("room_id").in("room_id", candidateIds),
      supabase.from("payments").select("room_id").in("room_id", candidateIds),
    ]);
    const protectedIds = new Set(
      [tenantLinks.data, tenancyLinks.data, billLinks.data, paymentLinks.data]
        .flatMap((items) => items ?? [])
        .map((item) => item.room_id),
    );
    if (candidateIds.some((id) => protectedIds.has(id))) {
      redirect(propertyPath(property.id, "?error=room_history"));
    }
    const { error } = await supabase.from("rooms").delete().in("id", candidateIds).eq("status", "vacant");
    if (error) {
      redirect(propertyPath(property.id, "?error=rooms_remove"));
    }
  }

  const { error } = await supabase
    .from("properties")
    .update({
      name,
      property_code: code || null,
      area: area || null,
      address,
      updated_at: new Date().toISOString(),
    })
    .eq("id", property.id);

  if (error) {
    redirect(propertyPath(property.id, "?error=property"));
  }
  revalidatePath("/properties");
  revalidatePath(propertyPath(property.id));
  redirect(propertyPath(property.id, "?saved=property"));
}

export async function updatePropertyTenancySettings(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const property = await accessibleProperty(propertyId);
  if (!user || !property) {
    redirect("/properties");
  }

  const propertyType = textValue(formData, "propertyType");
  const defaultAgreementType = agreementTypeForProperty(
    property.is_commercial,
  );
  const waterMode = textValue(formData, "waterMode");
  const electricityMode = textValue(formData, "electricityMode");
  const airConditionerMode = textValue(formData, "airConditionerMode");
  const validPropertyTypes = new Set(PROPERTY_TYPES.map((item) => item.value));
  const validUtilityModes = new Set([
    "included",
    "tenant_pays",
    "smart_meter",
    "monthly_quota",
  ]);
  const validAirConditionerModes = new Set([
    "included",
    "smart_meter",
    "monthly_free_quota",
    "none",
  ]);

  if (
    !validPropertyTypes.has(
      propertyType as (typeof PROPERTY_TYPES)[number]["value"],
    ) ||
    !validUtilityModes.has(waterMode) ||
    !validUtilityModes.has(electricityMode) ||
    !validAirConditionerModes.has(airConditionerMode)
  ) {
    redirect(propertyPath(property.id, "?error=agreement_settings"));
  }

  const facilities = Object.fromEntries(
    FACILITY_OPTIONS.map((item) => [
      item.code,
      formData.get(`facility.${item.code}`) === "on",
    ]),
  );
  const optionalClauses = Object.fromEntries(
    OPTIONAL_CLAUSES.map((item) => [
      item.code,
      formData.get(`clause.${item.code}`) === "on",
    ]),
  );
  const names = formData.getAll("inventoryName");
  const quantities = formData.getAll("inventoryQuantity");
  const notes = formData.getAll("inventoryNotes");
  const inventory = names
    .map((value, index) => ({
      name: typeof value === "string" ? value.trim() : "",
      quantity: Math.max(
        1,
        Math.floor(
          Number(
            typeof quantities[index] === "string" ? quantities[index] : 1,
          ) || 1,
        ),
      ),
      notes:
        typeof notes[index] === "string" ? notes[index].trim() : "",
    }))
    .filter((item) => item.name);
  const quotaText = textValue(formData, "airConditionerFreeQuotaKwh");
  const quota = quotaText ? Number(quotaText) : null;
  const waterMonthlyQuota = optionalNumberValue(
    formData,
    "waterMonthlyQuota",
  );
  const waterRate = optionalNumberValue(formData, "waterRate");
  const electricityMonthlyQuota = optionalNumberValue(
    formData,
    "electricityMonthlyQuota",
  );
  const electricityRate = optionalNumberValue(formData, "electricityRate");
  const employeeLimit = optionalNumberValue(formData, "employeeLimit");
  const optionalValues = [
    waterMonthlyQuota,
    waterRate,
    electricityMonthlyQuota,
    electricityRate,
  ];
  if (
    (quota !== null && (!Number.isFinite(quota) || quota < 0)) ||
    optionalValues.some(
      (value) => value !== null && (!Number.isFinite(value) || value < 0),
    ) ||
    (employeeLimit !== null &&
      (!Number.isFinite(employeeLimit) || employeeLimit < 1))
  ) {
    redirect(propertyPath(property.id, "?error=agreement_settings"));
  }

  const supabase = await getAdmin();
  const { error } = await supabase.from("property_tenancy_settings").upsert(
    {
      property_id: property.id,
      default_agreement_type: defaultAgreementType,
      property_type: propertyType,
      facilities,
      water_mode: waterMode,
      electricity_mode: electricityMode,
      air_conditioner_mode: airConditionerMode,
      air_conditioner_free_quota_kwh:
        airConditionerMode === "monthly_free_quota" ? quota ?? 0 : null,
      water_monthly_quota:
        waterMode === "monthly_quota" ? waterMonthlyQuota : null,
      water_rate:
        ["smart_meter", "monthly_quota"].includes(waterMode)
          ? waterRate
          : null,
      electricity_monthly_quota:
        electricityMode === "monthly_quota"
          ? electricityMonthlyQuota
          : null,
      electricity_rate:
        ["smart_meter", "monthly_quota"].includes(electricityMode)
          ? electricityRate
          : null,
      employee_limit:
        defaultAgreementType === "commercial_office" &&
        employeeLimit !== null
          ? Math.floor(employeeLimit)
          : null,
      optional_clauses: optionalClauses,
      inventory,
      key_handover_notes: textValue(formData, "keyHandoverNotes") || null,
      created_by: user.id,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "property_id" },
  );

  if (error) {
    redirect(propertyPath(property.id, "?error=agreement_settings"));
  }

  revalidatePath(propertyPath(property.id));
  redirect(propertyPath(property.id, "?saved=agreement_settings"));
}

export async function updatePaymentQr(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const propertyId = textValue(formData, "propertyId");
  const property = await accessibleProperty(propertyId);
  if (!property) {
    redirect("/properties");
  }
  const qrUrl = textValue(formData, "paymentQrUrl");
  const supabase = await getAdmin();
  await supabase.from("properties").update({ payment_qr_url: qrUrl || null }).eq("id", property.id);
  revalidatePath(propertyPath(property.id));
  redirect(propertyPath(property.id, "?saved=qr"));
}

export async function updateRoomPaymentQr(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const property = await accessibleProperty(propertyId);
  const qrFile = formFile(formData, "paymentQr");
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

  if (
    !property ||
    !roomId ||
    !qrFile ||
    qrFile.size > 5 * 1024 * 1024 ||
    !allowedTypes.has(qrFile.type)
  ) {
    redirect(propertyPath(propertyId, "?error=qr_file"));
  }

  const supabase = await getAdmin();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, payment_qr_path")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();
  if (!room) {
    redirect(propertyPath(property.id, "?error=qr_room"));
  }

  const extension =
    qrFile.type === "image/png"
      ? "png"
      : qrFile.type === "image/webp"
        ? "webp"
        : "jpg";
  const filePath = `${property.company_id}/${property.id}/${room.id}/payment-qr.${extension}`;
  const bytes = Buffer.from(await qrFile.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("room-payment-qr")
    .upload(filePath, bytes, {
      contentType: qrFile.type,
      upsert: true,
    });
  if (uploadError) {
    redirect(propertyPath(property.id, "?error=qr_upload"));
  }

  const { error: saveError } = await supabase
    .from("rooms")
    .update({
      payment_qr_path: filePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id)
    .eq("property_id", property.id);
  if (saveError) {
    if (room.payment_qr_path !== filePath) {
      await supabase.storage.from("room-payment-qr").remove([filePath]);
    }
    redirect(propertyPath(property.id, "?error=qr_save"));
  }

  if (room.payment_qr_path && room.payment_qr_path !== filePath) {
    await supabase.storage.from("room-payment-qr").remove([room.payment_qr_path]);
  }

  revalidatePath(propertyPath(property.id));
  revalidatePath(propertyPath(property.id, `/rooms/${room.id}`));
  revalidatePath("/dashboard");
  redirect(propertyPath(property.id, "?saved=room_qr"));
}

export async function updateRoomField(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const field = textValue(formData, "field");
  const property = await accessibleProperty(propertyId);
  const supportedFields = [
    "monthlyRent",
    "deposit",
    "depositReceived",
    "dueDay",
    "contractDuration",
    "contractEnd",
  ];
  if (!user || !property || !roomId || !supportedFields.includes(field)) {
    return { ok: false, error: "This room field could not be saved." };
  }

  const tenantRecordId = textValue(formData, "tenantRecordId");
  let tenancyId = textValue(formData, "tenancyId");
  const supabase = await getAdmin();

  const { data: room } = await supabase
    .from("rooms")
    .select("id, status")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();
  if (!room) {
    return { ok: false, error: "Room not found." };
  }

  if (field === "monthlyRent") {
    const monthlyRent = Math.max(0, numberValue(formData, "value"));
    const updates = [
      supabase
        .from("rooms")
        .update({ monthly_rent: monthlyRent })
        .eq("id", roomId)
        .eq("property_id", property.id),
    ];

    if (tenantRecordId) {
      updates.push(
        supabase
          .from("tenant_records")
          .update({ monthly_rent: monthlyRent })
          .eq("id", tenantRecordId)
          .eq("room_id", roomId)
          .eq("property_id", property.id),
      );
    }
    if (tenancyId) {
      updates.push(
        supabase
          .from("tenancies")
          .update({ monthly_rent: monthlyRent, monthly_rental: monthlyRent })
          .eq("id", tenancyId)
          .eq("room_id", roomId)
          .eq("property_id", property.id),
      );
    }

    const updateResults = await Promise.all(updates);
    if (updateResults.some((result) => result.error)) {
      return { ok: false, error: "Monthly rent could not be saved." };
    }

    let billQuery = supabase
      .from("rent_bills")
      .select("id, paid_amount, referral_credit_amount")
      .eq("room_id", roomId)
      .gte("bill_month", `${today().slice(0, 7)}-01`)
      .in("status", ["draft", "unpaid", "partial", "submitted", "pending_verification", "rejected", "overdue"]);
    if (tenancyId) {
      billQuery = billQuery.eq("tenancy_id", tenancyId);
    } else if (tenantRecordId) {
      billQuery = billQuery.eq("tenant_record_id", tenantRecordId);
    }
    const { data: bills } = await billQuery;
    for (const bill of bills ?? []) {
      await supabase
        .from("rent_bills")
        .update({
          gross_rent_amount: monthlyRent,
          amount: Math.max(
            monthlyRent - Number(bill.referral_credit_amount ?? 0),
            Number(bill.paid_amount ?? 0),
          ),
        })
        .eq("id", bill.id);
    }
  }

  if (field === "dueDay") {
    const dueDay = Math.min(31, Math.max(1, Math.floor(numberValue(formData, "value"))));
    const updates = [];
    if (tenantRecordId) {
      updates.push(
        supabase
          .from("tenant_records")
          .update({ due_day: dueDay })
          .eq("id", tenantRecordId)
          .eq("room_id", roomId)
          .eq("property_id", property.id),
      );
    }
    if (tenancyId) {
      updates.push(
        supabase
          .from("tenancies")
          .update({ due_day: dueDay, rent_due_day: dueDay })
          .eq("id", tenancyId)
          .eq("room_id", roomId)
          .eq("property_id", property.id),
      );
    }
    if (!updates.length) {
      return { ok: false, error: "This room has no active tenant assignment." };
    }
    const updateResults = await Promise.all(updates);
    if (updateResults.some((result) => result.error)) {
      return { ok: false, error: "Rent due day could not be saved." };
    }

    let billQuery = supabase
      .from("rent_bills")
      .select("id, bill_month")
      .eq("room_id", roomId)
      .gte("bill_month", `${today().slice(0, 7)}-01`)
      .in("status", ["draft", "unpaid", "partial", "submitted", "pending_verification", "rejected", "overdue"]);
    if (tenancyId) {
      billQuery = billQuery.eq("tenancy_id", tenancyId);
    } else if (tenantRecordId) {
      billQuery = billQuery.eq("tenant_record_id", tenantRecordId);
    }
    const { data: bills } = await billQuery;
    for (const bill of bills ?? []) {
      await supabase
        .from("rent_bills")
        .update({ due_date: dueDateForBillMonth(bill.bill_month, dueDay) })
        .eq("id", bill.id);
    }
  }

  if (field === "deposit") {
    const deposit = Math.max(0, numberValue(formData, "value"));
    const updates = [];
    if (tenantRecordId) {
      updates.push(
        supabase
          .from("tenant_records")
          .update({ deposit })
          .eq("id", tenantRecordId)
          .eq("room_id", roomId)
          .eq("property_id", property.id),
      );
    }
    if (tenancyId) {
      updates.push(
        supabase
          .from("tenancies")
          .update({ deposit })
          .eq("id", tenancyId)
          .eq("room_id", roomId)
          .eq("property_id", property.id),
      );
    }
    if (!updates.length) {
      return { ok: false, error: "This room has no active tenant assignment." };
    }
    const updateResults = await Promise.all(updates);
    if (updateResults.some((result) => result.error)) {
      return { ok: false, error: "Deposit could not be saved." };
    }
  }

  if (field === "contractEnd") {
    const contractEnd = textValue(formData, "value") || null;
    if (contractEnd && !/^\d{4}-\d{2}-\d{2}$/.test(contractEnd)) {
      return { ok: false, error: "Contract end date is invalid." };
    }
    const updates = [];
    if (tenantRecordId) {
      updates.push(
        supabase
          .from("tenant_records")
          .update({ contract_end: contractEnd })
          .eq("id", tenantRecordId)
          .eq("room_id", roomId)
          .eq("property_id", property.id),
      );
    }
    if (tenancyId) {
      updates.push(
        supabase
          .from("tenancies")
          .update({
            end_date: contractEnd,
            contract_end: contractEnd,
            tenancy_end_date: contractEnd,
          })
          .eq("id", tenancyId)
          .eq("room_id", roomId)
          .eq("property_id", property.id),
      );
    }
    if (!updates.length) {
      return { ok: false, error: "This room has no active tenant assignment." };
    }
    const updateResults = await Promise.all(updates);
    if (updateResults.some((result) => result.error)) {
      return { ok: false, error: "Contract end date could not be saved." };
    }
  }

  if (field === "contractDuration") {
    const duration = Math.floor(numberValue(formData, "value"));
    if (duration !== 6 && duration !== 12) {
      return { ok: false, error: "Choose a 6-month or 12-month term." };
    }
    if (!tenancyId) {
      return { ok: false, error: "This room needs an active tenancy first." };
    }

    const { data: tenancy } = await supabase
      .from("tenancies")
      .select("id, contract_start, tenancy_start_date, check_in_date, start_date")
      .eq("id", tenancyId)
      .eq("room_id", roomId)
      .eq("property_id", property.id)
      .eq("status", "active")
      .maybeSingle();
    const contractStart =
      tenancy?.contract_start ??
      tenancy?.tenancy_start_date ??
      tenancy?.check_in_date ??
      tenancy?.start_date ??
      null;
    if (!tenancy || !contractStart) {
      return { ok: false, error: "Add the contract start date before choosing a term." };
    }

    const contractEnd = calculateTermEndDate(contractStart, duration);
    const { error: tenancyError } = await supabase
      .from("tenancies")
      .update({
        contract_duration_months: duration,
        end_date: contractEnd,
        contract_end: contractEnd,
        tenancy_end_date: contractEnd,
      })
      .eq("id", tenancy.id)
      .eq("room_id", roomId)
      .eq("property_id", property.id)
      .eq("status", "active");
    if (tenancyError) {
      return { ok: false, error: "The tenancy term could not be saved." };
    }

    if (tenantRecordId) {
      const { error: recordError } = await supabase
        .from("tenant_records")
        .update({ contract_end: contractEnd })
        .eq("id", tenantRecordId)
        .eq("room_id", roomId)
        .eq("property_id", property.id);
      if (recordError) {
        return { ok: false, error: "The tenant record end date could not be synchronized." };
      }
    }
  }

  if (field === "depositReceived") {
    const depositReceived = Math.max(0, numberValue(formData, "value"));

    if (!tenancyId && tenantRecordId) {
      tenancyId =
        (await ensureCanonicalTenancy(
          supabase,
          property,
          roomId,
          tenantRecordId,
          user.id,
        )) ?? "";
    }
    if (!tenancyId) {
      return { ok: false, error: "This room needs a tenant assignment first." };
    }

    const { data: paymentTenancy } = await supabase
      .from("tenancies")
      .select("id, tenant_id, organization_id, unit_id, deposit")
      .eq("id", tenancyId)
      .eq("room_id", roomId)
      .eq("property_id", property.id)
      .eq("status", "active")
      .maybeSingle();
    if (!paymentTenancy) {
      return { ok: false, error: "The active tenancy could not be verified." };
    }

    const requiredDeposit = Number(paymentTenancy.deposit ?? 0);
    if (depositReceived > requiredDeposit + 0.005) {
      return {
        ok: false,
        error: `Deposit received cannot exceed RM ${requiredDeposit.toFixed(2)}.`,
      };
    }

    const { data: existingDeposits, error: existingDepositsError } = await supabase
      .from("payments")
      .select("id, amount, payment_method, reference_number, notes")
      .eq("tenancy_id", paymentTenancy.id)
      .in("category", ["deposit", "rental_deposit", "security_deposit"])
      .eq("status", "confirmed");
    if (existingDepositsError) {
      return { ok: false, error: "The existing deposit records could not be checked." };
    }

    const manualDeposits = (existingDeposits ?? []).filter(
      (payment) =>
        payment.payment_method === "manual_adjustment" &&
        payment.reference_number?.startsWith("DEPOSIT-") &&
        payment.notes === "Deposit received recorded from Property Details.",
    );
    const protectedDeposits = (existingDeposits ?? []).filter(
      (payment) => !manualDeposits.some((manual) => manual.id === payment.id),
    );
    const protectedPaymentAmount = protectedDeposits.reduce(
      (total, payment) => total + Number(payment.amount ?? 0),
      0,
    );

    const { data: verifiedSubmissions, error: verifiedSubmissionsError } =
      await supabase
        .from("payment_submissions")
        .select("amount")
        .eq("tenancy_id", paymentTenancy.id)
        .in("payment_type", ["deposit", "rental_deposit", "security_deposit"])
        .eq("verification_status", "verified");
    if (verifiedSubmissionsError) {
      return { ok: false, error: "Verified deposit slips could not be checked." };
    }
    const verifiedSubmissionAmount = (verifiedSubmissions ?? []).reduce(
      (total, submission) => total + Number(submission.amount ?? 0),
      0,
    );
    // Verification normally creates a canonical payment. Use submissions only
    // when no canonical verified payment exists to avoid counting the same slip twice.
    const protectedReceived =
      protectedPaymentAmount > 0
        ? protectedPaymentAmount
        : verifiedSubmissionAmount;

    if (depositReceived < protectedReceived - 0.005) {
      return {
        ok: false,
        error: `Verified deposit slips total RM ${protectedReceived.toFixed(2)} and cannot be reduced.`,
      };
    }

    const existingManualAmount = manualDeposits.reduce(
      (total, payment) => total + Number(payment.amount ?? 0),
      0,
    );
    const requestedManualAmount = Math.max(
      depositReceived - protectedReceived,
      0,
    );
    if (Math.abs(requestedManualAmount - existingManualAmount) <= 0.005) {
      revalidatePath(propertyPath(property.id));
      revalidatePath("/dashboard");
      return { ok: true };
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("profile_id")
      .eq("id", paymentTenancy.tenant_id)
      .maybeSingle();
    const manualDepositIds = manualDeposits.map((payment) => payment.id);
    if (manualDepositIds.length) {
      const { error: cancelError } = await supabase
        .from("payments")
        .update({
          status: "cancelled",
          notes:
            "Deposit received manual entry corrected from Property Details.",
          updated_at: new Date().toISOString(),
        })
        .in("id", manualDepositIds)
        .eq("status", "confirmed");
      if (cancelError) {
        return { ok: false, error: "The previous manual deposit amount could not be corrected." };
      }
    }

    const referenceNumber =
      `DEPOSIT-${paymentTenancy.id.slice(0, 8)}-${Date.now()}`;

    if (requestedManualAmount > 0.005) {
      const { error: paymentError } = await supabase.from("payments").insert({
        company_id: property.company_id,
        organization_id: paymentTenancy.organization_id,
        tenancy_id: paymentTenancy.id,
        tenant_id: tenant?.profile_id ?? null,
        property_id: property.id,
        unit_id: paymentTenancy.unit_id,
        room_id: roomId,
        category: "deposit",
        amount: requestedManualAmount,
        payment_method: "manual_adjustment",
        reference_number: referenceNumber,
        status: "confirmed",
        payment_date: today(),
        notes: "Deposit received recorded from Property Details.",
        collected_by: user.id,
        recorded_by: user.id,
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      });
      if (paymentError) {
        if (manualDepositIds.length) {
          await supabase
            .from("payments")
            .update({
              status: "confirmed",
              notes: "Deposit received recorded from Property Details.",
              updated_at: new Date().toISOString(),
            })
            .in("id", manualDepositIds)
            .eq("status", "cancelled");
        }
        return { ok: false, error: "The deposit payment could not be saved." };
      }
    }

    await supabase.from("audit_logs").insert({
      company_id: property.company_id,
      actor_profile_id: user.id,
      action: "correct_deposit_received",
      entity_table: "tenancies",
      entity_id: paymentTenancy.id,
      metadata: {
        room_id: roomId,
        protected_verified_amount: protectedReceived,
        previous_manual_amount: existingManualAmount,
        new_manual_amount: requestedManualAmount,
        deposit_received_total: depositReceived,
      },
    });
  }

  revalidatePath(propertyPath(property.id));
  revalidatePath("/dashboard");
  revalidatePath("/rent-due-tracker");
  return { ok: true };
}

export async function generateRoomAgreement(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const tenantRecordId = textValue(formData, "tenantRecordId");
  const property = await accessibleProperty(propertyId);
  if (!user || !property) {
    redirect("/properties");
  }
  const supabase = await getAdmin();
  let tenancyId = textValue(formData, "tenancyId") || null;
  if (!tenancyId && tenantRecordId) {
    tenancyId = await ensureCanonicalTenancy(supabase, property, roomId, tenantRecordId, user.id);
  }
  if (!tenancyId) {
    redirect(propertyPath(property.id, "?error=tenancy"));
  }
  redirect(`/tenancy-agreements/preview/${encodeURIComponent(tenancyId)}`);
}

export async function sendRoomAgreement(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const propertyId = textValue(formData, "propertyId");
  const agreementId = textValue(formData, "agreementId");
  const tenancyId = textValue(formData, "tenancyId");
  const property = await accessibleProperty(propertyId);
  if (!property || !agreementId || !tenancyId) {
    redirect("/properties");
  }
  const supabase = await getAdmin();
  await supabase
    .from("tenancy_agreements")
    .update({ status: "pending_signature" })
    .eq("id", agreementId)
    .eq("tenancy_id", tenancyId)
    .is("admin_rejected_at", null);
  await supabase.from("agreement_notifications").insert({
    tenancy_id: tenancyId,
    agreement_id: agreementId,
    notification_type: "agreement_send",
    status: "pending",
    due_at: new Date().toISOString(),
  });
  revalidatePath(propertyPath(property.id));
  redirect(propertyPath(property.id, "?saved=agreement_sent"));
}

export async function registerTenant(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const property = await accessibleProperty(propertyId);
  const fullName = textValue(formData, "fullName");
  const phone = textValue(formData, "phone");
  const identityNumber = textValue(formData, "identificationNumber");
  const email = textValue(formData, "email");
  const checkInDate = textValue(formData, "checkInDate");
  const contractEnd = textValue(formData, "contractEnd") || null;
  const monthlyRent = Math.max(0, numberValue(formData, "monthlyRent"));
  const deposit = Math.max(0, numberValue(formData, "deposit"));
  const icFront = formFile(formData, "icFront");
  const icBack = formFile(formData, "icBack");
  const passportPhoto = formFile(formData, "passportPhoto");
  const commercialSupportingDocument = formFile(
    formData,
    "commercialSupportingDocument",
  );

  if (!user || !property || !roomId || !fullName || !checkInDate) {
    redirect(propertyPath(propertyId, "/register-tenant?error=missing"));
  }
  if (!(icFront && icBack) && !passportPhoto) {
    redirect(propertyPath(property.id, "/register-tenant?error=document"));
  }
  if (property.is_commercial && !commercialSupportingDocument) {
    redirect(
      propertyPath(property.id, "/register-tenant?error=commercial_document"),
    );
  }
  if (
    ![icFront, icBack, passportPhoto, commercialSupportingDocument].every(
      isValidTenantDocument,
    )
  ) {
    redirect(propertyPath(property.id, "/register-tenant?error=upload"));
  }

  const supabase = await getAdmin();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, unit_id, status")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();
  if (!room || room.status !== "vacant") {
    redirect(propertyPath(property.id, "/register-tenant?error=occupied"));
  }

  const documentBatchId = crypto.randomUUID();
  const documents = [
    icFront ? { documentType: "ic_front" as const, file: icFront } : null,
    icBack ? { documentType: "ic_back" as const, file: icBack } : null,
    passportPhoto
      ? { documentType: "passport_photo_page" as const, file: passportPhoto }
      : null,
    commercialSupportingDocument
      ? {
          documentType: "commercial_supporting_document" as const,
          file: commercialSupportingDocument,
        }
      : null,
  ].filter(
    (
      document,
    ): document is { documentType: TenantDocumentType; file: File } =>
      document !== null,
  );
  let uploadedDocuments: Awaited<ReturnType<typeof uploadTenantDocuments>>;
  try {
    uploadedDocuments = await uploadTenantDocuments(
      supabase,
      user.id,
      documentBatchId,
      documents,
    );
  } catch {
    redirect(propertyPath(property.id, "/register-tenant?error=upload"));
  }

  let existingTenant = null;
  if (identityNumber) {
    const result = await supabase
      .from("tenants")
      .select("id")
      .eq("company_id", property.company_id)
      .eq("identity_number", identityNumber)
      .maybeSingle();
    existingTenant = result.data;
  }
  if (!existingTenant && phone) {
    const result = await supabase
      .from("tenants")
      .select("id")
      .eq("company_id", property.company_id)
      .eq("phone", phone)
      .maybeSingle();
    existingTenant = result.data;
  }

  let tenantId = existingTenant?.id;
  let createdTenant = false;
  if (!tenantId) {
    const { data: tenant, error } = await supabase
      .from("tenants")
      .insert({
        company_id: property.company_id,
        full_name: fullName,
        email: email || null,
        phone: phone || null,
        identity_number: identityNumber || null,
        status: "active",
      })
      .select("id")
      .single();
    if (error || !tenant) {
      await supabase.storage
        .from("tenant-documents")
        .remove(uploadedDocuments.map((item) => item.file_path));
      redirect(propertyPath(property.id, "/register-tenant?error=tenant"));
    }
    tenantId = tenant.id;
    createdTenant = true;
  }

  const dueDay = Number(checkInDate.slice(8, 10));
  const { data: tenancy, error: tenancyError } = await supabase
    .from("tenancies")
    .insert({
      company_id: property.company_id,
      tenant_id: tenantId,
      room_id: room.id,
      monthly_rent: monthlyRent,
      deposit,
      start_date: checkInDate,
      end_date: contractEnd,
      due_day: dueDay,
      status: "active",
      property_id: property.id,
      unit_id: room.unit_id,
      monthly_rental: monthlyRent,
      contract_start: checkInDate,
      contract_end: contractEnd,
      tenancy_start_date: checkInDate,
      tenancy_end_date: contractEnd,
      rent_due_day: dueDay,
      check_in_date: checkInDate,
      billing_status: "active",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (tenancyError || !tenancy) {
    await supabase.storage
      .from("tenant-documents")
      .remove(uploadedDocuments.map((item) => item.file_path));
    if (createdTenant) {
      await supabase.from("tenants").delete().eq("id", tenantId);
    }
    redirect(propertyPath(property.id, "/register-tenant?error=tenancy"));
  }

  const tenantRecordId = crypto.randomUUID();
  const { error: tenantRecordError } = await supabase
    .from("tenant_records")
    .insert({
      id: tenantRecordId,
      company_id: property.company_id,
      property_id: property.id,
      unit_id: room.unit_id,
      room_id: room.id,
      tenant_id: tenantId,
      tenancy_id: tenancy.id,
      full_name: fullName,
      email: email || null,
      phone: phone || null,
      identification_number: identityNumber || null,
      monthly_rent: monthlyRent,
      deposit,
      contract_start: checkInDate,
      contract_end: contractEnd,
      due_day: dueDay,
      status: "active",
      created_by: user.id,
    });
  if (tenantRecordError) {
    await supabase.storage
      .from("tenant-documents")
      .remove(uploadedDocuments.map((item) => item.file_path));
    await supabase.from("tenancies").delete().eq("id", tenancy.id);
    if (createdTenant) {
      await supabase.from("tenants").delete().eq("id", tenantId);
    }
    redirect(propertyPath(property.id, "/register-tenant?error=tenant"));
  }

  const { error: documentError } = await supabase
    .from("tenant_documents")
    .insert(
      uploadedDocuments.map((document) => ({
        ...document,
        tenant_application_id: null,
        tenant_id: null,
        tenant_record_id: tenantRecordId,
      })),
    );
  if (documentError) {
    await supabase.storage
      .from("tenant-documents")
      .remove(uploadedDocuments.map((item) => item.file_path));
    await supabase.from("tenant_records").delete().eq("id", tenantRecordId);
    await supabase.from("tenancies").delete().eq("id", tenancy.id);
    if (createdTenant) {
      await supabase.from("tenants").delete().eq("id", tenantId);
    }
    redirect(propertyPath(property.id, "/register-tenant?error=upload"));
  }

  await supabase
    .from("rooms")
    .update({
      status: "occupied",
      current_tenancy_id: tenancy.id,
      monthly_rent: monthlyRent,
    })
    .eq("id", room.id)
    .eq("status", "vacant");

  await generateRecurringRentBills(supabase, {
    currentDate: checkInDate,
    createdBy: user.id,
    tenancyId: tenancy.id,
    includeTenantRecords: false,
  });
  await reconcileSmartLockAccessForTenancy(tenancy.id).catch((error) => {
    console.error("New tenancy smart-lock access could not be provisioned.", {
      tenancyId: tenancy.id,
      error,
    });
  });
  revalidatePath(propertyPath(property.id));
  revalidatePath("/dashboard");
  revalidatePath("/rent-due-tracker");
  redirect(propertyPath(property.id, "?saved=tenant"));
}

export async function checkoutRoom(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const requestedTenancyId = textValue(formData, "tenancyId");
  const checkoutDate = textValue(formData, "checkoutDate") || today();
  const returnTo = textValue(formData, "returnTo");
  const property = await accessibleProperty(propertyId);
  if (!property || !user) {
    redirect("/properties");
  }
  const supabase = await getAdmin();
  const { data: room } = await supabase
    .from("rooms")
    .select("current_tenancy_id")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();
  const tenancyId = requestedTenancyId || room?.current_tenancy_id || "";
  const result = await executeTenantCheckout({
    actorProfileId: user.id,
    checkoutDate,
    expectedPropertyId: property.id,
    expectedRoomId: roomId,
    source: "admin_portal",
    tenancyId,
  });

  if (!result.ok) {
    const verificationError = result.reason === "lock" ? "lock" : "stale";
    const propertyError =
      result.reason === "lock" ? "lock_access" : "checkout_failed";
    redirect(
      returnTo === "/verification?view=tenancy"
        ? `/verification?view=tenancy&checkout=${verificationError}`
        : propertyPath(property.id, `?error=${propertyError}`),
    );
  }

  revalidatePath(propertyPath(property.id));
  revalidatePath(`/properties/${property.id}/rooms/${roomId}`);
  revalidatePath("/properties");
  revalidatePath("/tenants");
  revalidatePath("/verification");
  revalidatePath("/rent-due-tracker");
  revalidatePath("/dashboard");
  revalidatePath("/payments");
  redirect(
    returnTo === "/verification?view=tenancy"
      ? "/verification?view=tenancy&checkout=1"
      : propertyPath(property.id, "?saved=checkout"),
  );
}

export async function activateTenantPortalAccess(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const tenantId = textValue(formData, "tenantId");
  const property = await accessibleProperty(propertyId);

  if (!user || !property || !roomId || !tenantId) {
    redirect("/properties");
  }

  const supabase = await getAdmin();
  const { data: assignment } = await supabase
    .from("tenancies")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("property_id", property.id)
    .eq("room_id", roomId)
    .limit(1)
    .maybeSingle();
  if (!assignment) {
    redirect(
      propertyPath(
        property.id,
        `/rooms/${roomId}?portal=assignment`,
      ),
    );
  }

  const result = await activateTenantAccount(tenantId, user.id);
  if (!result.ok) {
    redirect(
      propertyPath(
        property.id,
        `/rooms/${roomId}?portal=${result.reason}`,
      ),
    );
  }

  await supabase
    .from("rent_bills")
    .update({
      tenant_id: result.profileId,
      updated_at: new Date().toISOString(),
    })
    .eq("tenancy_id", assignment.id);

  revalidatePath(propertyPath(property.id));
  revalidatePath(propertyPath(property.id, `/rooms/${roomId}`));
  revalidatePath(`/tenants/${tenantId}`);
  redirect(
    propertyPath(
      property.id,
      `/rooms/${roomId}?portal=${result.reset ? "reset" : "activated"}`,
    ),
  );
}

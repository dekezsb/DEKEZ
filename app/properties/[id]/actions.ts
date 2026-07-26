"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import {
  dueDateForBillMonth,
  generateRecurringRentBills,
} from "@/lib/billing/rent-billing";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import {
  addMonths,
  defaultAgreementTemplate,
  money,
  renderAgreementTemplate,
} from "@/lib/e-tenancy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

type TenantDocumentType =
  | "ic_front"
  | "ic_back"
  | "passport_photo_page"
  | "commercial_supporting_document";

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function validDocument(file: File | null) {
  if (!file) return true;
  const allowedTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  return file.size <= 10 * 1024 * 1024 && allowedTypes.has(file.type);
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

async function uploadTenantDocuments(
  supabase: Awaited<ReturnType<typeof getAdmin>>,
  actorId: string,
  batchId: string,
  documents: Array<{ documentType: TenantDocumentType; file: File }>,
) {
  const uploaded: Array<{
    content_type: string | null;
    document_type: TenantDocumentType;
    file_name: string;
    file_path: string;
  }> = [];

  for (const document of documents) {
    const safeName = document.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${actorId}/admin-registration/${batchId}/${document.documentType}-${safeName}`;
    const bytes = Buffer.from(await document.file.arrayBuffer());
    const { error } = await supabase.storage
      .from("tenant-documents")
      .upload(path, bytes, {
        contentType: document.file.type || "application/octet-stream",
        upsert: false,
      });
    if (error) {
      if (uploaded.length) {
        await supabase.storage
          .from("tenant-documents")
          .remove(uploaded.map((item) => item.file_path));
      }
      throw error;
    }
    uploaded.push({
      content_type: document.file.type || null,
      document_type: document.documentType,
      file_name: document.file.name,
      file_path: path,
    });
  }

  return uploaded;
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

async function createAgreementForTenancy(
  supabase: Awaited<ReturnType<typeof getAdmin>>,
  tenancyId: string,
  userId: string,
) {
  const { data: existing } = await supabase
    .from("tenancy_agreements")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .eq("agreement_type", "original")
    .maybeSingle();
  if (existing) {
    return existing.id;
  }

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, tenant_id, property_id, unit_id, room_id, monthly_rental, deposit, contract_start, contract_end, contract_duration_months, tenants(full_name, phone, identity_number), properties(name, address, default_ta_template_id), rooms(name, room_number)")
    .eq("id", tenancyId)
    .single();
  if (!tenancy) {
    return null;
  }

  const tenant = Array.isArray(tenancy.tenants) ? tenancy.tenants[0] : tenancy.tenants;
  const property = Array.isArray(tenancy.properties) ? tenancy.properties[0] : tenancy.properties;
  const room = Array.isArray(tenancy.rooms) ? tenancy.rooms[0] : tenancy.rooms;
  const duration = tenancy.contract_duration_months ?? 12;
  const startDate = tenancy.contract_start ?? today();
  const endDate = tenancy.contract_end ?? addMonths(startDate, duration);
  let template: { id: string; template_content: string } | null = null;

  if (property?.default_ta_template_id) {
    const { data } = await supabase
      .from("tenancy_agreement_templates")
      .select("id, template_content")
      .eq("id", property.default_ta_template_id)
      .maybeSingle();
    template = data;
  }
  if (!template) {
    const { data } = await supabase
      .from("tenancy_agreement_templates")
      .insert({
        property_id: tenancy.property_id,
        name: `${property?.name ?? "Property"} Default TA`,
        template_content: defaultAgreementTemplate,
        is_active: true,
        created_by: userId,
      })
      .select("id, template_content")
      .single();
    template = data;
    if (template?.id) {
      await supabase
        .from("properties")
        .update({ default_ta_template_id: template.id })
        .eq("id", tenancy.property_id);
    }
  }

  const rendered = renderAgreementTemplate(template?.template_content ?? defaultAgreementTemplate, {
    tenant_name: tenant?.full_name,
    tenant_ic_passport: tenant?.identity_number,
    tenant_phone: tenant?.phone,
    property_name: property?.name,
    property_address: property?.address,
    unit_number: "-",
    room_number: room?.room_number ?? room?.name,
    monthly_rent: money(tenancy.monthly_rental),
    deposit_amount: money(tenancy.deposit),
    utility_deposit: money(0),
    tenancy_start_date: startDate,
    tenancy_end_date: endDate,
    contract_duration_months: duration,
    agreement_date: today(),
    tenant_signature: "[Pending tenant signature]",
  });

  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .insert({
      tenancy_id: tenancy.id,
      template_id: template?.id ?? null,
      agreement_type: "original",
      version_number: 1,
      status: "draft",
      rendered_content: rendered,
      created_by: userId,
    })
    .select("id")
    .single();

  return agreement?.id ?? null;
}

export async function updateProperty(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
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

export async function updatePaymentQr(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
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

export async function updateRoomField(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const field = textValue(formData, "field");
  const property = await accessibleProperty(propertyId);
  const supportedFields = [
    "monthlyRent",
    "deposit",
    "amountReceived",
    "dueDay",
    "contractEnd",
  ];
  if (!user || !property || !roomId || !supportedFields.includes(field)) {
    return { ok: false, error: "This room field could not be saved." };
  }

  const tenantRecordId = textValue(formData, "tenantRecordId");
  let tenancyId = textValue(formData, "tenancyId");
  const billId = textValue(formData, "billId");
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
      .select("id, paid_amount")
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
          amount: Math.max(monthlyRent, Number(bill.paid_amount ?? 0)),
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

  if (field === "amountReceived") {
    if (!billId) {
      return { ok: false, error: "There is no current rent bill to update." };
    }
    const amountReceived = Math.max(0, numberValue(formData, "value"));
    const { data: bill } = await supabase
      .from("rent_bills")
      .select("id, tenancy_id, tenant_id, amount, paid_amount, status")
      .eq("id", billId)
      .eq("room_id", roomId)
      .eq("property_id", property.id)
      .maybeSingle();
    if (
      !bill ||
      ["cancelled", "paid", "submitted", "pending_verification"].includes(bill.status)
    ) {
      return { ok: false, error: "This rent bill cannot be changed." };
    }

    const existingReceived = Number(bill.paid_amount ?? 0);
    if (amountReceived < existingReceived) {
      return {
        ok: false,
        error: "Verified amount received cannot be reduced.",
      };
    }
    if (amountReceived === existingReceived) {
      return { ok: true };
    }

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
    const paymentTenancyId = bill.tenancy_id ?? tenancyId;
    if (!paymentTenancyId) {
      return { ok: false, error: "A tenancy is required before recording payment." };
    }
    const { data: paymentTenancy } = await supabase
      .from("tenancies")
      .select("tenant_id, organization_id")
      .eq("id", paymentTenancyId)
      .eq("room_id", roomId)
      .maybeSingle();
    if (!paymentTenancy) {
      return { ok: false, error: "The active tenancy could not be verified." };
    }

    const difference = amountReceived - existingReceived;
    const referenceNumber = `PROPERTY-${bill.id.slice(0, 8)}-${amountReceived.toFixed(2)}`;
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id")
      .eq("tenancy_id", paymentTenancyId)
      .eq("reference_number", referenceNumber)
      .maybeSingle();
    if (!existingPayment) {
      const { error: paymentError } = await supabase.from("payments").insert({
        company_id: property.company_id,
        organization_id: paymentTenancy.organization_id,
        tenancy_id: paymentTenancyId,
        tenant_id: bill.tenant_id ?? paymentTenancy.tenant_id,
        property_id: property.id,
        room_id: roomId,
        rent_bill_id: bill.id,
        category: "monthly_rent",
        amount: difference,
        payment_method: "manual_adjustment",
        reference_number: referenceNumber,
        status: "confirmed",
        payment_date: today(),
        notes: "Recorded from Property Details without changing prior verified payments.",
        collected_by: user.id,
        recorded_by: user.id,
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      });
      if (paymentError) {
        return { ok: false, error: "The verified payment record could not be created." };
      }
    }

    const billAmount = Number(bill.amount ?? 0);
    const { error: billError } = await supabase
      .from("rent_bills")
      .update({
        paid_amount: amountReceived,
        status: amountReceived >= billAmount ? "paid" : "partial",
      })
      .eq("id", bill.id);
    if (billError) {
      return { ok: false, error: "The rent bill could not be updated." };
    }
  }

  revalidatePath(propertyPath(property.id));
  revalidatePath("/rent-due-tracker");
  return { ok: true };
}

export async function generateRoomAgreement(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
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
  const agreementId = await createAgreementForTenancy(supabase, tenancyId, user.id);
  if (!agreementId) {
    redirect(propertyPath(property.id, "?error=agreement"));
  }
  revalidatePath(propertyPath(property.id));
  revalidatePath("/e-tenancy");
  redirect(propertyPath(property.id, "?saved=agreement"));
}

export async function sendRoomAgreement(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
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
    .eq("tenancy_id", tenancyId);
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
  await requireRole(["super_admin", "admin"]);
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
  const icFront = fileValue(formData, "icFront");
  const icBack = fileValue(formData, "icBack");
  const passportPhoto = fileValue(formData, "passportPhoto");
  const commercialSupportingDocument = fileValue(
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
      validDocument,
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
  await createAgreementForTenancy(supabase, tenancy.id, user.id);

  revalidatePath(propertyPath(property.id));
  revalidatePath("/dashboard");
  revalidatePath("/rent-due-tracker");
  redirect(propertyPath(property.id, "?saved=tenant"));
}

export async function checkoutRoom(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const checkoutDate = textValue(formData, "checkoutDate") || today();
  const property = await accessibleProperty(propertyId);
  if (!property) {
    redirect("/properties");
  }
  const supabase = await getAdmin();
  const { data: room } = await supabase
    .from("rooms")
    .select("current_tenancy_id")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();
  await Promise.all([
    supabase
      .from("tenancies")
      .update({
        status: "ended",
        checkout_date: checkoutDate,
        billing_status: "completed",
        end_date: checkoutDate,
        contract_end: checkoutDate,
      })
      .eq("room_id", roomId)
      .eq("status", "active"),
    supabase
      .from("tenant_records")
      .update({ status: "checked_out", contract_end: checkoutDate })
      .eq("room_id", roomId)
      .eq("status", "active"),
    supabase
      .from("rooms")
      .update({ status: "vacant", current_tenancy_id: null })
      .eq("id", roomId),
    supabase
      .from("rent_bills")
      .update({ status: "cancelled" })
      .eq("room_id", roomId)
      .gt("due_date", checkoutDate)
      .in("status", ["draft", "unpaid", "overdue"]),
  ]);
  if (room?.current_tenancy_id) {
    await supabase
      .from("agreement_notifications")
      .update({ status: "cancelled" })
      .eq("tenancy_id", room.current_tenancy_id)
      .eq("status", "pending");
  }
  revalidatePath(propertyPath(property.id));
  redirect(propertyPath(property.id, "?saved=checkout"));
}

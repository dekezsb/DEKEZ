"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";

const allowedStatuses = new Set(["draft", "unpaid", "partial", "paid"]);

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : Number.NaN;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function errorRedirect(code: string): never {
  redirect(`/rental-invoices?error=${code}#historical-invoice`);
}

async function requireInvoiceAdmin() {
  await requireRole(["super_admin", "admin"], {
    module: "rent_due_tracker",
    level: "manage",
  });
  const user = await getCurrentUser();
  if (!user) {
    redirect("/");
  }
  return user;
}

export async function createHistoricalRentalInvoice(formData: FormData) {
  const user = await requireInvoiceAdmin();
  const tenantRecordId = textValue(formData, "tenantRecordId");
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const invoiceMonth = textValue(formData, "invoiceMonth");
  const invoiceDate = textValue(formData, "invoiceDate");
  const dueDate = textValue(formData, "dueDate");
  const amount = numberValue(formData, "amount");
  const outstanding = numberValue(formData, "outstanding");
  const status = textValue(formData, "status");
  const notes = textValue(formData, "notes");

  if (
    !tenantRecordId ||
    !propertyId ||
    !roomId ||
    !/^\d{4}-\d{2}$/.test(invoiceMonth) ||
    !validDate(invoiceDate) ||
    !validDate(dueDate) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(outstanding) ||
    outstanding < 0 ||
    outstanding > amount ||
    !allowedStatuses.has(status)
  ) {
    errorRedirect("missing");
  }

  if (
    (status === "paid" && outstanding !== 0) ||
    (status === "partial" && (outstanding <= 0 || outstanding >= amount)) ||
    ((status === "draft" || status === "unpaid") && outstanding !== amount)
  ) {
    errorRedirect("balance");
  }

  const billMonth = `${invoiceMonth}-01`;
  const supabase = await createClient();
  const [tenantResult, propertyResult, roomResult] = await Promise.all([
    supabase
      .from("tenant_records")
      .select("id, tenant_id, tenancy_id")
      .eq("id", tenantRecordId)
      .maybeSingle(),
    supabase
      .from("properties")
      .select("id, company_id, organization_id")
      .eq("id", propertyId)
      .maybeSingle(),
    supabase
      .from("rooms")
      .select("id, property_id, unit_id")
      .eq("id", roomId)
      .maybeSingle(),
  ]);
  const tenantRecord = tenantResult.data;
  const property = propertyResult.data;
  const room = roomResult.data;

  if (!tenantRecord || !property || !room || room.property_id !== property.id) {
    errorRedirect("selection");
  }

  let tenancy: {
    id: string;
    organization_id: string | null;
    property_id: string | null;
    room_id: string;
    tenant_id: string;
    unit_id: string | null;
  } | null = null;

  if (tenantRecord.tenancy_id) {
    const { data } = await supabase
      .from("tenancies")
      .select("id, organization_id, property_id, room_id, tenant_id, unit_id")
      .eq("id", tenantRecord.tenancy_id)
      .maybeSingle();
    if (
      data &&
      data.property_id === property.id &&
      data.room_id === room.id
    ) {
      tenancy = data;
    }
  }

  if (!tenancy && tenantRecord.tenant_id) {
    const { data } = await supabase
      .from("tenancies")
      .select("id, organization_id, property_id, room_id, tenant_id, unit_id")
      .eq("tenant_id", tenantRecord.tenant_id)
      .eq("property_id", property.id)
      .eq("room_id", room.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    tenancy = data ?? null;
  }

  let tenantProfileId: string | null = null;
  if (tenantRecord.tenant_id) {
    const { data } = await supabase
      .from("tenants")
      .select("profile_id")
      .eq("id", tenantRecord.tenant_id)
      .maybeSingle();
    tenantProfileId = data?.profile_id ?? null;
  }

  const duplicateChecks = [
    supabase
      .from("rent_bills")
      .select("id, invoice_number")
      .eq("tenant_record_id", tenantRecord.id)
      .eq("bill_month", billMonth)
      .limit(1)
      .maybeSingle(),
  ];
  if (tenancy) {
    duplicateChecks.push(
      supabase
        .from("rent_bills")
        .select("id, invoice_number")
        .eq("tenancy_id", tenancy.id)
        .eq("bill_month", billMonth)
        .limit(1)
        .maybeSingle(),
    );
  }
  const duplicateResults = await Promise.all(duplicateChecks);
  const existing = duplicateResults.find((result) => result.data)?.data;
  if (existing) {
    redirect(`/rental-invoices?existing=${existing.id}#historical-invoice`);
  }

  const paidAmount = Number((amount - outstanding).toFixed(2));
  const { data: invoice, error } = await supabase
    .from("rent_bills")
    .insert({
      organization_id: tenancy?.organization_id ?? property.organization_id,
      tenancy_id: tenancy?.id ?? null,
      tenant_id: tenantProfileId,
      tenant_record_id: tenantRecord.id,
      property_id: property.id,
      unit_id: tenancy?.unit_id ?? room.unit_id,
      room_id: room.id,
      bill_month: billMonth,
      invoice_date: invoiceDate,
      due_date: dueDate,
      amount,
      paid_amount: paidAmount,
      status,
      invoice_source: "manual_historical",
      notes: notes || null,
      created_by: user.id,
    })
    .select("id, invoice_number")
    .single();

  if (error) {
    if (error.code === "23505") {
      errorRedirect("duplicate");
    }
    errorRedirect("create");
  }

  revalidatePath("/rental-invoices");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  redirect(`/rental-invoices?created=${invoice.id}#invoice-${invoice.id}`);
}

export async function removeRentalInvoice(formData: FormData) {
  await requireInvoiceAdmin();
  const invoiceId = textValue(formData, "invoiceId");
  const reason = textValue(formData, "reason");
  if (!invoiceId || !reason) {
    redirect(`/rental-invoices?error=remove_reason#invoice-${invoiceId}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_rental_invoice", {
    target_invoice_id: invoiceId,
    removal_reason: reason,
  });

  if (error || (data !== "deleted" && data !== "voided")) {
    redirect(`/rental-invoices?error=remove#invoice-${invoiceId}`);
  }

  revalidatePath("/rental-invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  redirect(`/rental-invoices?removed=${data}`);
}

import { createAdminClient } from "@/lib/supabase/admin";
import { money } from "@/lib/e-tenancy";
import { normalizePhoneNumber, phoneMatches } from "./config";

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export type TenantIdentity = {
  id: string;
  fullName: string | null;
  phone: string | null;
  normalizedPhone: string;
};

export type TenantToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

export async function findTenantByWhatsAppPhone(
  supabase: SupabaseAdmin,
  incomingPhone: string,
): Promise<TenantIdentity | null> {
  const normalizedPhone = normalizePhoneNumber(incomingPhone);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("role", "tenant");

  const tenant = (profiles ?? []).find((profile) => phoneMatches(profile.phone, normalizedPhone));

  if (!tenant) {
    return null;
  }

  return {
    id: tenant.id,
    fullName: tenant.full_name ?? null,
    phone: tenant.phone ?? null,
    normalizedPhone,
  };
}

async function getActiveTenancy(supabase: SupabaseAdmin, tenantId: string) {
  const { data } = await supabase
    .from("tenancies")
    .select("id, organization_id, tenant_id, property_id, unit_id, room_id, monthly_rental, deposit, contract_start, contract_end, tenancy_start_date, tenancy_end_date, due_day, status, properties(name, address), units(name), rooms(name, room_number)")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

export async function getMyProfile(supabase: SupabaseAdmin, tenant: TenantIdentity): Promise<TenantToolResult> {
  return {
    ok: true,
    message: `Your DEKEZ tenant profile is ${tenant.fullName ?? "registered"} with phone ${tenant.phone ?? tenant.normalizedPhone}.`,
    data: tenant,
  };
}

export async function getMyRoom(supabase: SupabaseAdmin, tenant: TenantIdentity): Promise<TenantToolResult> {
  const tenancy = await getActiveTenancy(supabase, tenant.id);
  const property = Array.isArray(tenancy?.properties) ? tenancy?.properties[0] : tenancy?.properties;
  const unit = Array.isArray(tenancy?.units) ? tenancy?.units[0] : tenancy?.units;
  const room = Array.isArray(tenancy?.rooms) ? tenancy?.rooms[0] : tenancy?.rooms;

  if (!tenancy) {
    return { ok: true, message: "Your room or tenancy has not been assigned yet." };
  }

  return {
    ok: true,
    message: `Your room is ${room?.room_number ?? room?.name ?? "-"} at ${property?.name ?? "your property"}${unit?.name ? `, unit ${unit.name}` : ""}.`,
    data: { tenancy, property, unit, room },
  };
}

export async function getMyOutstandingRent(supabase: SupabaseAdmin, tenant: TenantIdentity): Promise<TenantToolResult> {
  const { data: bills } = await supabase
    .from("rent_bills")
    .select("id, bill_month, due_date, amount, paid_amount, status")
    .eq("tenant_id", tenant.id)
    // Admin/accounting-only invoices (e.g. a historical bank-reconciliation
    // invoice for a room the tenant no longer occupies) must never be
    // reported to the tenant as an outstanding bill.
    .eq("tenant_facing", true)
    .not("status", "in", "(draft,paid,cancelled,waived,payment_submitted,pending_verification)")
    .order("due_date", { ascending: true });

  const outstanding = (bills ?? []).reduce((sum, bill) => {
    return sum + Math.max(Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0), 0);
  }, 0);

  if (!bills?.length || outstanding <= 0) {
    return { ok: true, message: "You do not have any unpaid rent bills showing in DEKEZ right now.", data: { outstanding: 0 } };
  }

  const nextBill = bills[0];
  return {
    ok: true,
    message: `Your outstanding rent is ${money(outstanding)}. Next unpaid bill: ${nextBill.bill_month ?? "-"}, due ${nextBill.due_date ?? "-"}, status ${nextBill.status}.`,
    data: { outstanding, bills },
  };
}

export async function getMyBills(supabase: SupabaseAdmin, tenant: TenantIdentity): Promise<TenantToolResult> {
  const { data } = await supabase
    .from("rent_bills")
    .select("bill_month, due_date, amount, paid_amount, status")
    .eq("tenant_id", tenant.id)
    .eq("tenant_facing", true)
    .order("bill_month", { ascending: false })
    .limit(5);
  const rentBills = data ?? [];

  if (!rentBills.length) {
    return { ok: true, message: "No rent bills are showing in your DEKEZ account yet." };
  }

  const rentLine = rentBills[0]
    ? `Latest rent bill: ${rentBills[0].bill_month}, ${money(rentBills[0].amount)}, status ${rentBills[0].status}.`
    : "No rent bills found.";

  return { ok: true, message: rentLine, data: { rentBills } };
}

export async function getMyPaymentHistory(supabase: SupabaseAdmin, tenant: TenantIdentity): Promise<TenantToolResult> {
  const { data: payments } = await supabase
    .from("payments")
    .select("category, amount, payment_date, payment_method, status")
    .eq("tenant_id", tenant.id)
    .order("payment_date", { ascending: false })
    .limit(5);

  if (!payments?.length) {
    return { ok: true, message: "No payment history is showing in your DEKEZ account yet." };
  }

  const lines = payments.map((payment) => `${payment.payment_date}: ${payment.category} ${money(payment.amount)} (${payment.status})`);
  return { ok: true, message: `Your latest payments:\n${lines.join("\n")}`, data: payments };
}

export async function getMyContractExpiry(supabase: SupabaseAdmin, tenant: TenantIdentity): Promise<TenantToolResult> {
  const tenancy = await getActiveTenancy(supabase, tenant.id);

  if (!tenancy) {
    return { ok: true, message: "Your room or tenancy has not been assigned yet." };
  }

  const endDate = tenancy.tenancy_end_date ?? tenancy.contract_end;
  return {
    ok: true,
    message: endDate ? `Your tenancy contract ends on ${endDate}.` : "Your tenancy end date is not set yet.",
    data: tenancy,
  };
}

export async function getMyTenancyAgreement(supabase: SupabaseAdmin, tenant: TenantIdentity): Promise<TenantToolResult> {
  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .select("id, status, signed_at, generated_at, tenancies!inner(tenant_id, tenancy_start_date, tenancy_end_date)")
    .eq("tenancies.tenant_id", tenant.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!agreement) {
    return { ok: true, message: "No tenancy agreement is ready in your DEKEZ account yet." };
  }

  const tenancy = Array.isArray(agreement.tenancies) ? agreement.tenancies[0] : agreement.tenancies;
  return {
    ok: true,
    message: `Your tenancy agreement status is ${agreement.status}. Contract end date: ${tenancy?.tenancy_end_date ?? "-"}.`,
    data: agreement,
  };
}

export async function getMyMaintenanceTickets(supabase: SupabaseAdmin, tenant: TenantIdentity): Promise<TenantToolResult> {
  const { data: tickets } = await supabase
    .from("maintenance_tickets")
    .select("ticket_number, ticket_type, category, description, urgency, status, created_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!tickets?.length) {
    return { ok: true, message: "You do not have any maintenance tickets yet." };
  }

  const lines = tickets.map((ticket) => `${ticket.ticket_number}: ${ticket.status} - ${ticket.description}`);
  return { ok: true, message: `Your latest maintenance tickets:\n${lines.join("\n")}`, data: tickets };
}

export async function submitPaymentProofFromWhatsApp(
  supabase: SupabaseAdmin,
  tenant: TenantIdentity,
  mediaBytes: Buffer,
  mediaMimeType: string | null,
  fileExtension: string,
): Promise<TenantToolResult> {
  const tenancy = await getActiveTenancy(supabase, tenant.id);

  if (!tenancy) {
    return {
      ok: true,
      message: "I could not find an active tenancy linked to your account, so I could not log this payment slip. Please contact the office.",
    };
  }

  const { data: bill } = await supabase
    .from("rent_bills")
    .select("id, tenancy_id, tenant_id, property_id, unit_id, room_id, bill_month, due_date, amount, paid_amount, status")
    .eq("tenancy_id", tenancy.id)
    .eq("tenant_facing", true)
    .not("status", "in", "(paid,cancelled,waived,payment_submitted,pending_verification)")
    .order("due_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!bill) {
    return {
      ok: true,
      message: "Thanks! I don't see any outstanding rent bill on your account right now, so there is nothing pending to mark. If this is a mistake, please contact the office.",
    };
  }

  const outstanding = Math.max(Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0), 0);
  const safeExt = (fileExtension || "jpg").replace(/[^a-zA-Z0-9]/g, "") || "jpg";
  const path = `${tenant.id}/${bill.id}/whatsapp-${Date.now()}.${safeExt}`;

  const { error: uploadError } = await supabase.storage.from("payment-receipts").upload(path, mediaBytes, {
    contentType: mediaMimeType || "application/octet-stream",
    upsert: true,
  });

  if (uploadError) {
    return {
      ok: false,
      message: "Sorry, I could not save your payment slip. Please try sending it again, or upload it through your DEKEZ tenant portal.",
    };
  }

  const { data: submission, error } = await supabase
    .from("payment_submissions")
    .insert({
      tenant_id: tenant.id,
      tenancy_id: bill.tenancy_id,
      rent_bill_id: bill.id,
      property_id: bill.property_id,
      unit_id: bill.unit_id,
      room_id: bill.room_id,
      bill_month: bill.bill_month,
      bill_type: "monthly_rent",
      payment_type: "monthly_rent",
      amount: outstanding > 0 ? outstanding : Number(bill.amount ?? 0),
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: "bank_transfer",
      reference_number: null,
      receipt_url: path,
      verification_status: "pending_verification",
    })
    .select("id")
    .single();

  if (error || !submission) {
    await supabase.storage.from("payment-receipts").remove([path]);
    return {
      ok: false,
      message: "Sorry, I could not log your payment slip right now. Please try again shortly, or upload it through your DEKEZ tenant portal.",
    };
  }

  await supabase.from("payment_attachments").insert({
    payment_submission_id: submission.id,
    tenant_id: tenant.id,
    file_path: path,
    file_name: `whatsapp-slip.${safeExt}`,
    content_type: mediaMimeType ?? null,
  });

  await supabase
    .from("rent_bills")
    .update({ status: "payment_submitted", updated_at: new Date().toISOString() })
    .eq("id", bill.id);

  return {
    ok: true,
    message: `Got it, thank you! Your payment slip for ${bill.bill_month ?? "your rent bill"} has been received and is pending verification by our office. We will pause rent reminders for this bill until it is checked. If anything looks wrong we will contact you.`,
    data: { billId: bill.id, submissionId: submission.id },
  };
}

export async function createMaintenanceTicketFromWhatsApp(
  supabase: SupabaseAdmin,
  tenant: TenantIdentity,
  description: string,
  mediaPath?: string | null,
  mediaMimeType?: string | null,
): Promise<TenantToolResult> {
  const tenancy = await getActiveTenancy(supabase, tenant.id);

  if (!tenancy) {
    return {
      ok: false,
      message: "I cannot create a maintenance ticket yet because your room or tenancy has not been assigned in DEKEZ.",
    };
  }

  const { data: ticket, error } = await supabase
    .from("maintenance_tickets")
    .insert({
      organization_id: tenancy.organization_id ?? null,
      tenant_id: tenant.id,
      property_id: tenancy.property_id,
      unit_id: tenancy.unit_id ?? null,
      room_id: tenancy.room_id,
      ticket_type: "maintenance",
      category: "WhatsApp",
      description,
      urgency: /urgent|emergency|flood|fire|burst|sparking|no electricity/i.test(description) ? "urgent" : "normal",
      status: "submitted",
      created_by: tenant.id,
    })
    .select("id, ticket_number")
    .single();

  if (error || !ticket) {
    return { ok: false, message: "Sorry, I could not create the maintenance ticket. Please try again later." };
  }

  if (mediaPath) {
    await supabase.from("maintenance_attachments").insert({
      ticket_id: ticket.id,
      uploaded_by: tenant.id,
      attachment_type: "problem",
      bucket_name: "whatsapp-media",
      file_path: mediaPath,
      content_type: mediaMimeType ?? null,
    });
  }

  return {
    ok: true,
    message: `Maintenance ticket created: ${ticket.ticket_number ?? ticket.id}. Admin will review it.`,
    data: ticket,
  };
}

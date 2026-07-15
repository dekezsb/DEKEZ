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
    .neq("status", "paid")
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
  const [rentResult, utilityResult] = await Promise.all([
    supabase
      .from("rent_bills")
      .select("bill_month, due_date, amount, paid_amount, status")
      .eq("tenant_id", tenant.id)
      .order("bill_month", { ascending: false })
      .limit(5),
    supabase
      .from("utility_bills")
      .select("utility_type, bill_month, amount, paid_amount, status")
      .eq("tenant_id", tenant.id)
      .order("bill_month", { ascending: false })
      .limit(5),
  ]);

  const rentBills = rentResult.data ?? [];
  const utilityBills = utilityResult.data ?? [];

  if (!rentBills.length && !utilityBills.length) {
    return { ok: true, message: "No rent or utility bills are showing in your DEKEZ account yet." };
  }

  const rentLine = rentBills[0]
    ? `Latest rent bill: ${rentBills[0].bill_month}, ${money(rentBills[0].amount)}, status ${rentBills[0].status}.`
    : "No rent bills found.";
  const utilityLine = utilityBills[0]
    ? `Latest utility bill: ${utilityBills[0].utility_type}, ${money(utilityBills[0].amount)}, status ${utilityBills[0].status}.`
    : "No utility bills found.";

  return { ok: true, message: `${rentLine}\n${utilityLine}`, data: { rentBills, utilityBills } };
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

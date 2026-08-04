import { NextResponse } from "next/server";
import { dayDifference } from "@/lib/data/rent-due";
import { formatMalaysiaDate } from "@/lib/date-format";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  suspendOverdueFingerprintAccess,
  syncFingerprintEnrollments,
} from "@/lib/ttlock/fingerprint";
import { normalizePhoneNumber } from "@/lib/whatsapp/config";
import { sendWhatsAppText } from "@/lib/whatsapp/meta";

const reminderStages = new Set([7, 3, 1, 0, -1, -3, -7]);

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "https://dekez.vercel.app";
}

function money(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(value);
}

function reminderStage(daysUntilDue: number) {
  if (daysUntilDue > 0) {
    return `${daysUntilDue}_days_before`;
  }
  if (daysUntilDue === 0) {
    return "due_today";
  }
  return `${Math.abs(daysUntilDue)}_days_overdue`;
}

function messageForBill(input: {
  tenantName: string;
  propertyName: string;
  roomName: string;
  amount: number;
  outstandingAmount: number;
  dueDate: string;
  daysUntilDue: number;
}) {
  const portalLink = `${getBaseUrl()}/payments`;
  if (input.daysUntilDue < 0) {
    return `Hello ${input.tenantName}, your rental payment of ${money(input.outstandingAmount)} for ${input.propertyName} ${input.roomName} was due on ${input.dueDate} and is now ${Math.abs(input.daysUntilDue)} day(s) overdue. Please make payment and upload your payment proof as soon as possible through your DEKEZ tenant portal: ${portalLink}`;
  }

  return `Hello ${input.tenantName}, this is a reminder that your rental of ${money(input.amount)} for ${input.propertyName} ${input.roomName} is due on ${input.dueDate}. Please make payment and upload your payment slip through your DEKEZ tenant portal: ${portalLink}`;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const { data: bills } = await supabase
    .from("rent_bills")
    .select("id, tenant_id, property_id, room_id, due_date, amount, paid_amount, status, properties(name), rooms(name, room_number)")
    .not("status", "in", "(draft,paid,cancelled,waived)")
    .order("due_date", { ascending: true });

  const tenantIds = Array.from(new Set((bills ?? []).map((bill) => bill.tenant_id)));
  const { data: profiles } = tenantIds.length
    ? await supabase.from("profiles").select("id, full_name, phone").in("id", tenantIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const bill of bills ?? []) {
    const daysUntilDue = dayDifference(bill.due_date);
    if (!reminderStages.has(daysUntilDue)) {
      skipped += 1;
      continue;
    }

    const tenant = profileById.get(bill.tenant_id);
    if (!tenant?.phone) {
      skipped += 1;
      continue;
    }

    const stage = reminderStage(daysUntilDue);
    const { data: existing } = await supabase
      .from("rent_reminder_logs")
      .select("id")
      .eq("bill_id", bill.id)
      .eq("reminder_stage", stage)
      .eq("channel", "whatsapp")
      .maybeSingle();

    if (existing) {
      skipped += 1;
      continue;
    }

    const property = Array.isArray(bill.properties) ? bill.properties[0] : bill.properties;
    const room = Array.isArray(bill.rooms) ? bill.rooms[0] : bill.rooms;
    const amount = Number(bill.amount ?? 0);
    const outstandingAmount = Math.max(amount - Number(bill.paid_amount ?? 0), 0);
    const text = messageForBill({
      tenantName: tenant.full_name ?? tenant.phone,
      propertyName: property?.name ?? "your property",
      roomName: room?.room_number ?? room?.name ?? "your room",
      amount,
      outstandingAmount,
      dueDate: formatMalaysiaDate(bill.due_date),
      daysUntilDue,
    });

    const normalizedPhone = normalizePhoneNumber(tenant.phone);
    const { data: conversation } = await supabase
      .from("whatsapp_conversations")
      .upsert({
        tenant_id: bill.tenant_id,
        phone_number: tenant.phone,
        normalized_phone: normalizedPhone,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "normalized_phone",
      })
      .select("id")
      .single();

    let providerMessageId: string | null = null;
    let status = "sent";
    let errorMessage: string | null = null;

    try {
      const response = await sendWhatsAppText(tenant.phone, text);
      providerMessageId = response.messages?.[0]?.id ?? null;
      sent += 1;
    } catch (error) {
      status = "failed";
      errorMessage = error instanceof Error ? error.message : "WhatsApp send failed";
      failed += 1;
    }

    await supabase.from("whatsapp_messages").insert({
      conversation_id: conversation?.id ?? null,
      tenant_id: bill.tenant_id,
      phone_number: tenant.phone,
      normalized_phone: normalizedPhone,
      direction: "outgoing",
      meta_message_id: providerMessageId,
      message_type: "text",
      message_text: text,
      processing_status: status,
      error_message: errorMessage,
    });

    await supabase.from("rent_reminder_logs").insert({
      bill_id: bill.id,
      tenant_id: bill.tenant_id,
      reminder_stage: stage,
      channel: "whatsapp",
      provider_message_id: providerMessageId,
      status,
      error_message: errorMessage,
    });
  }

  const fingerprintEnrollment = await syncFingerprintEnrollments().catch((error) => ({
    matched: 0,
    skipped: 0,
    errors: [error instanceof Error ? error.message : "Fingerprint enrollment sync failed"],
  }));
  const fingerprintPolicy = await suspendOverdueFingerprintAccess().catch((error) => ({
    suspended: 0,
    skipped: 0,
    errors: [error instanceof Error ? error.message : "Fingerprint policy failed"],
  }));

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    failed,
    fingerprintMatched: fingerprintEnrollment.matched,
    fingerprintWaiting: fingerprintEnrollment.skipped,
    fingerprintEnrollmentErrors: fingerprintEnrollment.errors.length,
    fingerprintSuspended: fingerprintPolicy.suspended,
    fingerprintSkipped: fingerprintPolicy.skipped,
    fingerprintErrors: fingerprintPolicy.errors.length,
  });
}

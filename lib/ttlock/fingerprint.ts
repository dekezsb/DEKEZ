import "server-only";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  changeTTLockFingerprintPeriod,
  deleteTTLockFingerprint,
  listTTLockFingerprints,
} from "@/lib/ttlock/client";
import { normalizePhoneNumber } from "@/lib/whatsapp/config";
import { sendWhatsAppText } from "@/lib/whatsapp/meta";

type Relation<T> = T | T[] | null;

type TenantRelation = {
  profile_id: string | null;
  full_name: string;
  phone: string | null;
};

type TenancyRow = {
  id: string;
  company_id: string;
  property_id: string;
  room_id: string;
  status: string;
  billing_status: string | null;
  rental_model: "tenancy" | "monthly_stay";
  checkout_date: string | null;
  check_in_date: string | null;
  tenancy_start_date: string | null;
  contract_start: string | null;
  start_date: string | null;
  tenancy_end_date: string | null;
  contract_end: string | null;
  end_date: string | null;
  tenants: Relation<TenantRelation>;
  properties: Relation<{ name: string }>;
  rooms: Relation<{ name: string | null; room_number: string | null }>;
  tenancy_agreements?: Relation<{
    signed_at: string | null;
    admin_verified_at: string | null;
    admin_rejected_at: string | null;
  }>;
};

type DeviceRow = {
  id: string;
  company_id: string;
  property_id: string | null;
  room_id: string | null;
  provider_lock_id: number | string | null;
  provider_lock_name: string;
  access_scope: "property_entry" | "room_entry";
  has_gateway: boolean | null;
  sync_status: string;
};

type FingerprintGrantRow = {
  id: string;
  device_id: string;
  tenancy_id: string;
  tenant_profile_id: string;
  access_scope: "property_entry" | "room_entry";
  provider_fingerprint_id: number | string | null;
  provider_fingerprint_number: string | null;
  fingerprint_name: string | null;
  enrollment_code: string;
  credential_state: string;
  valid_from: string | null;
  valid_until: string | null;
  last_extension_reference: string | null;
  smart_lock_devices: Relation<DeviceRow>;
};

type FingerprintResult = {
  created: number;
  matched: number;
  extended: number;
  suspended: number;
  revoked: number;
  skipped: number;
  errors: string[];
};

const openStates = [
  "pending_enrollment",
  "active",
  "suspension_due",
  "suspended",
  "revoke_pending",
];
const dayMs = 24 * 60 * 60 * 1000;

function one<T>(value: Relation<T>) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function providerError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "TTLock fingerprint request failed.";
}

function malaysiaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function malaysiaEnd(date: string) {
  return new Date(`${date}T23:59:59+08:00`);
}

function tenancyEnd(tenancy: TenancyRow) {
  const value =
    tenancy.tenancy_end_date ?? tenancy.contract_end ?? tenancy.end_date;
  return value ? malaysiaEnd(value) : null;
}

function accessPeriod(input: {
  tenancy: TenancyRow;
  currentUntil?: string | null;
}) {
  const now = new Date();
  const currentUntil = input.currentUntil
    ? new Date(input.currentUntil)
    : null;
  const base = currentUntil && currentUntil.getTime() > now.getTime()
    ? currentUntil
    : now;
  const requestedUntil = new Date(base.getTime() + 30 * dayMs);
  const contractUntil = tenancyEnd(input.tenancy);
  const validUntil = contractUntil && contractUntil < requestedUntil
    ? contractUntil
    : requestedUntil;

  if (validUntil.getTime() <= now.getTime()) {
    throw new Error("The tenancy has already ended.");
  }

  return {
    validFrom: new Date(now.getTime() - 5 * 60_000),
    validUntil,
  };
}

function tenantAccessName(tenantName: string, scope: DeviceRow["access_scope"], code: string) {
  const label = scope === "property_entry" ? "MAIN" : "ROOM";
  return `DEKEZ ${code} ${label} ${tenantName}`.slice(0, 50);
}

async function loadTenancy(tenancyId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenancies")
    .select(
      "id,company_id,property_id,room_id,status,billing_status,rental_model,checkout_date,check_in_date,tenancy_start_date,contract_start,start_date,tenancy_end_date,contract_end,end_date,tenants(profile_id,full_name,phone),properties(name),rooms(name,room_number)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TenancyRow | null;
}

async function hasVerifiedAgreement(tenancyId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenancy_agreements")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .not("signed_at", "is", null)
    .not("admin_verified_at", "is", null)
    .is("admin_rejected_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

function eligibleTenant(tenancy: TenancyRow | null) {
  const tenant = one(tenancy?.tenants ?? null);
  return Boolean(
    tenancy
      && tenancy.status === "active"
      && !tenancy.checkout_date
      && !["completed", "terminated"].includes(String(tenancy.billing_status))
      && tenant?.profile_id,
  );
}

async function loadTenancyDevices(tenancy: TenancyRow) {
  const admin = createAdminClient();
  const [mainResult, roomResult] = await Promise.all([
    admin
      .from("smart_lock_devices")
      .select("id,company_id,property_id,room_id,provider_lock_id,provider_lock_name,access_scope,has_gateway,sync_status")
      .eq("provider", "ttlock")
      .eq("property_id", tenancy.property_id)
      .eq("access_scope", "property_entry")
      .eq("sync_status", "connected"),
    admin
      .from("smart_lock_devices")
      .select("id,company_id,property_id,room_id,provider_lock_id,provider_lock_name,access_scope,has_gateway,sync_status")
      .eq("provider", "ttlock")
      .eq("room_id", tenancy.room_id)
      .eq("access_scope", "room_entry")
      .eq("sync_status", "connected"),
  ]);
  if (mainResult.error) throw mainResult.error;
  if (roomResult.error) throw roomResult.error;
  return [...(mainResult.data ?? []), ...(roomResult.data ?? [])] as DeviceRow[];
}

async function addAudit(input: {
  grant: Pick<FingerprintGrantRow, "id" | "device_id" | "tenancy_id">;
  action: string;
  oldState?: string | null;
  newState?: string | null;
  performedBy?: string | null;
  paymentSubmissionId?: string | null;
  details?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("smart_lock_fingerprint_audit_logs").insert({
    grant_id: input.grant.id,
    device_id: input.grant.device_id,
    tenancy_id: input.grant.tenancy_id,
    payment_submission_id: input.paymentSubmissionId ?? null,
    action: input.action,
    performed_by: input.performedBy ?? null,
    old_state: input.oldState ?? null,
    new_state: input.newState ?? null,
    details: input.details ?? {},
  });
  if (error && error.code !== "23505") throw error;
}

async function recordProviderError(
  grant: FingerprintGrantRow,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  const admin = createAdminClient();
  const message = providerError(error);
  await admin
    .from("smart_lock_fingerprint_grants")
    .update({ last_error: message, updated_at: new Date().toISOString() })
    .eq("id", grant.id);
  await addAudit({
    grant,
    action: "provider_error",
    oldState: grant.credential_state,
    newState: grant.credential_state,
    details: { ...details, error: message },
  }).catch(() => undefined);
  return message;
}

async function recordWhatsApp(input: {
  tenantProfileId: string;
  phone: string;
  text: string;
  providerMessageId: string | null;
  status: "sent" | "failed";
  errorMessage?: string | null;
}) {
  const admin = createAdminClient();
  const normalizedPhone = normalizePhoneNumber(input.phone);
  const now = new Date().toISOString();
  const { data: conversation } = await admin
    .from("whatsapp_conversations")
    .upsert(
      {
        tenant_id: input.tenantProfileId,
        phone_number: input.phone,
        normalized_phone: normalizedPhone,
        last_message_at: now,
        updated_at: now,
      },
      { onConflict: "normalized_phone" },
    )
    .select("id")
    .single();

  await admin.from("whatsapp_messages").insert({
    conversation_id: conversation?.id ?? null,
    tenant_id: input.tenantProfileId,
    phone_number: input.phone,
    normalized_phone: normalizedPhone,
    direction: "outgoing",
    meta_message_id: input.providerMessageId,
    message_type: "text",
    message_text: input.text,
    processing_status: input.status,
    error_message: input.errorMessage ?? null,
  });
}

export async function prepareFingerprintEnrollment(
  tenancyId: string,
  performedBy: string | null,
) {
  const admin = createAdminClient();
  const tenancy = await loadTenancy(tenancyId);
  if (!tenancy || !eligibleTenant(tenancy)) {
    throw new Error("This tenancy is not eligible for smart-lock access.");
  }
  if (
    tenancy.rental_model !== "monthly_stay" &&
    !(await hasVerifiedAgreement(tenancyId))
  ) {
    throw new Error("The tenancy agreement must be signed and Admin-verified first.");
  }
  const tenant = one(tenancy.tenants);
  if (!tenant?.profile_id || !tenant.phone) {
    throw new Error("The tenant needs an active portal profile and phone number.");
  }

  const devices = await loadTenancyDevices(tenancy);
  if (!devices.some((device) => device.access_scope === "room_entry")) {
    throw new Error("The tenant's room does not have a connected TTLock device.");
  }
  if (!devices.every((device) => device.has_gateway)) {
    throw new Error("Every assigned lock needs a connected TTLock gateway.");
  }

  const { data: existingRows, error: existingError } = await admin
    .from("smart_lock_fingerprint_grants")
    .select("id,device_id,tenancy_id,tenant_profile_id,access_scope,provider_fingerprint_id,provider_fingerprint_number,fingerprint_name,enrollment_code,credential_state,valid_from,valid_until,last_extension_reference")
    .eq("tenancy_id", tenancy.id)
    .in("credential_state", openStates);
  if (existingError) throw existingError;

  const existing = (existingRows ?? []) as FingerprintGrantRow[];
  const enrollmentCode = existing[0]?.enrollment_code
    ?? randomBytes(4).toString("hex").toUpperCase();
  const grants = [...existing];

  for (const device of devices) {
    if (existing.some((grant) => grant.device_id === device.id)) continue;
    const { data: grant, error } = await admin
      .from("smart_lock_fingerprint_grants")
      .insert({
        device_id: device.id,
        company_id: tenancy.company_id,
        property_id: tenancy.property_id,
        room_id: device.access_scope === "room_entry" ? tenancy.room_id : null,
        tenancy_id: tenancy.id,
        tenant_profile_id: tenant.profile_id,
        access_scope: device.access_scope,
        enrollment_code: enrollmentCode,
        credential_state: "pending_enrollment",
        fingerprint_name: tenantAccessName(
          tenant.full_name,
          device.access_scope,
          enrollmentCode,
        ),
      })
      .select("id,device_id,tenancy_id,tenant_profile_id,access_scope,provider_fingerprint_id,provider_fingerprint_number,fingerprint_name,enrollment_code,credential_state,valid_from,valid_until,last_extension_reference")
      .single();
    if (error || !grant) throw error ?? new Error("Fingerprint enrollment could not be prepared.");
    grants.push(grant as FingerprintGrantRow);
  }

  const pendingGrants = grants.filter(
    (grant) => grant.credential_state === "pending_enrollment",
  );
  if (!pendingGrants.length) {
    return {
      grants: grants.length,
      enrollmentCode,
      tenantName: tenant.full_name,
      invitationSent: false,
    };
  }

  const property = one(tenancy.properties);
  const room = one(tenancy.rooms);
  const roomLabel = room?.room_number ?? room?.name ?? "your room";
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://dekez.vercel.app").replace(/\/$/, "");
  const text = [
    tenancy.rental_model === "monthly_stay"
      ? `Hello ${tenant.full_name}, your Sulaman registration and first monthly payment have been verified.`
      : `Hello ${tenant.full_name}, your tenancy agreement has been signed and verified.`,
    `Fingerprint setup is ready for ${property?.name ?? "your property"} ${roomLabel}. Reference: ${enrollmentCode}.`,
    "Your finger must be registered physically at both the main entrance lock and your room lock. WhatsApp and the website do not collect or store your fingerprint image.",
    "Please contact the management team while you are at the locks. Ask them to name each TTLock fingerprint with the reference above, then DEKEZ will match it automatically.",
    "Access is renewed in 30-day cycles after rental payment verification. If rent remains unpaid for 7 days and no payment slip is waiting for verification, entry access may be suspended until payment is verified.",
    `Portal: ${siteUrl}/dashboard`,
  ].join("\n\n");

  let providerMessageId: string | null = null;
  try {
    const response = await sendWhatsAppText(tenant.phone, text);
    providerMessageId = response.messages?.[0]?.id ?? null;
    await recordWhatsApp({
      tenantProfileId: tenant.profile_id,
      phone: tenant.phone,
      text,
      providerMessageId,
      status: "sent",
    });
  } catch (error) {
    await recordWhatsApp({
      tenantProfileId: tenant.profile_id,
      phone: tenant.phone,
      text,
      providerMessageId: null,
      status: "failed",
      errorMessage: providerError(error),
    }).catch(() => undefined);
    throw error;
  }

  const sentAt = new Date().toISOString();
  for (const grant of pendingGrants) {
    await admin
      .from("smart_lock_fingerprint_grants")
      .update({ invitation_sent_at: sentAt, updated_at: sentAt })
      .eq("id", grant.id);
    await addAudit({
      grant,
      action: "enrollment_invited",
      oldState: grant.credential_state,
      newState: grant.credential_state,
      performedBy,
      details: { enrollmentCode, providerMessageId },
    });
  }

  return {
    grants: grants.length,
    enrollmentCode,
    tenantName: tenant.full_name,
    invitationSent: true,
  };
}

export async function syncFingerprintEnrollments(): Promise<FingerprintResult> {
  const result: FingerprintResult = {
    created: 0,
    matched: 0,
    extended: 0,
    suspended: 0,
    revoked: 0,
    skipped: 0,
    errors: [],
  };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("smart_lock_fingerprint_grants")
    .select("id,device_id,tenancy_id,tenant_profile_id,access_scope,provider_fingerprint_id,provider_fingerprint_number,fingerprint_name,enrollment_code,credential_state,valid_from,valid_until,last_extension_reference,smart_lock_devices(id,company_id,property_id,room_id,provider_lock_id,provider_lock_name,access_scope,has_gateway,sync_status)")
    .eq("credential_state", "pending_enrollment")
    .order("created_at");
  if (error) throw error;

  const grants = (data ?? []) as unknown as FingerprintGrantRow[];
  const fingerprintsByDevice = new Map<string, Awaited<ReturnType<typeof listTTLockFingerprints>>>();

  for (const grant of grants) {
    const device = one(grant.smart_lock_devices);
    const lockId = Number(device?.provider_lock_id);
    if (!device?.has_gateway || !Number.isSafeInteger(lockId) || lockId <= 0) {
      result.errors.push(`${device?.provider_lock_name ?? "TTLock"} is not gateway-ready.`);
      continue;
    }

    try {
      let fingerprints = fingerprintsByDevice.get(device.id);
      if (!fingerprints) {
        fingerprints = await listTTLockFingerprints(lockId);
        fingerprintsByDevice.set(device.id, fingerprints);
      }
      const code = grant.enrollment_code.toUpperCase();
      const match = fingerprints.find((fingerprint) =>
        String(fingerprint.fingerprintName ?? "").toUpperCase().includes(code),
      );
      if (!match) {
        result.skipped += 1;
        continue;
      }

      const { data: duplicate } = await admin
        .from("smart_lock_fingerprint_grants")
        .select("id")
        .eq("device_id", device.id)
        .eq("provider_fingerprint_id", match.fingerprintId)
        .neq("id", grant.id)
        .neq("credential_state", "revoked")
        .maybeSingle();
      if (duplicate) {
        throw new Error("This TTLock fingerprint is already linked to another tenancy.");
      }

      const tenancy = await loadTenancy(grant.tenancy_id);
      if (!tenancy || !eligibleTenant(tenancy) || !(await hasVerifiedAgreement(tenancy.id))) {
        result.skipped += 1;
        continue;
      }
      const { validFrom, validUntil } = accessPeriod({ tenancy });
      await changeTTLockFingerprintPeriod({
        lockId,
        fingerprintId: match.fingerprintId,
        validFrom,
        validUntil,
      });
      const syncedAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from("smart_lock_fingerprint_grants")
        .update({
          provider_fingerprint_id: match.fingerprintId,
          provider_fingerprint_number: match.fingerprintNumber,
          fingerprint_name: match.fingerprintName ?? grant.fingerprint_name,
          credential_state: "active",
          valid_from: validFrom.toISOString(),
          valid_until: validUntil.toISOString(),
          enrolled_at: syncedAt,
          last_error: null,
          last_provider_sync_at: syncedAt,
          provider_status: { operation: "matched_and_activated", status: match.status ?? null },
          updated_at: syncedAt,
        })
        .eq("id", grant.id);
      if (updateError) throw updateError;
      await addAudit({
        grant,
        action: "fingerprint_assigned",
        oldState: grant.credential_state,
        newState: "active",
        details: {
          fingerprintId: match.fingerprintId,
          validFrom: validFrom.toISOString(),
          validUntil: validUntil.toISOString(),
        },
      });
      result.matched += 1;
    } catch (syncError) {
      result.errors.push(await recordProviderError(grant, syncError, { operation: "enrollment_sync" }));
    }
  }

  return result;
}

export async function extendFingerprintAccessAfterPayment(input: {
  tenancyId: string;
  paymentSubmissionId: string;
  performedBy?: string | null;
}) {
  const result: FingerprintResult = {
    created: 0,
    matched: 0,
    extended: 0,
    suspended: 0,
    revoked: 0,
    skipped: 0,
    errors: [],
  };
  const tenancy = await loadTenancy(input.tenancyId);
  if (!tenancy || !eligibleTenant(tenancy)) {
    result.skipped += 1;
    return result;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("smart_lock_fingerprint_grants")
    .select("id,device_id,tenancy_id,tenant_profile_id,access_scope,provider_fingerprint_id,provider_fingerprint_number,fingerprint_name,enrollment_code,credential_state,valid_from,valid_until,last_extension_reference,smart_lock_devices(id,company_id,property_id,room_id,provider_lock_id,provider_lock_name,access_scope,has_gateway,sync_status)")
    .eq("tenancy_id", input.tenancyId)
    .in("credential_state", ["active", "suspension_due", "suspended"]);
  if (error) throw error;

  let reactivatedCount = 0;
  for (const grant of (data ?? []) as unknown as FingerprintGrantRow[]) {
    if (grant.last_extension_reference === input.paymentSubmissionId) {
      result.skipped += 1;
      continue;
    }
    const device = one(grant.smart_lock_devices);
    const lockId = Number(device?.provider_lock_id);
    const fingerprintId = Number(grant.provider_fingerprint_id);
    if (
      !device?.has_gateway
      || !Number.isSafeInteger(lockId)
      || lockId <= 0
      || !Number.isSafeInteger(fingerprintId)
      || fingerprintId <= 0
    ) {
      result.errors.push(`${device?.provider_lock_name ?? "TTLock"} has an incomplete fingerprint link.`);
      continue;
    }

    try {
      const { validFrom, validUntil } = accessPeriod({
        tenancy,
        currentUntil: grant.credential_state === "active" ? grant.valid_until : null,
      });
      await changeTTLockFingerprintPeriod({ lockId, fingerprintId, validFrom, validUntil });
      const reactivated = grant.credential_state !== "active";
      const now = new Date().toISOString();
      const { error: updateError } = await admin
        .from("smart_lock_fingerprint_grants")
        .update({
          credential_state: "active",
          valid_from: validFrom.toISOString(),
          valid_until: validUntil.toISOString(),
          reactivated_at: reactivated ? now : null,
          last_extension_reference: input.paymentSubmissionId,
          last_error: null,
          last_provider_sync_at: now,
          provider_status: { operation: reactivated ? "reactivated_after_payment" : "extended_after_payment" },
          updated_at: now,
        })
        .eq("id", grant.id);
      if (updateError) throw updateError;
      await addAudit({
        grant,
        action: reactivated ? "access_reactivated" : "access_extended",
        oldState: grant.credential_state,
        newState: "active",
        performedBy: input.performedBy,
        paymentSubmissionId: input.paymentSubmissionId,
        details: { validUntil: validUntil.toISOString() },
      });
      if (reactivated) reactivatedCount += 1;
      result.extended += 1;
    } catch (extendError) {
      result.errors.push(await recordProviderError(grant, extendError, {
        operation: "payment_extension",
        paymentSubmissionId: input.paymentSubmissionId,
      }));
    }
  }

  const tenant = one(tenancy.tenants);
  if (reactivatedCount && tenant?.profile_id && tenant.phone) {
    const text = `Hello ${tenant.full_name}, your rental payment has been verified. Your main-door and room fingerprint access has been restored for the next access cycle.`;
    try {
      const response = await sendWhatsAppText(tenant.phone, text);
      await recordWhatsApp({
        tenantProfileId: tenant.profile_id,
        phone: tenant.phone,
        text,
        providerMessageId: response.messages?.[0]?.id ?? null,
        status: "sent",
      });
    } catch (noticeError) {
      result.errors.push(providerError(noticeError));
    }
  }

  return result;
}

export async function suspendOverdueFingerprintAccess() {
  const result: FingerprintResult = {
    created: 0,
    matched: 0,
    extended: 0,
    suspended: 0,
    revoked: 0,
    skipped: 0,
    errors: [],
  };
  const admin = createAdminClient();
  const cutoff = malaysiaDate(new Date(Date.now() - 7 * dayMs));
  const { data, error } = await admin
    .from("smart_lock_fingerprint_grants")
    .select("id,device_id,tenancy_id,tenant_profile_id,access_scope,provider_fingerprint_id,provider_fingerprint_number,fingerprint_name,enrollment_code,credential_state,valid_from,valid_until,last_extension_reference,smart_lock_devices(id,company_id,property_id,room_id,provider_lock_id,provider_lock_name,access_scope,has_gateway,sync_status)")
    .eq("credential_state", "active");
  if (error) throw error;

  const grants = (data ?? []) as unknown as FingerprintGrantRow[];
  const byTenancy = new Map<string, FingerprintGrantRow[]>();
  for (const grant of grants) {
    const group = byTenancy.get(grant.tenancy_id) ?? [];
    group.push(grant);
    byTenancy.set(grant.tenancy_id, group);
  }

  const tenancyIds = [...byTenancy.keys()];
  if (!tenancyIds.length) return result;
  const [{ data: tenancyRows, error: tenancyError }, { data: billRows, error: billError }] = await Promise.all([
    admin
      .from("tenancies")
      .select(
        "id,company_id,property_id,room_id,status,billing_status,rental_model,checkout_date,check_in_date,tenancy_start_date,contract_start,start_date,tenancy_end_date,contract_end,end_date,tenants(profile_id,full_name,phone),properties(name),rooms(name,room_number),tenancy_agreements(signed_at,admin_verified_at,admin_rejected_at)",
      )
      .in("id", tenancyIds),
    admin
      .from("rent_bills")
      .select("id,tenancy_id,due_date,amount,paid_amount,status")
      .in("tenancy_id", tenancyIds)
      .is("removed_at", null)
      .lte("due_date", cutoff)
      .not("status", "in", "(draft,paid,cancelled,waived)")
      .order("due_date", { ascending: true }),
  ]);
  if (tenancyError) throw tenancyError;
  if (billError) throw billError;

  const tenancyById = new Map(
    ((tenancyRows ?? []) as unknown as TenancyRow[]).map((tenancy) => [tenancy.id, tenancy]),
  );
  const overdueBillByTenancy = new Map<string, (typeof billRows)[number]>();
  for (const bill of billRows ?? []) {
    if (
      !overdueBillByTenancy.has(bill.tenancy_id)
      && Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0) > 0.005
    ) {
      overdueBillByTenancy.set(bill.tenancy_id, bill);
    }
  }
  const overdueBillIds = [...overdueBillByTenancy.values()].map((bill) => bill.id);
  const { data: pendingRows, error: pendingError } = overdueBillIds.length
    ? await admin
        .from("payment_submissions")
        .select("rent_bill_id")
        .in("rent_bill_id", overdueBillIds)
        .eq("verification_status", "pending_verification")
    : { data: [], error: null };
  if (pendingError) throw pendingError;
  const billsWithPendingSlip = new Set(
    (pendingRows ?? [])
      .map((submission) => submission.rent_bill_id)
      .filter((billId): billId is string => Boolean(billId)),
  );

  for (const [tenancyId, tenancyGrants] of byTenancy) {
    const tenancy = tenancyById.get(tenancyId) ?? null;
    const agreements = Array.isArray(tenancy?.tenancy_agreements)
      ? tenancy.tenancy_agreements
      : tenancy?.tenancy_agreements
        ? [tenancy.tenancy_agreements]
        : [];
    const agreementVerified = tenancy?.rental_model === "monthly_stay" || agreements.some(
      (agreement) =>
        agreement.signed_at
        && agreement.admin_verified_at
        && !agreement.admin_rejected_at,
    );
    if (!tenancy || !eligibleTenant(tenancy) || !agreementVerified) {
      result.skipped += tenancyGrants.length;
      continue;
    }
    const overdueBill = overdueBillByTenancy.get(tenancyId);
    if (!overdueBill) {
      result.skipped += tenancyGrants.length;
      continue;
    }
    if (billsWithPendingSlip.has(overdueBill.id)) {
      result.skipped += tenancyGrants.length;
      continue;
    }

    let tenancySuspended = 0;
    for (const grant of tenancyGrants) {
      const device = one(grant.smart_lock_devices);
      const lockId = Number(device?.provider_lock_id);
      const fingerprintId = Number(grant.provider_fingerprint_id);
      if (
        !device?.has_gateway
        || !Number.isSafeInteger(lockId)
        || lockId <= 0
        || !Number.isSafeInteger(fingerprintId)
        || fingerprintId <= 0
        || !grant.valid_from
      ) {
        result.errors.push(`${device?.provider_lock_name ?? "TTLock"} has an incomplete fingerprint link.`);
        continue;
      }

      try {
        const validFrom = new Date(grant.valid_from);
        const validUntil = new Date(Math.max(Date.now() + 30_000, validFrom.getTime() + 60_000));
        await changeTTLockFingerprintPeriod({ lockId, fingerprintId, validFrom, validUntil });
        const now = new Date().toISOString();
        const { error: updateError } = await admin
          .from("smart_lock_fingerprint_grants")
          .update({
            credential_state: "suspended",
            valid_until: validUntil.toISOString(),
            suspended_at: now,
            last_error: null,
            last_provider_sync_at: now,
            provider_status: {
              operation: "suspended_for_overdue_rent",
              rentBillId: overdueBill.id,
              dueDate: overdueBill.due_date,
            },
            updated_at: now,
          })
          .eq("id", grant.id);
        if (updateError) throw updateError;
        await addAudit({
          grant,
          action: "access_suspended",
          oldState: grant.credential_state,
          newState: "suspended",
          details: {
            rentBillId: overdueBill.id,
            dueDate: overdueBill.due_date,
            outstanding: Number(overdueBill.amount ?? 0) - Number(overdueBill.paid_amount ?? 0),
          },
        });
        tenancySuspended += 1;
        result.suspended += 1;
      } catch (suspendError) {
        result.errors.push(await recordProviderError(grant, suspendError, {
          operation: "overdue_suspension",
          rentBillId: overdueBill.id,
        }));
      }
    }

    const tenant = one(tenancy.tenants);
    if (tenancySuspended && tenant?.profile_id && tenant.phone) {
      const text = `Hello ${tenant.full_name}, your smart-lock fingerprint entry has been suspended because rent due on ${overdueBill.due_date} remains unpaid for 7 days and no payment proof is waiting for verification. Please pay and upload the slip at https://dekez.vercel.app/payments. Access will be restored after Admin verifies the rental payment.`;
      try {
        const response = await sendWhatsAppText(tenant.phone, text);
        await recordWhatsApp({
          tenantProfileId: tenant.profile_id,
          phone: tenant.phone,
          text,
          providerMessageId: response.messages?.[0]?.id ?? null,
          status: "sent",
        });
      } catch (noticeError) {
        result.errors.push(providerError(noticeError));
      }
    }
  }

  return result;
}

export async function revokeFingerprintAccessForTenancy(
  tenancyId: string,
  performedBy?: string | null,
) {
  const result: FingerprintResult = {
    created: 0,
    matched: 0,
    extended: 0,
    suspended: 0,
    revoked: 0,
    skipped: 0,
    errors: [],
  };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("smart_lock_fingerprint_grants")
    .select("id,device_id,tenancy_id,tenant_profile_id,access_scope,provider_fingerprint_id,provider_fingerprint_number,fingerprint_name,enrollment_code,credential_state,valid_from,valid_until,last_extension_reference,smart_lock_devices(id,company_id,property_id,room_id,provider_lock_id,provider_lock_name,access_scope,has_gateway,sync_status)")
    .eq("tenancy_id", tenancyId)
    .in("credential_state", openStates);
  if (error) throw error;

  for (const grant of (data ?? []) as unknown as FingerprintGrantRow[]) {
    const device = one(grant.smart_lock_devices);
    const lockId = Number(device?.provider_lock_id);
    const fingerprintId = Number(grant.provider_fingerprint_id);
    const requestedAt = new Date().toISOString();
    await admin
      .from("smart_lock_fingerprint_grants")
      .update({
        credential_state: "revoke_pending",
        revoke_requested_at: requestedAt,
        updated_at: requestedAt,
      })
      .eq("id", grant.id);
    await addAudit({
      grant,
      action: "checkout_revocation_requested",
      oldState: grant.credential_state,
      newState: "revoke_pending",
      performedBy,
    });

    try {
      if (grant.provider_fingerprint_id !== null) {
        if (
          !device?.has_gateway
          || !Number.isSafeInteger(lockId)
          || lockId <= 0
          || !Number.isSafeInteger(fingerprintId)
          || fingerprintId <= 0
        ) {
          throw new Error(`${device?.provider_lock_name ?? "TTLock"} has an incomplete fingerprint link.`);
        }
        await deleteTTLockFingerprint({ lockId, fingerprintId });
      }
      const revokedAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from("smart_lock_fingerprint_grants")
        .update({
          credential_state: "revoked",
          revoked_at: revokedAt,
          last_error: null,
          last_provider_sync_at: revokedAt,
          provider_status: { operation: "deleted_on_checkout" },
          updated_at: revokedAt,
        })
        .eq("id", grant.id);
      if (updateError) throw updateError;
      await addAudit({
        grant,
        action: "checkout_revoked",
        oldState: "revoke_pending",
        newState: "revoked",
        performedBy,
      });
      result.revoked += 1;
    } catch (revokeError) {
      result.errors.push(await recordProviderError(grant, revokeError, { operation: "checkout_revocation" }));
    }
  }

  if (result.errors.length) {
    throw new Error(result.errors.join(" "));
  }
  return result;
}

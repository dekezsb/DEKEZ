import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeInternationalPhone } from "@/lib/auth/phone";
import {
  releaseCheckedOutTenantPhone,
  type TenantPhoneReleaseStatus,
} from "@/lib/auth/release-tenant-phone";
import {
  revokeTenantLogin,
  revokeTenantSessions,
  type TenantLoginRevokeStatus,
} from "@/lib/auth/tenant-login-access";
import {
  contractEndOf,
  isEarlyCheckout,
  isMissingCheckoutLoginSchema,
} from "@/lib/auth/tenant-login-rules";
import { revokeSmartLockAccessForTenancy } from "@/lib/ttlock/access";
import { revokeEKeyAccessForTenancy } from "@/lib/ttlock/ekey";
import { revokeFingerprintAccessForTenancy } from "@/lib/ttlock/fingerprint";
import { cutRoomMeterPowerAfterCheckout } from "@/lib/ttlock/meter-control";

type Relation<T> = T | T[] | null;

function one<T>(value: Relation<T>) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export type TenantCheckoutFailure =
  | "invalid"
  | "stale"
  | "date_before_checkin"
  | "future_date"
  | "lock"
  | "failed";

export type TenantCheckoutResult =
  | {
      ok: true;
      propertyId: string;
      roomId: string;
      tenancyId: string;
      phoneLoginRelease: TenantPhoneReleaseStatus;
      loginRevoke: TenantLoginRevokeStatus | "via_phone_release";
      earlyCheckout: boolean;
      meterPowerErrors?: string[];
    }
  | { ok: false; reason: TenantCheckoutFailure };

export async function executeTenantCheckout({
  actorProfileId,
  checkoutDate,
  expectedPropertyId,
  expectedRoomId,
  note,
  source,
  tenancyId,
}: {
  actorProfileId: string;
  checkoutDate: string;
  expectedPropertyId?: string;
  expectedRoomId?: string;
  note?: string | null;
  source: "admin_portal" | "management_portal";
  tenancyId: string;
}): Promise<TenantCheckoutResult> {
  if (!tenancyId || !/^\d{4}-\d{2}-\d{2}$/.test(checkoutDate)) {
    return { ok: false, reason: "invalid" };
  }
  if (checkoutDate > malaysiaDate()) {
    return { ok: false, reason: "future_date" };
  }

  const admin = createAdminClient();
  const { data: tenancy, error: tenancyError } = await admin
    .from("tenancies")
    .select(
      "id,company_id,property_id,room_id,tenant_id,status,checkout_date,check_in_date,start_date,tenancy_end_date,contract_end,end_date,properties(name),rooms!tenancies_room_id_fkey(id,name,room_number,status,current_tenancy_id),tenants(full_name,phone,profile_id)",
    )
    .eq("id", tenancyId)
    .eq("status", "active")
    .is("checkout_date", null)
    .maybeSingle();

  const room = one(tenancy?.rooms as Relation<{
    id: string;
    name: string | null;
    room_number: string;
    status: string;
    current_tenancy_id: string | null;
  }>);
  const property = one(tenancy?.properties as Relation<{ name: string }>);
  const tenant = one(tenancy?.tenants as Relation<{
    full_name: string;
    phone: string | null;
    profile_id: string | null;
  }>);

  if (
    tenancyError ||
    !tenancy ||
    !tenancy.property_id ||
    (expectedPropertyId && tenancy.property_id !== expectedPropertyId) ||
    (expectedRoomId && tenancy.room_id !== expectedRoomId) ||
    !room ||
    !property ||
    room.status !== "occupied" ||
    room.current_tenancy_id !== tenancy.id
  ) {
    return { ok: false, reason: "stale" };
  }

  const checkInDate = tenancy.check_in_date ?? tenancy.start_date;
  if (checkInDate && checkoutDate < checkInDate) {
    return { ok: false, reason: "date_before_checkin" };
  }

  try {
    await Promise.all([
      revokeSmartLockAccessForTenancy(tenancy.id),
      revokeFingerprintAccessForTenancy(tenancy.id, actorProfileId),
      revokeEKeyAccessForTenancy(tenancy.id, { reason: "checkout" }),
    ]);
  } catch (error) {
    console.error("Checkout stopped because smart-lock access was not revoked.", {
      tenancyId: tenancy.id,
      error,
    });
    return { ok: false, reason: "lock" };
  }

  // Checkout ends the tenancy immediately (no wait for the contract end).
  // The contract end that applied before checkout is kept so an early
  // checkout stays on record; checkout_date is the actual move-out date.
  const contractEndBeforeCheckout = contractEndOf(tenancy);
  const earlyCheckout = isEarlyCheckout(checkoutDate, contractEndBeforeCheckout);
  const endTenancy = (withRecordColumns: boolean) =>
    admin
      .from("tenancies")
      .update({
        status: "ended",
        checkout_date: checkoutDate,
        billing_status: "completed",
        end_date: checkoutDate,
        contract_end: checkoutDate,
        tenancy_end_date: checkoutDate,
        renewal_status: "not_renewing",
        ...(withRecordColumns
          ? {
              checked_out_at: new Date().toISOString(),
              contract_end_before_checkout: contractEndBeforeCheckout,
            }
          : {}),
      })
      .eq("id", tenancy.id)
      .eq("property_id", tenancy.property_id)
      .eq("room_id", tenancy.room_id)
      .eq("status", "active")
      .select("id,status")
      .maybeSingle();
  let { data: checkedOutTenancy, error: checkoutError } = await endTenancy(true);
  if (checkoutError && isMissingCheckoutLoginSchema(checkoutError)) {
    // Migration 20261124120000 not applied yet: end the tenancy without the
    // two record columns; the original end date is still in the audit log.
    ({ data: checkedOutTenancy, error: checkoutError } = await endTenancy(false));
  }

  if (checkoutError || !checkedOutTenancy || checkedOutTenancy.status !== "ended") {
    console.error("Checkout tenancy update failed.", {
      checkoutError,
      tenancyId: tenancy.id,
    });
    return { ok: false, reason: "failed" };
  }

  const tenantRecordFilter = [
    `tenancy_id.eq.${tenancy.id}`,
    tenancy.tenant_id ? `tenant_id.eq.${tenancy.tenant_id}` : "",
  ]
    .filter(Boolean)
    .join(",");
  const tenantRecordUpdate = admin
    .from("tenant_records")
    .update({ status: "moved_out", contract_end: checkoutDate })
    .eq("property_id", tenancy.property_id)
    .eq("room_id", tenancy.room_id)
    .eq("status", "active");
  const { error: tenantRecordError } = tenantRecordFilter
    ? await tenantRecordUpdate.or(tenantRecordFilter)
    : await tenantRecordUpdate.eq("tenancy_id", tenancy.id);

  const { data: vacatedRoom, error: roomError } = await admin
    .from("rooms")
    .update({ status: "vacant", current_tenancy_id: null })
    .eq("id", tenancy.room_id)
    .eq("property_id", tenancy.property_id)
    .eq("current_tenancy_id", tenancy.id)
    .select("id")
    .maybeSingle();

  if (tenantRecordError || roomError || !vacatedRoom) {
    console.error("Checkout room cleanup failed.", {
      tenantRecordError,
      roomError,
      tenancyId: tenancy.id,
    });
    return { ok: false, reason: "failed" };
  }

  // Prepaid meter: cut power so leftover credit is not used after move-out.
  // Never blocks checkout; failures stay on the meter row for staff.
  const meterPower = await cutRoomMeterPowerAfterCheckout({
    roomId: tenancy.room_id,
    tenancyId: tenancy.id,
    performedBy: actorProfileId,
  }).catch((error) => ({
    switchedOff: 0,
    errors: [error instanceof Error ? error.message : "Meter power off failed."],
  }));
  if (meterPower.errors.length) {
    console.error("Checkout finished but the room meter could not be switched off.", {
      tenancyId: tenancy.id,
      errors: meterPower.errors,
    });
  }

  const phoneLoginRelease = await releaseCheckedOutTenantPhone({
    phone: normalizeInternationalPhone(tenant?.phone ?? ""),
    profileId: tenant?.profile_id ?? null,
    tenancyId: tenancy.id,
    tenantId: tenancy.tenant_id,
  });

  // JV rule: a checked-out tenant can no longer log in. The phone release
  // above already bans and archives the login when the tenant has no other
  // current tenancy; sign out live sessions too. If the release could not
  // run, still disable the login directly (records are kept, never deleted).
  let loginRevoke: TenantLoginRevokeStatus | "via_phone_release" = "via_phone_release";
  if (phoneLoginRelease === "released") {
    await revokeTenantSessions(tenant?.profile_id ?? null);
  } else if (phoneLoginRelease === "kept_for_active_tenancy") {
    loginRevoke = "kept_for_current_tenancy";
  } else {
    loginRevoke = await revokeTenantLogin({
      profileId: tenant?.profile_id ?? null,
      tenancyId: tenancy.id,
      reason: "checkout",
    });
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    company_id: tenancy.company_id,
    actor_profile_id: actorProfileId,
    action: "tenant_checked_out",
    entity_table: "tenancies",
    entity_id: tenancy.id,
    metadata: {
      checkout_date: checkoutDate,
      tenant_id: tenancy.tenant_id,
      tenant_name: tenant?.full_name ?? "Former tenant",
      tenant_phone: tenant?.phone ?? null,
      property_id: tenancy.property_id,
      property_name: property.name,
      room_id: tenancy.room_id,
      room_name: room.room_number || room.name || "Room",
      source,
      note: note?.trim() || null,
      phone_login_release: phoneLoginRelease,
      login_revoke: loginRevoke,
      contract_end_before_checkout: contractEndBeforeCheckout,
      early_checkout: earlyCheckout,
      meter_power_off: meterPower,
    },
  });
  if (auditError) {
    console.error("Checkout completed but its audit event could not be written.", {
      auditError,
      tenancyId: tenancy.id,
    });
  }

  return {
    ok: true,
    propertyId: tenancy.property_id,
    roomId: tenancy.room_id,
    tenancyId: tenancy.id,
    phoneLoginRelease,
    loginRevoke,
    earlyCheckout,
    meterPowerErrors: meterPower.errors,
  };
}

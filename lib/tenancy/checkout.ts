import { createAdminClient } from "@/lib/supabase/admin";
import { revokeSmartLockAccessForTenancy } from "@/lib/ttlock/access";
import { revokeFingerprintAccessForTenancy } from "@/lib/ttlock/fingerprint";

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
      "id,company_id,property_id,room_id,tenant_id,status,checkout_date,check_in_date,start_date,properties(name),rooms!tenancies_room_id_fkey(id,name,room_number,status,current_tenancy_id),tenants(full_name,phone)",
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
    ]);
  } catch (error) {
    console.error("Checkout stopped because smart-lock access was not revoked.", {
      tenancyId: tenancy.id,
      error,
    });
    return { ok: false, reason: "lock" };
  }

  const { data: checkedOutTenancy, error: checkoutError } = await admin
    .from("tenancies")
    .update({
      status: "ended",
      checkout_date: checkoutDate,
      billing_status: "completed",
      end_date: checkoutDate,
      contract_end: checkoutDate,
      tenancy_end_date: checkoutDate,
      renewal_status: "not_renewing",
    })
    .eq("id", tenancy.id)
    .eq("property_id", tenancy.property_id)
    .eq("room_id", tenancy.room_id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (checkoutError || !checkedOutTenancy) {
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
  };
}

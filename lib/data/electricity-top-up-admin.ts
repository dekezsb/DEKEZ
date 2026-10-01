import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasTenantElectricityTopUpAccess } from "@/lib/smart-meter/top-up-access";

type Relation<T> = T | T[] | null;

function one<T>(relation: Relation<T>) {
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export type StaffTopUpCandidate = {
  tenancyId: string;
  roomId: string;
  tenantName: string;
  propertyName: string;
  roomName: string;
  meterNumber: string | null;
  remainingUnits: number | null;
  remainingCredit: number | null;
  unitLabel: string | null;
  connectionStatus: string | null;
  openRequest: { status: string; amount: number } | null;
};

/**
 * Every active tenancy at a property with the tenant electricity top-up
 * feature (see hasTenantElectricityTopUpAccess), for staff who need to
 * submit a top-up slip on a tenant's behalf because the tenant can't do it
 * themselves from their own portal.
 */
export async function getStaffElectricityTopUpCandidates(): Promise<
  StaffTopUpCandidate[]
> {
  const supabase = createAdminClient();

  const { data: tenancies } = await supabase
    .from("tenancies")
    .select(
      "id, tenant_id, room_id, status, billing_status, properties(name, property_code), rooms(name, room_number)",
    )
    .eq("status", "active");

  const eligible = (tenancies ?? []).filter((tenancy) => {
    if (["completed", "terminated"].includes(String(tenancy.billing_status))) {
      return false;
    }
    const property = one(tenancy.properties);
    return hasTenantElectricityTopUpAccess(
      property?.property_code,
      property?.name,
    );
  });

  if (!eligible.length) return [];

  const tenantIds = [...new Set(eligible.map((tenancy) => tenancy.tenant_id))];
  const roomIds = [...new Set(eligible.map((tenancy) => tenancy.room_id))];
  const tenancyIds = eligible.map((tenancy) => tenancy.id);

  const [tenantsResult, metersResult, openRequestsResult] = await Promise.all([
    supabase.from("tenants").select("id, full_name, profile_id").in("id", tenantIds),
    supabase
      .from("smart_meters")
      .select(
        "room_id, meter_number, remaining_units, remaining_credit, unit_label, connection_status",
      )
      .eq("meter_type", "electricity")
      .eq("status", "active")
      .in("room_id", roomIds),
    supabase
      .from("smart_meter_top_up_requests")
      .select("tenancy_id, status, amount")
      .in("tenancy_id", tenancyIds)
      .in("status", ["pending_verification", "approved_awaiting_top_up"]),
  ]);

  const tenantMap = new Map(
    (tenantsResult.data ?? []).map((tenant) => [tenant.id, tenant]),
  );
  const meterMap = new Map(
    (metersResult.data ?? []).map((meter) => [meter.room_id, meter]),
  );
  const openRequestMap = new Map(
    (openRequestsResult.data ?? []).map((request) => [
      request.tenancy_id,
      request,
    ]),
  );

  return eligible
    .map((tenancy) => {
      const property = one(tenancy.properties);
      const room = one(tenancy.rooms);
      const tenant = tenantMap.get(tenancy.tenant_id);
      const meter = meterMap.get(tenancy.room_id);
      const openRequest = openRequestMap.get(tenancy.id);

      return {
        tenancyId: tenancy.id,
        roomId: tenancy.room_id,
        tenantName: tenant?.full_name ?? "Tenant",
        propertyName: property?.name ?? "Property",
        roomName: room?.room_number ?? room?.name ?? "Room",
        meterNumber: meter?.meter_number ?? null,
        remainingUnits: meter ? numberValue(meter.remaining_units) : null,
        remainingCredit: meter ? numberValue(meter.remaining_credit) : null,
        unitLabel: meter?.unit_label ?? null,
        connectionStatus: meter?.connection_status ?? null,
        openRequest: openRequest
          ? {
              status: openRequest.status,
              amount: numberValue(openRequest.amount),
            }
          : null,
      };
    })
    .sort(
      (left, right) =>
        left.propertyName.localeCompare(right.propertyName) ||
        left.roomName.localeCompare(right.roomName),
    );
}

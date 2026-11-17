import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasElectricityTopUpAccess } from "@/lib/smart-meter/top-up-access";

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
 * Active tenancies whose room has a linked TTLock electricity meter.
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

  const active = (tenancies ?? []).filter(
    (tenancy) => !["completed", "terminated"].includes(String(tenancy.billing_status)),
  );
  if (!active.length) return [];

  const tenantIds = [...new Set(active.map((tenancy) => tenancy.tenant_id))];
  const roomIds = [...new Set(active.map((tenancy) => tenancy.room_id))];
  const tenancyIds = active.map((tenancy) => tenancy.id);

  const [tenantsResult, metersResult, openRequestsResult] = await Promise.all([
    supabase.from("tenants").select("id, full_name, profile_id").in("id", tenantIds),
    supabase
      .from("smart_meters")
      .select(
        "room_id, meter_number, remaining_units, remaining_credit, unit_label, connection_status, provider",
      )
      .eq("meter_type", "electricity")
      .eq("provider", "ttlock")
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

  const eligible = active.filter((tenancy) => {
    const property = one(tenancy.properties);
    const meter = meterMap.get(tenancy.room_id);
    return hasElectricityTopUpAccess({
      provider: meter?.provider,
      hasElectricityMeter: Boolean(meter),
    });
  });

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

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProperties, getRooms } from "./organization";
import { createTenantDepositLookup } from "@/lib/payments/current-occupant-deposit";

type DataClient = Awaited<ReturnType<typeof createClient>>;

async function getDataClient(): Promise<DataClient> {
  try {
    return createAdminClient() as DataClient;
  } catch {
    return createClient();
  }
}

export type DepositOutstandingRow = {
  tenantKey: string;
  tenantId: string | null;
  tenantRecordId: string | null;
  tenancyId: string | null;
  tenantName: string;
  tenantPhone: string | null;
  propertyId: string;
  propertyName: string;
  roomId: string;
  roomNumber: string;
  deposit: number;
  depositReceived: number;
  depositOutstanding: number;
};

export type DepositOutstandingSummary = {
  tenantCount: number;
  totalOutstanding: number;
  rows: DepositOutstandingRow[];
};

export async function getDepositOutstandingSummary(): Promise<DepositOutstandingSummary> {
  const [properties, rooms] = await Promise.all([getProperties(), getRooms()]);
  const propertyIds = properties.map((property) => property.id);

  if (!propertyIds.length) {
    return { tenantCount: 0, totalOutstanding: 0, rows: [] };
  }

  const supabase = await getDataClient();
  const [
    tenanciesResult,
    tenantRecordsResult,
    paymentsResult,
    submissionsResult,
  ] = await Promise.all([
    supabase
      .from("tenancies")
      .select("id, tenant_id, property_id, room_id, deposit, status")
      .in("property_id", propertyIds)
      .eq("status", "active"),
    supabase
      .from("tenant_records")
      .select("id, tenant_id, tenancy_id, property_id, room_id, full_name, phone, deposit, status")
      .in("property_id", propertyIds)
      .eq("status", "active"),
    supabase
      .from("payments")
      .select("tenancy_id, room_id, amount")
      .in("property_id", propertyIds)
      .in("category", [
        "deposit",
        "rental_deposit",
        "security_deposit",
        "utility_deposit",
      ])
      .eq("status", "confirmed"),
    supabase
      .from("payment_submissions")
      .select("tenancy_id, tenant_record_id, room_id, amount")
      .in("property_id", propertyIds)
      .in("payment_type", [
        "deposit",
        "rental_deposit",
        "security_deposit",
        "utility_deposit",
      ])
      .eq("verification_status", "verified"),
  ]);

  const tenancies = tenanciesResult.data ?? [];
  const tenantRecords = tenantRecordsResult.data ?? [];
  const tenantIds = Array.from(
    new Set(tenancies.map((tenancy) => tenancy.tenant_id).filter(Boolean)),
  );
  const tenantsResult = tenantIds.length
    ? await supabase
        .from("tenants")
        .select("id, full_name, phone")
        .in("id", tenantIds)
    : { data: [], error: null };

  const propertyById = new Map(
    properties.map((property) => [property.id, property]),
  );
  const tenantById = new Map(
    (tenantsResult.data ?? []).map((tenant) => [tenant.id, tenant]),
  );
  const tenantRecordByRoom = new Map(
    tenantRecords
      .filter((record) => record.room_id)
      .map((record) => [record.room_id as string, record]),
  );
  const tenancyByRoom = new Map(
    tenancies.map((tenancy) => [tenancy.room_id, tenancy]),
  );
  const depositReceivedFor = createTenantDepositLookup(
    paymentsResult.data ?? [],
    submissionsResult.data ?? [],
  );

  const rows: DepositOutstandingRow[] = [];

  for (const room of rooms) {
    const property = propertyById.get(room.property_id);
    const tenancy = tenancyByRoom.get(room.id);
    const tenantRecord = tenantRecordByRoom.get(room.id);

    if (!property || (!tenancy && !tenantRecord)) continue;

    const tenant = tenancy ? tenantById.get(tenancy.tenant_id) : null;
    const deposit = Number(tenancy?.deposit ?? tenantRecord?.deposit ?? 0);
    if (deposit <= 0) continue;

    const depositReceived = depositReceivedFor(
      tenancy?.id ?? tenantRecord?.tenancy_id ?? null,
      tenantRecord?.id ?? null,
    );
    const depositOutstanding = Math.max(deposit - depositReceived, 0);

    if (depositOutstanding <= 0.005) continue;

    const tenantKey = tenancy?.tenant_id ?? tenantRecord?.id;
    if (!tenantKey) continue;

    rows.push({
      tenantKey,
      tenantId: tenancy?.tenant_id ?? tenantRecord?.tenant_id ?? null,
      tenantRecordId: tenantRecord?.id ?? null,
      tenancyId: tenancy?.id ?? tenantRecord?.tenancy_id ?? null,
      tenantName: tenant?.full_name ?? tenantRecord?.full_name ?? "Tenant",
      tenantPhone: tenant?.phone ?? tenantRecord?.phone ?? null,
      propertyId: property.id,
      propertyName: property.name,
      roomId: room.id,
      roomNumber: room.room_number || room.name,
      deposit,
      depositReceived,
      depositOutstanding,
    });
  }

  rows.sort(
    (left, right) =>
      right.depositOutstanding - left.depositOutstanding ||
      left.propertyName.localeCompare(right.propertyName) ||
      left.roomNumber.localeCompare(right.roomNumber, undefined, {
        numeric: true,
      }),
  );

  return {
    tenantCount: rows.length,
    totalOutstanding: rows.reduce(
      (total, row) => total + row.depositOutstanding,
      0,
    ),
    rows,
  };
}

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedDepositPaymentMaps, verifiedDepositPaid } from "@/lib/invoices/deposit-payments";
import { getProperties, getRooms } from "@/lib/data/organization";

type DataClient = Awaited<ReturnType<typeof createClient>>;
type Relation<T> = T | T[] | null;

type ActiveTenancyRow = {
  id: string;
  tenant_id: string | null;
  property_id: string;
  room_id: string;
  deposit: number | string | null;
  check_in_date: string | null;
  start_date: string | null;
  tenancy_start_date: string | null;
  contract_end: string | null;
  end_date: string | null;
  tenancy_end_date: string | null;
  tenants: Relation<{ full_name: string }>;
};

type TenantRecordRow = {
  id: string;
  tenancy_id: string | null;
  room_id: string | null;
  full_name: string;
  deposit: number | string | null;
  contract_start: string | null;
  contract_end: string | null;
};

export type RoomAvailabilityStatus =
  | "vacant"
  | "contract_active"
  | "contract_expired"
  | "maintenance"
  | "reserved"
  | "needs_attention";

export type RoomAvailabilityItem = {
  id: string;
  propertyId: string;
  roomNumber: string;
  roomStatus: string;
  availabilityStatus: RoomAvailabilityStatus;
  tenancyId: string | null;
  tenantName: string | null;
  checkInDate: string | null;
  contractEnd: string | null;
  depositAmount: number;
  depositOutstanding: number;
};

export type RoomAvailabilityProperty = {
  id: string;
  name: string;
  code: string | null;
  area: string | null;
  address: string;
  rooms: RoomAvailabilityItem[];
};

export type RoomAvailabilityMap = {
  properties: RoomAvailabilityProperty[];
  totalRooms: number;
  vacantRooms: number;
  activeContractRooms: number;
  expiredContractRooms: number;
  otherUnavailableRooms: number;
};

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

async function getDataClient(): Promise<DataClient> {
  try {
    return createAdminClient() as DataClient;
  } catch {
    return createClient();
  }
}

function statusForRoom(
  roomStatus: string,
  tenancy: ActiveTenancyRow | null,
  contractEnd: string | null,
  today: string,
): RoomAvailabilityStatus {
  if (roomStatus === "vacant") return "vacant";
  if (roomStatus === "maintenance") return "maintenance";
  if (roomStatus === "reserved") return "reserved";
  if (!tenancy) return "needs_attention";
  if (contractEnd && contractEnd < today) return "contract_expired";
  return "contract_active";
}

const roomCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export async function getRoomAvailabilityMap(): Promise<RoomAvailabilityMap> {
  const [properties, rooms] = await Promise.all([getProperties(), getRooms()]);
  const propertyIds = properties.map((property) => property.id);
  const roomIds = rooms.map((room) => room.id);

  if (!propertyIds.length || !roomIds.length) {
    return {
      properties: properties.map((property) => ({
        id: property.id,
        name: property.name,
        code: property.property_code,
        area: property.area,
        address: property.address,
        rooms: [],
      })),
      totalRooms: 0,
      vacantRooms: 0,
      activeContractRooms: 0,
      expiredContractRooms: 0,
      otherUnavailableRooms: 0,
    };
  }

  const supabase = await getDataClient();
  const [roomLinksResult, tenanciesResult, recordsResult] = await Promise.all([
    supabase
      .from("rooms")
      .select("id,status,current_tenancy_id")
      .in("id", roomIds),
    supabase
      .from("tenancies")
      .select(
        "id,tenant_id,property_id,room_id,deposit,check_in_date,start_date,tenancy_start_date,contract_end,end_date,tenancy_end_date,tenants(full_name)",
      )
      .in("property_id", propertyIds)
      .eq("status", "active")
      .is("checkout_date", null),
    supabase
      .from("tenant_records")
      .select("id,tenancy_id,room_id,full_name,deposit,contract_start,contract_end")
      .in("property_id", propertyIds)
      .eq("status", "active"),
  ]);

  if (roomLinksResult.error || tenanciesResult.error || recordsResult.error) {
    console.error("Room availability could not be loaded.", {
      roomLinksError: roomLinksResult.error,
      tenanciesError: tenanciesResult.error,
      recordsError: recordsResult.error,
    });
    throw new Error("Room availability could not be loaded.");
  }

  const roomLinks = new Map(
    (roomLinksResult.data ?? []).map((room) => [room.id, room]),
  );
  const tenancies = (tenanciesResult.data ?? []) as ActiveTenancyRow[];
  const tenancyById = new Map(tenancies.map((tenancy) => [tenancy.id, tenancy]));
  const tenancyByRoom = new Map(
    tenancies.map((tenancy) => [tenancy.room_id, tenancy]),
  );
  const records = (recordsResult.data ?? []) as TenantRecordRow[];
  const recordByTenancy = new Map(
    records
      .filter((record) => record.tenancy_id)
      .map((record) => [record.tenancy_id as string, record]),
  );
  const recordByRoom = new Map(
    records
      .filter((record) => record.room_id)
      .map((record) => [record.room_id as string, record]),
  );
  const depositMaps = await getVerifiedDepositPaymentMaps(
    supabase,
    tenancies.map((tenancy) => tenancy.id),
    records.map((record) => record.id),
  );
  const today = malaysiaDate();
  const roomsByProperty = new Map<string, RoomAvailabilityItem[]>();

  for (const room of rooms) {
    const roomLink = roomLinks.get(room.id);
    const roomStatus = roomLink?.status ?? room.status;
    const linkedTenancy = roomLink?.current_tenancy_id
      ? tenancyById.get(roomLink.current_tenancy_id) ?? null
      : null;
    const tenancy = linkedTenancy ?? tenancyByRoom.get(room.id) ?? null;
    const tenantRecord = tenancy
      ? recordByTenancy.get(tenancy.id) ?? recordByRoom.get(room.id) ?? null
      : recordByRoom.get(room.id) ?? null;
    const depositAmount = Number(tenancy?.deposit ?? tenantRecord?.deposit ?? 0);
    const depositReceived = tenancy
      ? verifiedDepositPaid(depositMaps, {
          tenancyId: tenancy.id,
          tenantRecordId: tenantRecord?.id ?? null,
          depositAmount,
        })
      : 0;
    const contractEnd =
      tenancy?.contract_end ??
      tenancy?.tenancy_end_date ??
      tenancy?.end_date ??
      tenantRecord?.contract_end ??
      null;
    const tenantName =
      one(tenancy?.tenants ?? null)?.full_name ?? tenantRecord?.full_name ?? null;
    const item: RoomAvailabilityItem = {
      id: room.id,
      propertyId: room.property_id,
      roomNumber: room.room_number || room.name || "Room",
      roomStatus,
      availabilityStatus: statusForRoom(roomStatus, tenancy, contractEnd, today),
      tenancyId: tenancy?.id ?? null,
      tenantName,
      checkInDate:
        tenancy?.check_in_date ??
        tenancy?.tenancy_start_date ??
        tenancy?.start_date ??
        tenantRecord?.contract_start ??
        null,
      contractEnd,
      depositAmount,
      depositOutstanding: Math.max(depositAmount - depositReceived, 0),
    };
    const propertyRooms = roomsByProperty.get(room.property_id) ?? [];
    propertyRooms.push(item);
    roomsByProperty.set(room.property_id, propertyRooms);
  }

  const propertyViews = properties
    .map((property) => ({
      id: property.id,
      name: property.name,
      code: property.property_code,
      area: property.area,
      address: property.address,
      rooms: (roomsByProperty.get(property.id) ?? []).sort((left, right) =>
        roomCollator.compare(left.roomNumber, right.roomNumber),
      ),
    }))
    .sort((left, right) =>
      roomCollator.compare(left.code ?? left.name, right.code ?? right.name),
    );
  const allRooms = propertyViews.flatMap((property) => property.rooms);

  return {
    properties: propertyViews,
    totalRooms: allRooms.length,
    vacantRooms: allRooms.filter((room) => room.availabilityStatus === "vacant").length,
    activeContractRooms: allRooms.filter(
      (room) => room.availabilityStatus === "contract_active",
    ).length,
    expiredContractRooms: allRooms.filter(
      (room) => room.availabilityStatus === "contract_expired",
    ).length,
    otherUnavailableRooms: allRooms.filter((room) =>
      ["maintenance", "reserved", "needs_attention"].includes(
        room.availabilityStatus,
      ),
    ).length,
  };
}

import { getProperties, getRooms, getTenantRecords } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type DataClient = Awaited<ReturnType<typeof createClient>>;

export type RentMapStatus =
  | "paid"
  | "unpaid"
  | "partially_paid"
  | "vacant"
  | "reserved"
  | "maintenance"
  | "no_bill";

export type RentMapRoom = {
  id: string;
  propertyId: string;
  roomNumber: string;
  tenantName: string | null;
  dueDay: number | null;
  outstanding: number;
  billedAmount: number;
  paidAmount: number;
  status: RentMapStatus;
  billStatus: string | null;
};

export type RentMapProperty = {
  id: string;
  name: string;
  code: string | null;
  area: string | null;
  rooms: RentMapRoom[];
};

export type RentDueMap = {
  currentMonth: string;
  currentMonthLabel: string;
  properties: RentMapProperty[];
  totalUnpaid: number;
  totalOutstanding: number;
  totalPaid: number;
  totalVacant: number;
};

async function getDataClient(): Promise<DataClient> {
  try {
    return createAdminClient() as DataClient;
  } catch {
    return createClient();
  }
}

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function relatedOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function dueDayFromDate(value: string | null | undefined) {
  if (!value) return null;
  const day = Number(value.slice(8, 10));
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

const roomNumberCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export async function getRentDueMap(): Promise<RentDueMap> {
  const currentDate = malaysiaDate();
  const currentMonth = `${currentDate.slice(0, 7)}-01`;
  const currentMonthLabel = new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "long",
    year: "numeric",
  }).format(new Date(`${currentMonth}T00:00:00+08:00`));

  const [properties, rooms, tenantRecords] = await Promise.all([
    getProperties(),
    getRooms(),
    getTenantRecords(),
  ]);
  const propertyIds = properties.map((property) => property.id);

  if (!propertyIds.length) {
    return {
      currentMonth,
      currentMonthLabel,
      properties: [],
      totalUnpaid: 0,
      totalOutstanding: 0,
      totalPaid: 0,
      totalVacant: 0,
    };
  }

  const supabase = await getDataClient();
  const [tenanciesResult, billsResult] = await Promise.all([
    supabase
      .from("tenancies")
      .select("id, tenant_id, property_id, room_id, due_day, rent_due_day, status, tenants(full_name)")
      .in("property_id", propertyIds)
      .eq("status", "active"),
    supabase
      .from("rent_bills")
      .select("id, property_id, room_id, due_date, amount, paid_amount, status, created_at")
      .in("property_id", propertyIds)
      .eq("bill_month", currentMonth)
      .order("created_at", { ascending: false }),
  ]);

  if (tenanciesResult.error) {
    throw new Error(`Unable to load active tenancies: ${tenanciesResult.error.message}`);
  }
  if (billsResult.error) {
    throw new Error(`Unable to load current rent bills: ${billsResult.error.message}`);
  }

  const tenantRecordByRoom = new Map(
    tenantRecords
      .filter((tenant) => tenant.room_id && tenant.status === "active")
      .map((tenant) => [tenant.room_id as string, tenant]),
  );
  const tenancyByRoom = new Map(
    (tenanciesResult.data ?? [])
      .filter((tenancy) => tenancy.room_id)
      .map((tenancy) => [tenancy.room_id, tenancy]),
  );
  const billByRoom = new Map<string, NonNullable<typeof billsResult.data>[number]>();

  for (const bill of billsResult.data ?? []) {
    if (
      !bill.room_id
      || billByRoom.has(bill.room_id)
      || ["draft", "cancelled", "voided"].includes(String(bill.status))
    ) {
      continue;
    }
    billByRoom.set(bill.room_id, bill);
  }

  let totalUnpaid = 0;
  let totalOutstanding = 0;
  let totalPaid = 0;
  let totalVacant = 0;

  const roomsByProperty = new Map<string, RentMapRoom[]>();
  for (const room of rooms) {
    const tenancy = tenancyByRoom.get(room.id);
    const tenantRecord = tenantRecordByRoom.get(room.id);
    const tenant = relatedOne(tenancy?.tenants);
    const bill = billByRoom.get(room.id);
    const billedAmount = Number(bill?.amount ?? 0);
    const paidAmount = Number(bill?.paid_amount ?? 0);
    const outstanding = bill ? Math.max(billedAmount - paidAmount, 0) : 0;
    let status: RentMapStatus;

    if (room.status === "vacant") {
      status = "vacant";
      totalVacant += 1;
    } else if (room.status === "reserved") {
      status = "reserved";
    } else if (room.status === "maintenance") {
      status = "maintenance";
    } else if (!bill) {
      status = "no_bill";
    } else if (
      String(bill.status) === "paid"
      || String(bill.status) === "waived"
      || outstanding <= 0
    ) {
      status = "paid";
      totalPaid += 1;
    } else if (
      paidAmount > 0
      || ["partial", "partially_paid"].includes(String(bill.status))
    ) {
      status = "partially_paid";
      totalUnpaid += 1;
      totalOutstanding += outstanding;
    } else {
      status = "unpaid";
      totalUnpaid += 1;
      totalOutstanding += outstanding;
    }

    const roomView: RentMapRoom = {
      id: room.id,
      propertyId: room.property_id,
      roomNumber: room.room_number || room.name,
      tenantName: tenant?.full_name ?? tenantRecord?.full_name ?? null,
      dueDay:
        tenancy?.rent_due_day
        ?? tenancy?.due_day
        ?? tenantRecord?.due_day
        ?? dueDayFromDate(bill?.due_date),
      outstanding,
      billedAmount,
      paidAmount,
      status,
      billStatus: bill?.status ?? null,
    };

    const propertyRooms = roomsByProperty.get(room.property_id) ?? [];
    propertyRooms.push(roomView);
    roomsByProperty.set(room.property_id, propertyRooms);
  }

  const propertyViews = properties.map((property) => ({
    id: property.id,
    name: property.name,
    code: property.property_code,
    area: property.area,
    rooms: (roomsByProperty.get(property.id) ?? []).sort((a, b) =>
      roomNumberCollator.compare(a.roomNumber, b.roomNumber),
    ),
  }));

  return {
    currentMonth,
    currentMonthLabel,
    properties: propertyViews,
    totalUnpaid,
    totalOutstanding,
    totalPaid,
    totalVacant,
  };
}

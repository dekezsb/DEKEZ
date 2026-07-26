import { notFound } from "next/navigation";
import { getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type DataClient = Awaited<ReturnType<typeof createClient>>;

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

export type PropertyRoomView = {
  id: string;
  name: string;
  roomNumber: string;
  status: string;
  monthlyRent: number;
  tenantId: string | null;
  tenantRecordId: string | null;
  tenancyId: string | null;
  tenantName: string | null;
  tenantPhone: string | null;
  identificationNumber: string | null;
  deposit: number;
  dueDay: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  billId: string | null;
  billStatus: string | null;
  billAmount: number;
  amountReceived: number;
  outstanding: number;
  agreementId: string | null;
  agreementStatus: string;
};

export type PropertyDetailsView = {
  property: {
    id: string;
    companyId: string;
    name: string;
    code: string;
    area: string;
    address: string;
    paymentQrUrl: string | null;
  };
  rooms: PropertyRoomView[];
  occupiedCount: number;
  vacantCount: number;
};

export async function getPropertyDetails(propertyId: string): Promise<PropertyDetailsView> {
  const accessible = (await getProperties()).find((property) => property.id === propertyId);
  if (!accessible) {
    notFound();
  }

  const supabase = await getDataClient();
  const billMonth = `${malaysiaDate().slice(0, 7)}-01`;
  const [propertyResult, roomsResult, tenantRecordsResult, tenanciesResult, billsResult] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id, company_id, name, address, property_code, area, location, city, payment_qr_url")
        .eq("id", propertyId)
        .single(),
      supabase
        .from("rooms")
        .select("id, name, room_number, status, monthly_rent, current_tenancy_id")
        .eq("property_id", propertyId)
        .order("room_number", { ascending: true }),
      supabase
        .from("tenant_records")
        .select("id, tenant_id, tenancy_id, room_id, full_name, phone, identification_number, monthly_rent, deposit, due_day, contract_start, contract_end, status")
        .eq("property_id", propertyId)
        .eq("status", "active"),
      supabase
        .from("tenancies")
        .select("id, tenant_id, room_id, monthly_rental, deposit, due_day, rent_due_day, contract_start, contract_end, status, tenants(full_name, phone, identity_number)")
        .eq("property_id", propertyId)
        .eq("status", "active"),
      supabase
        .from("rent_bills")
        .select("id, room_id, tenancy_id, tenant_record_id, amount, paid_amount, status, due_date")
        .eq("property_id", propertyId)
        .eq("bill_month", billMonth),
    ]);

  if (propertyResult.error || !propertyResult.data) {
    notFound();
  }

  const rooms = roomsResult.data ?? [];
  const tenantRecords = tenantRecordsResult.data ?? [];
  const tenancies = tenanciesResult.data ?? [];
  const bills = billsResult.data ?? [];
  const tenancyIds = tenancies.map((tenancy) => tenancy.id);
  const agreementResult = tenancyIds.length
    ? await supabase
        .from("tenancy_agreements")
        .select("id, tenancy_id, status, created_at")
        .in("tenancy_id", tenancyIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  const agreements = agreementResult.data ?? [];

  const tenantRecordByRoom = new Map(tenantRecords.map((tenant) => [tenant.room_id, tenant]));
  const tenancyByRoom = new Map(tenancies.map((tenancy) => [tenancy.room_id, tenancy]));
  const billByRoom = new Map(bills.map((bill) => [bill.room_id, bill]));
  const agreementByTenancy = new Map<string, (typeof agreements)[number]>();
  for (const agreement of agreements) {
    if (!agreementByTenancy.has(agreement.tenancy_id)) {
      agreementByTenancy.set(agreement.tenancy_id, agreement);
    }
  }

  const roomViews = rooms.map((room): PropertyRoomView => {
    const tenantRecord = tenantRecordByRoom.get(room.id);
    const tenancy = tenancyByRoom.get(room.id);
    const canonicalTenant = relatedOne(tenancy?.tenants);
    const bill = billByRoom.get(room.id);
    const tenancyId = tenancy?.id ?? tenantRecord?.tenancy_id ?? room.current_tenancy_id ?? null;
    const agreement = tenancyId ? agreementByTenancy.get(tenancyId) : null;
    const billAmount = Number(bill?.amount ?? tenancy?.monthly_rental ?? tenantRecord?.monthly_rent ?? room.monthly_rent ?? 0);
    const amountReceived = Number(bill?.paid_amount ?? 0);

    return {
      id: room.id,
      name: room.name ?? room.room_number,
      roomNumber: room.room_number ?? room.name,
      status: room.status,
      monthlyRent: Number(tenancy?.monthly_rental ?? tenantRecord?.monthly_rent ?? room.monthly_rent ?? 0),
      tenantId: tenancy?.tenant_id ?? tenantRecord?.tenant_id ?? null,
      tenantRecordId: tenantRecord?.id ?? null,
      tenancyId,
      tenantName: canonicalTenant?.full_name ?? tenantRecord?.full_name ?? null,
      tenantPhone: canonicalTenant?.phone ?? tenantRecord?.phone ?? null,
      identificationNumber: canonicalTenant?.identity_number ?? tenantRecord?.identification_number ?? null,
      deposit: Number(tenancy?.deposit ?? tenantRecord?.deposit ?? 0),
      dueDay: tenancy?.rent_due_day ?? tenancy?.due_day ?? tenantRecord?.due_day ?? null,
      contractStart: tenancy?.contract_start ?? tenantRecord?.contract_start ?? null,
      contractEnd: tenancy?.contract_end ?? tenantRecord?.contract_end ?? null,
      billId: bill?.id ?? null,
      billStatus: bill?.status ?? null,
      billAmount,
      amountReceived,
      outstanding: Math.max(billAmount - amountReceived, 0),
      agreementId: agreement?.id ?? null,
      agreementStatus: agreement?.status ?? "not_generated",
    };
  });

  const property = propertyResult.data;
  const fallbackCode = property.name.includes("-") ? property.name.split("-")[0].trim() : "";

  return {
    property: {
      id: property.id,
      companyId: property.company_id,
      name: property.name,
      code: property.property_code ?? fallbackCode,
      area: property.area ?? property.location ?? property.city ?? "",
      address: property.address ?? "",
      paymentQrUrl: property.payment_qr_url,
    },
    rooms: roomViews,
    occupiedCount: roomViews.filter((room) => room.status === "occupied").length,
    vacantCount: roomViews.filter((room) => room.status === "vacant").length,
  };
}

export async function getRoomDetails(propertyId: string, roomId: string) {
  const propertyDetails = await getPropertyDetails(propertyId);
  const room = propertyDetails.rooms.find((item) => item.id === roomId);
  if (!room) {
    notFound();
  }

  const supabase = await getDataClient();
  const [billsResult, paymentsResult, maintenanceResult] = await Promise.all([
    supabase
      .from("rent_bills")
      .select("id, bill_month, due_date, amount, paid_amount, status")
      .eq("room_id", roomId)
      .order("bill_month", { ascending: false }),
    supabase
      .from("payments")
      .select("id, amount, payment_date, payment_method, reference_number, status, verified_at")
      .eq("room_id", roomId)
      .order("payment_date", { ascending: false }),
    supabase
      .from("maintenance_tickets")
      .select("id, ticket_number, category, description, urgency, status, created_at, completed_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false }),
  ]);

  return {
    property: propertyDetails.property,
    room,
    bills: billsResult.data ?? [],
    payments: paymentsResult.data ?? [],
    maintenance: maintenanceResult.data ?? [],
  };
}

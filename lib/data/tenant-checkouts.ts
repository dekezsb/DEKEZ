import { createAdminClient } from "@/lib/supabase/admin";

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

export function currentCheckoutMonth() {
  return malaysiaDate().slice(0, 7);
}

export function normalizeCheckoutMonth(value?: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "")
    ? String(value)
    : currentCheckoutMonth();
}

export type TenantCheckoutCandidate = {
  tenancyId: string;
  checkInDate: string;
  propertyName: string;
  roomName: string;
  tenantName: string;
  tenantPhone: string | null;
};

export async function getTenantCheckoutCandidates(): Promise<
  TenantCheckoutCandidate[]
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenancies")
    .select(
      "id,check_in_date,start_date,rooms(id,name,room_number,status,current_tenancy_id),properties(name),tenants(full_name,phone)",
    )
    .eq("status", "active")
    .is("checkout_date", null);

  if (error) {
    console.error("Active checkout candidates could not be loaded.", error);
    return [];
  }

  return (data ?? [])
    .flatMap((row) => {
      const room = one(row.rooms as Relation<{
        id: string;
        name: string | null;
        room_number: string;
        status: string;
        current_tenancy_id: string | null;
      }>);
      const property = one(row.properties as Relation<{ name: string }>);
      const tenant = one(row.tenants as Relation<{
        full_name: string;
        phone: string | null;
      }>);

      if (
        !room ||
        !property ||
        !tenant ||
        room.status !== "occupied" ||
        room.current_tenancy_id !== row.id
      ) {
        return [];
      }

      return [{
        tenancyId: row.id,
        checkInDate: row.check_in_date ?? row.start_date,
        propertyName: property.name,
        roomName: room.room_number || room.name || "Room",
        tenantName: tenant.full_name,
        tenantPhone: tenant.phone,
      }];
    })
    .sort((left, right) =>
      `${left.propertyName} ${left.roomName}`.localeCompare(
        `${right.propertyName} ${right.roomName}`,
        "en",
        { numeric: true },
      ),
    );
}

export type TenantCheckoutHistoryItem = {
  tenancyId: string;
  checkoutDate: string;
  tenantName: string;
  tenantPhone: string | null;
  propertyName: string;
  roomName: string;
  performedBy: string;
  recordedAt: string | null;
  source: string;
  note: string | null;
};

type AuditMetadata = {
  checkout_date?: string;
  tenant_name?: string;
  tenant_phone?: string | null;
  property_name?: string;
  room_name?: string;
  source?: string;
  note?: string | null;
};

type CheckoutAuditRow = {
  entity_id: string | null;
  actor_profile_id: string | null;
  metadata: AuditMetadata | null;
  created_at: string;
};

export async function getTenantCheckoutHistory(
  requestedMonth?: string,
): Promise<{ month: string; items: TenantCheckoutHistoryItem[] }> {
  const month = normalizeCheckoutMonth(requestedMonth);
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = nextMonthDate.toISOString().slice(0, 10);
  const startDate = `${month}-01`;
  const admin = createAdminClient();

  const { data: tenancyRows, error: tenancyError } = await admin
    .from("tenancies")
    .select(
      "id,checkout_date,properties(name),rooms(name,room_number),tenants(full_name,phone)",
    )
    .gte("checkout_date", startDate)
    .lt("checkout_date", nextMonth)
    .order("checkout_date", { ascending: false });

  if (tenancyError) {
    console.error("Tenant checkout history could not be loaded.", tenancyError);
    return { month, items: [] };
  }

  const tenancyIds = (tenancyRows ?? []).map((row) => row.id);
  const { data: auditRows, error: auditError } = tenancyIds.length
    ? await admin
        .from("audit_logs")
        .select("entity_id,actor_profile_id,metadata,created_at")
        .eq("action", "tenant_checked_out")
        .in("entity_id", tenancyIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  if (auditError) {
    console.error("Tenant checkout audit details could not be loaded.", auditError);
  }

  const normalizedAuditRows = (auditRows ?? []) as CheckoutAuditRow[];
  const latestAuditByTenancy = new Map<string, CheckoutAuditRow>();
  for (const row of normalizedAuditRows) {
    if (row.entity_id && !latestAuditByTenancy.has(row.entity_id)) {
      latestAuditByTenancy.set(row.entity_id, row);
    }
  }

  const actorIds = [
    ...new Set(
      normalizedAuditRows
        .map((row) => row.actor_profile_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: actorRows } = actorIds.length
    ? await admin.from("profiles").select("id,full_name").in("id", actorIds)
    : { data: [] };
  const actorNames = new Map(
    (actorRows ?? []).map((profile) => [
      profile.id,
      profile.full_name || "Staff account",
    ]),
  );

  const items = (tenancyRows ?? []).map((row) => {
    const property = one(row.properties as Relation<{ name: string }>);
    const room = one(row.rooms as Relation<{
      name: string | null;
      room_number: string;
    }>);
    const tenant = one(row.tenants as Relation<{
      full_name: string;
      phone: string | null;
    }>);
    const audit = latestAuditByTenancy.get(row.id);
    const metadata = (audit?.metadata ?? {}) as AuditMetadata;

    return {
      tenancyId: row.id,
      checkoutDate: row.checkout_date as string,
      tenantName: metadata.tenant_name ?? tenant?.full_name ?? "Former tenant",
      tenantPhone: metadata.tenant_phone ?? tenant?.phone ?? null,
      propertyName: metadata.property_name ?? property?.name ?? "Property",
      roomName:
        metadata.room_name ?? room?.room_number ?? room?.name ?? "Room",
      performedBy: audit?.actor_profile_id
        ? actorNames.get(audit.actor_profile_id) ?? "Staff account"
        : "Older record (staff not recorded)",
      recordedAt: audit?.created_at ?? null,
      source: metadata.source ?? "historical_record",
      note: metadata.note ?? null,
    } satisfies TenantCheckoutHistoryItem;
  });

  return { month, items };
}

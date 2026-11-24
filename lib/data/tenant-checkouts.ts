import { createAdminClient } from "@/lib/supabase/admin";
import {
  isEarlyCheckout,
  isMissingCheckoutLoginSchema,
} from "@/lib/auth/tenant-login-rules";

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
      "id,check_in_date,start_date,rooms!tenancies_room_id_fkey(id,name,room_number,status,current_tenancy_id),properties(name),tenants(full_name,phone)",
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
  needsPhoneRelease: boolean;
  /** Contract end as it stood before checkout (null for older records). */
  contractEnd: string | null;
  earlyCheckout: boolean;
};

type AuditMetadata = {
  checkout_date?: string;
  tenant_name?: string;
  tenant_phone?: string | null;
  property_name?: string;
  room_name?: string;
  source?: string;
  note?: string | null;
  contract_end_before_checkout?: string | null;
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

  type HistoryRow = {
    id: string;
    checkout_date: string;
    contract_end_before_checkout?: string | null;
    properties: unknown;
    rooms: unknown;
    tenants: unknown;
  };
  const historyQuery = (withRecordColumns: boolean) =>
    admin
      .from("tenancies")
      .select(
        (withRecordColumns
          ? "id,checkout_date,contract_end_before_checkout,properties(name),rooms!tenancies_room_id_fkey(name,room_number),tenants(full_name,phone,profile_id)"
          : "id,checkout_date,properties(name),rooms!tenancies_room_id_fkey(name,room_number),tenants(full_name,phone,profile_id)") as string,
      )
      .gte("checkout_date", startDate)
      .lt("checkout_date", nextMonth)
      .order("checkout_date", { ascending: false })
      .returns<HistoryRow[]>();
  let { data: tenancyRows, error: tenancyError } = await historyQuery(true);
  if (tenancyError && isMissingCheckoutLoginSchema(tenancyError)) {
    ({ data: tenancyRows, error: tenancyError } = await historyQuery(false));
  }

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
      profile_id: string | null;
    }>);
    const audit = latestAuditByTenancy.get(row.id);
    const metadata = (audit?.metadata ?? {}) as AuditMetadata;
    const contractEnd =
      ((row as { contract_end_before_checkout?: string | null })
        .contract_end_before_checkout ??
        metadata.contract_end_before_checkout ??
        null);

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
      needsPhoneRelease: Boolean(tenant?.profile_id && tenant.phone),
      contractEnd,
      earlyCheckout: isEarlyCheckout(row.checkout_date as string, contractEnd),
    } satisfies TenantCheckoutHistoryItem;
  });

  return { month, items };
}

export type RoomCheckoutHistoryItem = {
  tenancyId: string;
  tenantName: string;
  checkInDate: string | null;
  checkoutDate: string;
  contractEnd: string | null;
  earlyCheckout: boolean;
};

/** Ended tenancies of one room: actual checkout date vs the original contract end. */
export async function getRoomCheckoutHistory(
  roomId: string,
): Promise<RoomCheckoutHistoryItem[]> {
  const admin = createAdminClient();
  type RoomHistoryRow = {
    id: string;
    check_in_date: string | null;
    start_date: string | null;
    checkout_date: string;
    contract_end_before_checkout?: string | null;
    tenants: unknown;
  };
  const roomQuery = (withRecordColumns: boolean) =>
    admin
      .from("tenancies")
      .select(
        (withRecordColumns
          ? "id,check_in_date,start_date,checkout_date,contract_end_before_checkout,tenants(full_name)"
          : "id,check_in_date,start_date,checkout_date,tenants(full_name)") as string,
      )
      .eq("room_id", roomId)
      .not("checkout_date", "is", null)
      .order("checkout_date", { ascending: false })
      .limit(20)
      .returns<RoomHistoryRow[]>();
  let { data, error } = await roomQuery(true);
  if (error && isMissingCheckoutLoginSchema(error)) {
    ({ data, error } = await roomQuery(false));
  }
  if (error || !data?.length) {
    if (error) console.error("Room checkout history could not be loaded.", error);
    return [];
  }
  const ids = data.map((row) => row.id as string);
  const { data: audits } = await admin
    .from("audit_logs")
    .select("entity_id,metadata,created_at")
    .eq("action", "tenant_checked_out")
    .in("entity_id", ids)
    .order("created_at", { ascending: false });
  const auditEnd = new Map<string, string | null>();
  for (const audit of audits ?? []) {
    const id = audit.entity_id as string | null;
    if (id && !auditEnd.has(id)) {
      auditEnd.set(
        id,
        ((audit.metadata ?? {}) as AuditMetadata).contract_end_before_checkout ?? null,
      );
    }
  }
  return data.map((row) => {
    const tenant = one(row.tenants as Relation<{ full_name: string }>);
    const contractEnd =
      (row as { contract_end_before_checkout?: string | null })
        .contract_end_before_checkout ??
      auditEnd.get(row.id as string) ??
      null;
    const checkoutDate = row.checkout_date as string;
    return {
      tenancyId: row.id as string,
      tenantName: tenant?.full_name ?? "Former tenant",
      checkInDate: (row.check_in_date ?? row.start_date ?? null) as string | null,
      checkoutDate,
      contractEnd,
      earlyCheckout: isEarlyCheckout(checkoutDate, contractEnd),
    };
  });
}

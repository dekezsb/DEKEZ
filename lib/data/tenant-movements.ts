import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaDateString } from "@/lib/data/rent-due";

type Relation<T> = T | T[] | null;
const one = <T,>(value: Relation<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;

export type MovementProperty = { id: string; name: string };
export type MovementRow = {
  id: string;
  property_id: string;
  status: string;
  check_in_date: string | null;
  start_date: string;
  checkout_date: string | null;
  tenants: Relation<{ full_name: string }>;
  rooms: Relation<{ name: string | null; room_number: string }>;
};
type CheckoutMetadata = {
  tenant_name?: string; tenant?: string;
  property_name?: string; property?: string;
  room_name?: string; room?: string;
  note?: string;
};
export type MovementAudit = {
  entity_id: string | null;
  actor_profile_id: string | null;
  created_at: string;
  metadata: CheckoutMetadata | null;
};
export type TenantMovement = {
  id: string; date: string; tenantName: string; propertyName: string;
  roomName: string; note: string | null; recordedBy: string | null; recordedAt: string | null;
};

export function movementMonth(value: string | undefined, today = malaysiaDateString()) {
  return /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value ?? "") ? value! : today.slice(0, 7);
}

export function adjacentMovementMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

// A move retaining the original check-in date is not a new arrival. Do not use
// created_at, contract renewal dates, room updates or payment dates as check-in.
export function buildTenantMovements(
  rows: MovementRow[], properties: MovementProperty[], audits: MovementAudit[],
  actors: Map<string, string>, month: string, today: string,
) {
  const propertyNames = new Map(properties.map((p) => [p.id, p.name]));
  const latestAudit = new Map<string, MovementAudit>();
  for (const audit of [...audits].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (audit.entity_id && !latestAudit.has(audit.entity_id)) latestAudit.set(audit.entity_id, audit);
  }
  const checkIns: TenantMovement[] = [];
  const checkOuts: TenantMovement[] = [];
  const seen = new Set<string>();
  const inMonth = (date: string | null) => Boolean(date && date.slice(0, 7) === month && date <= today);
  for (const row of rows) {
    if (!propertyNames.has(row.property_id) || seen.has(row.id) || !["active", "ended"].includes(row.status)) continue;
    seen.add(row.id);
    const audit = latestAudit.get(row.id);
    const metadata = audit?.metadata;
    const room = one(row.rooms);
    const base = {
      id: row.id,
      tenantName: metadata?.tenant_name ?? metadata?.tenant ?? one(row.tenants)?.full_name ?? "Former tenant",
      propertyName: propertyNames.get(row.property_id)!,
      roomName: room?.room_number ?? room?.name ?? "Room not recorded",
      note: null, recordedBy: null, recordedAt: null,
    };
    const checkIn = row.check_in_date ?? row.start_date;
    if (inMonth(checkIn)) checkIns.push({ ...base, date: checkIn });
    if (inMonth(row.checkout_date)) checkOuts.push({
      ...base, date: row.checkout_date!,
      propertyName: metadata?.property_name ?? metadata?.property ?? base.propertyName,
      roomName: metadata?.room_name ?? metadata?.room ?? base.roomName,
      note: metadata?.note ?? null,
      recordedBy: audit?.actor_profile_id ? actors.get(audit.actor_profile_id) ?? "Staff account" : null,
      recordedAt: audit?.created_at ?? null,
    });
  }
  const chronological = (a: TenantMovement, b: TenantMovement) => a.date.localeCompare(b.date) || `${a.propertyName} ${a.roomName}`.localeCompare(`${b.propertyName} ${b.roomName}`, "en", { numeric: true });
  return { checkIns: checkIns.sort(chronological), checkOuts: checkOuts.sort(chronological) };
}

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error("Tenant movement records could not be loaded");
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 500) return rows;
  }
}

export async function getMonthlyTenantMovements(requestedMonth?: string, requestedProperty?: string) {
  await requireRole(["super_admin", "admin"], { module: "properties", level: "view" });
  const today = malaysiaDateString();
  const month = movementMonth(requestedMonth, today);
  let properties: MovementProperty[] = [];
  let propertyId = "";
  try {
    // Resolve the allowed properties with the signed-in user's RLS before any
    // privileged historical reads. Never accept a query-string ID as authority.
    const client = await createClient();
    properties = await allRows<MovementProperty>((from, to) => client.from("properties").select("id,name").order("id").range(from, to));
    properties.sort((a, b) => a.name.localeCompare(b.name));
    propertyId = properties.some((p) => p.id === requestedProperty) ? requestedProperty! : "";
    const selected = propertyId ? properties.filter((p) => p.id === propertyId) : properties;
    if (!selected.length) return { month, today, properties, propertyId, checkIns: [], checkOuts: [], error: null };
    const db = createAdminClient();
    const start = `${month}-01`;
    const end = `${adjacentMovementMonth(month, 1)}-01`;
    const rows = await allRows<MovementRow>((from, to) => db.from("tenancies")
      .select("id,property_id,status,check_in_date,start_date,checkout_date,tenants(full_name),rooms!tenancies_room_id_fkey(name,room_number)")
      .in("property_id", selected.map((p) => p.id)).in("status", ["active", "ended"])
      .or(`and(check_in_date.gte.${start},check_in_date.lt.${end}),and(check_in_date.is.null,start_date.gte.${start},start_date.lt.${end}),and(checkout_date.gte.${start},checkout_date.lt.${end})`)
      .order("id").range(from, to));
    const audits: MovementAudit[] = [];
    for (let offset = 0; offset < rows.length; offset += 200) {
      audits.push(...await allRows<MovementAudit>((from, to) => db.from("audit_logs")
        .select("entity_id,actor_profile_id,metadata,created_at")
        .in("entity_id", rows.slice(offset, offset + 200).map((r) => r.id))
        .in("action", ["tenant_checked_out", "tenancy_checked_out"])
        .order("created_at", { ascending: false }).order("id").range(from, to)));
    }
    const actorIds = [...new Set(audits.flatMap((a) => a.actor_profile_id ? [a.actor_profile_id] : []))];
    const actors = new Map<string, string>();
    for (let offset = 0; offset < actorIds.length; offset += 200) {
      const batch = await allRows<{ id: string; full_name: string | null }>((from, to) => db.from("profiles")
        .select("id,full_name").in("id", actorIds.slice(offset, offset + 200)).order("id").range(from, to));
      for (const actor of batch) actors.set(actor.id, actor.full_name || "Staff account");
    }
    return { month, today, properties, propertyId, ...buildTenantMovements(rows, selected, audits, actors, month, today), error: null };
  } catch {
    // Never disguise a failed/partial query as a successful zero-activity month.
    console.error("Monthly tenant movement report could not be loaded.");
    return { month, today, properties, propertyId, checkIns: [], checkOuts: [], error: "The monthly records could not be loaded. Please refresh and try again." };
  }
}

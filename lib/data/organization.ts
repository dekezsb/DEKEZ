import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserRole } from "@/lib/auth/session";
import type { AppRole } from "@/lib/auth/roles";

export type CompanySummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
};

export type PropertySummary = {
  id: string;
  company_id: string;
  name: string;
  address: string;
  property_code: string | null;
  area: string | null;
  is_commercial: boolean;
  payment_qr_url: string | null;
  notes: string | null;
};

export type PropertyOwnerOption = {
  company_id: string;
  id: string;
  name: string;
};

export type PropertyOwnerAssignment = {
  owner_id: string;
  property_id: string;
};

export type RoomSummary = {
  id: string;
  company_id: string;
  property_id: string;
  name: string;
  status: "vacant" | "occupied" | "maintenance" | "reserved";
  monthly_rent: number;
  description: string | null;
};

export type UnitSummary = {
  id: string;
  company_id: string | null;
  property_id: string;
  name: string;
  floor: string | null;
  notes: string | null;
};

export type TenantRecordSummary = {
  id: string;
  company_id: string | null;
  property_id: string;
  unit_id: string | null;
  room_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  identification_number: string | null;
  monthly_rent: number;
  deposit: number;
  contract_start: string | null;
  contract_end: string | null;
  due_day: number | null;
  status: string;
  notes: string | null;
};

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

async function getDataClient() {
  return createClient();
}

async function getCurrentScope() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, role: null as AppRole | null };
  }

  return { user, role: await resolveUserRole(user) };
}

async function getAccessibleCompanyIds() {
  const { user, role } = await getCurrentScope();

  if (!user) {
    return [];
  }

  if (role === "super_admin" || role === "admin") {
    return null;
  }

  const supabase = await getDataClient();
  const { data } = await supabase
    .from("company_users")
    .select("company_id")
    .or(`user_id.eq.${user.id},profile_id.eq.${user.id}`);
  const companyIds = new Set((data ?? []).map((item) => item.company_id).filter(Boolean) as string[]);

  const { data: ownedCompanies } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", user.id);

  for (const company of ownedCompanies ?? []) {
    if (company.id) {
      companyIds.add(company.id);
    }
  }

  return Array.from(companyIds);
}

async function getAccessiblePropertyIds() {
  const { user, role } = await getCurrentScope();

  if (!user) {
    return [];
  }

  if (role === "super_admin" || role === "admin") {
    return null;
  }

  const supabase = await getDataClient();
  const propertyIds = new Set<string>();
  const companyIds = await getAccessibleCompanyIds();

  if (companyIds === null) {
    return null;
  }

  if (role !== "owner" && companyIds.length) {
    const { data: companyProperties } = await supabase
      .from("properties")
      .select("id")
      .in("company_id", companyIds);

    for (const property of companyProperties ?? []) {
      if (property.id) {
        propertyIds.add(property.id);
      }
    }
  }

  const { data: ownedProperties } = await supabase
    .from("property_owners")
    .select("property_id")
    .eq("owner_id", user.id)
    .is("end_date", null);

  for (const property of ownedProperties ?? []) {
    if (property.property_id) {
      propertyIds.add(property.property_id);
    }
  }

  return Array.from(propertyIds);
}

export async function getPropertyOwnerData(properties: PropertySummary[]) {
  if (!properties.length) {
    return {
      assignments: [] as PropertyOwnerAssignment[],
      owners: [] as PropertyOwnerOption[],
    };
  }

  const supabase = await getDataClient();
  const propertyIds = properties.map((property) => property.id);
  const companyIds = Array.from(new Set(properties.map((property) => property.company_id)));

  const [{ data: assignments }, { data: memberships }] = await Promise.all([
    supabase
      .from("property_owners")
      .select("property_id, owner_id")
      .in("property_id", propertyIds)
      .is("end_date", null),
    supabase
      .from("company_users")
      .select("company_id, profile_id, user_id")
      .in("company_id", companyIds)
      .eq("role", "owner")
      .eq("status", "active"),
  ]);

  const ownerMemberships = (memberships ?? [])
    .map((membership) => ({
      company_id: membership.company_id as string,
      id: (membership.user_id ?? membership.profile_id) as string,
    }))
    .filter((membership) => membership.company_id && membership.id);
  const ownerIds = Array.from(new Set(ownerMemberships.map((membership) => membership.id)));

  if (!ownerIds.length) {
    return {
      assignments: (assignments ?? []) as PropertyOwnerAssignment[],
      owners: [] as PropertyOwnerOption[],
    };
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds)
    .eq("role", "owner");
  const profileNames = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      profile.full_name?.trim() || "Owner account",
    ]),
  );

  return {
    assignments: (assignments ?? []) as PropertyOwnerAssignment[],
    owners: ownerMemberships
      .filter((membership) => profileNames.has(membership.id))
      .map((membership) => ({
        ...membership,
        name: profileNames.get(membership.id) ?? "Owner account",
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function getUserCompanies() {
  const companyIds = await getAccessibleCompanyIds();
  const { role } = await getCurrentScope();
  let supabase = await getDataClient();

  if (role === "super_admin") {
    try {
      supabase = createAdminClient();
    } catch {
      // The authenticated client remains available for local setups without a service key.
    }
  }

  let query = supabase
    .from("companies")
    .select("id, name, email, phone, status, created_at")
    .order("created_at", { ascending: true });

  if (companyIds !== null) {
    if (!companyIds.length) {
      return [];
    }
    query = query.in("id", companyIds);
  }

  const { data, error } = await query;

  if (error) {
    return [];
  }

  return (data ?? []) as CompanySummary[];
}

export async function getFirstCompany() {
  const companies = await getUserCompanies();
  return companies[0] ?? null;
}

export async function getProperties() {
  const propertyIds = await getAccessiblePropertyIds();
  const supabase = await getDataClient();
  let query = supabase
    .from("properties")
    .select("id, company_id, name, address, property_code, area, is_commercial, payment_qr_url, notes")
    .order("created_at", { ascending: true });

  if (propertyIds !== null) {
    if (!propertyIds.length) {
      return [];
    }
    query = query.in("id", propertyIds);
  }

  const { data, error } = await query;

  if (error) {
    return [];
  }

  return (data ?? []) as PropertySummary[];
}

export async function getUnits() {
  const propertyIds = await getAccessiblePropertyIds();
  const supabase = await getDataClient();
  let query = supabase
    .from("units")
    .select("id, company_id, property_id, name, floor, notes")
    .order("created_at", { ascending: true });

  if (propertyIds !== null) {
    if (!propertyIds.length) {
      return [];
    }
    query = query.in("property_id", propertyIds);
  }

  const { data, error } = await query;

  if (error) {
    return [];
  }

  return (data ?? []) as UnitSummary[];
}

export async function getRooms() {
  const propertyIds = await getAccessiblePropertyIds();
  const supabase = await getDataClient();
  let query = supabase
    .from("rooms")
    .select("id, company_id, property_id, name, status, monthly_rent, description")
    .order("created_at", { ascending: true });

  if (propertyIds !== null) {
    if (!propertyIds.length) {
      return [];
    }
    query = query.in("property_id", propertyIds);
  }

  const { data, error } = await query;

  if (error) {
    return [];
  }

  return (data ?? []).map((room) => ({
    ...room,
    monthly_rent: Number(room.monthly_rent ?? 0),
  })) as RoomSummary[];
}

export async function getTenantRecords() {
  const propertyIds = await getAccessiblePropertyIds();
  const supabase = await getDataClient();
  let query = supabase
    .from("tenant_records")
    .select("id, company_id, property_id, unit_id, room_id, full_name, email, phone, identification_number, monthly_rent, deposit, contract_start, contract_end, due_day, status, notes")
    .order("full_name", { ascending: true });

  if (propertyIds !== null) {
    if (!propertyIds.length) {
      return [];
    }
    query = query.in("property_id", propertyIds);
  }

  const { data, error } = await query;

  if (error) {
    return [];
  }

  return (data ?? []).map((tenant) => ({
    ...tenant,
    monthly_rent: Number(tenant.monthly_rent ?? 0),
    deposit: Number(tenant.deposit ?? 0),
  })) as TenantRecordSummary[];
}

export async function getDashboardSummary() {
  const [companies, properties, rooms] = await Promise.all([
    getUserCompanies(),
    getProperties(),
    getRooms(),
  ]);

  return {
    companies,
    properties,
    rooms,
    totalProperties: properties.length,
    totalRooms: rooms.length,
    occupiedRooms: rooms.filter((room) => room.status === "occupied").length,
    vacantRooms: rooms.filter((room) => room.status === "vacant").length,
    maintenanceRooms: rooms.filter((room) => room.status === "maintenance").length,
    reservedRooms: rooms.filter((room) => room.status === "reserved").length,
  };
}

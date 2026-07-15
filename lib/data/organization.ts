import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRole, type AppRole } from "@/lib/auth/roles";

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
  notes: string | null;
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

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

async function getDataClient() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

async function getCurrentScope() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, role: null as AppRole | null };
  }

  const metadataRole = normalizeRole(user.user_metadata?.role);

  if (metadataRole) {
    return { user, role: metadataRole };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return { user, role: normalizeRole(profile?.role) };
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

  if (companyIds.length) {
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
    .eq("owner_id", user.id);

  for (const property of ownedProperties ?? []) {
    if (property.property_id) {
      propertyIds.add(property.property_id);
    }
  }

  return Array.from(propertyIds);
}

export async function getUserCompanies() {
  const companyIds = await getAccessibleCompanyIds();
  const supabase = await getDataClient();
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
    .select("id, company_id, name, address, notes")
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

export async function getDashboardSummary() {
  const [companies, properties, units, rooms] = await Promise.all([
    getUserCompanies(),
    getProperties(),
    getUnits(),
    getRooms(),
  ]);

  return {
    companies,
    properties,
    units,
    rooms,
    totalProperties: properties.length,
    totalUnits: units.length,
    totalRooms: rooms.length,
    occupiedRooms: rooms.filter((room) => room.status === "occupied").length,
    vacantRooms: rooms.filter((room) => room.status === "vacant").length,
    maintenanceRooms: rooms.filter((room) => room.status === "maintenance").length,
    reservedRooms: rooms.filter((room) => room.status === "reserved").length,
  };
}

import { createClient } from "@/lib/supabase/server";

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
};

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function getUserCompanies() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, email, phone, status, created_at")
    .order("created_at", { ascending: true });

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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id, company_id, name, address, notes")
    .order("created_at", { ascending: true });

  if (error) {
    return [];
  }

  return (data ?? []) as PropertySummary[];
}

export async function getRooms() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("id, company_id, property_id, name, status, monthly_rent")
    .order("created_at", { ascending: true });

  if (error) {
    return [];
  }

  return (data ?? []).map((room) => ({
    ...room,
    monthly_rent: Number(room.monthly_rent ?? 0),
  })) as RoomSummary[];
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

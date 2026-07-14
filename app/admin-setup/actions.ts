"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedCreateRoles = [
  "owner",
  "admin",
  "tenant",
  "maintenance_staff",
  "cleaning_staff",
  "technician",
] as const;

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

async function assertAdmin() {
  await requireRole(["super_admin", "owner", "admin"]);
}

export async function createPortalUser(formData: FormData) {
  await assertAdmin();
  const [currentUser, company] = await Promise.all([getCurrentUser(), getFirstCompany()]);

  const fullName = textValue(formData, "fullName");
  const email = textValue(formData, "email").toLowerCase();
  const phone = textValue(formData, "phone");
  const password = textValue(formData, "password");
  const role = textValue(formData, "role");

  if (!fullName || !email || !password || !allowedCreateRoles.includes(role as never)) {
    redirect("/admin-setup?error=user_missing");
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    redirect("/admin-setup?error=service_key");
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role,
      full_name: fullName,
      phone,
    },
  });

  if (error || !data.user) {
    redirect(`/admin-setup?error=user_create&message=${encodeURIComponent(error?.message ?? "Unable to create user")}`);
  }

  await admin.from("profiles").upsert({
    id: data.user.id,
    full_name: fullName,
    phone: phone || null,
    role,
  });

  if (company && currentUser) {
    await admin.from("company_users").upsert({
      company_id: company.id,
      user_id: data.user.id,
      role,
      status: "active",
      created_by: currentUser.id,
    });
  }

  revalidatePath("/admin-setup");
  redirect("/admin-setup?created=user");
}

export async function createUnit(formData: FormData) {
  await assertAdmin();

  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const name = textValue(formData, "name");
  const floor = textValue(formData, "floor");
  const notes = textValue(formData, "notes");

  if (!user || !propertyId || !name) {
    redirect("/admin-setup?error=unit_missing");
  }

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id, organization_id")
    .eq("id", propertyId)
    .single();

  if (!property) {
    redirect("/admin-setup?error=property_missing");
  }

  const { error } = await supabase.from("units").insert({
    property_id: property.id,
    organization_id: property.organization_id ?? null,
    name,
    floor: floor || null,
    notes: notes || null,
    created_by: user.id,
  });

  if (error) {
    redirect("/admin-setup?error=unit_create");
  }

  revalidatePath("/admin-setup");
  revalidatePath("/units");
  redirect("/admin-setup?created=unit");
}

export async function assignPropertyOwner(formData: FormData) {
  await assertAdmin();

  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const ownerId = textValue(formData, "ownerId");
  const ownershipPercentage = numberValue(formData, "ownershipPercentage", 100);
  const startDate = textValue(formData, "startDate") || new Date().toISOString().slice(0, 10);

  if (!user || !propertyId || !ownerId || ownershipPercentage <= 0) {
    redirect("/admin-setup?error=owner_missing");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("property_owners").insert({
    property_id: propertyId,
    owner_id: ownerId,
    ownership_percentage: ownershipPercentage,
    start_date: startDate,
    created_by: user.id,
  });

  if (error) {
    redirect("/admin-setup?error=owner_assign");
  }

  revalidatePath("/admin-setup");
  redirect("/admin-setup?created=owner");
}

export async function assignTenantTenancy(formData: FormData) {
  await assertAdmin();

  const user = await getCurrentUser();
  const tenantId = textValue(formData, "tenantId");
  const roomId = textValue(formData, "roomId");
  const monthlyRental = numberValue(formData, "monthlyRental");
  const deposit = numberValue(formData, "deposit");
  const contractStart = textValue(formData, "contractStart");
  const contractEnd = textValue(formData, "contractEnd");
  const dueDay = numberValue(formData, "dueDay", 1);

  if (!user || !tenantId || !roomId || !contractStart || dueDay < 1 || dueDay > 31) {
    redirect("/admin-setup?error=tenancy_missing");
  }

  const supabase = await createClient();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, property_id, unit_id, organization_id")
    .eq("id", roomId)
    .single();

  if (!room?.property_id) {
    redirect("/admin-setup?error=room_missing");
  }

  const { error: tenancyError } = await supabase.from("tenancies").insert({
    tenant_id: tenantId,
    room_id: room.id,
    property_id: room.property_id,
    unit_id: room.unit_id ?? null,
    organization_id: room.organization_id ?? null,
    monthly_rental: monthlyRental,
    deposit,
    contract_start: contractStart,
    contract_end: contractEnd || null,
    due_day: dueDay,
    status: "active",
    created_by: user.id,
  });

  if (tenancyError) {
    redirect("/admin-setup?error=tenancy_create");
  }

  await supabase.from("rooms").update({ status: "occupied" }).eq("id", room.id);

  revalidatePath("/admin-setup");
  revalidatePath("/tenants");
  revalidatePath("/rooms");
  redirect("/admin-setup?created=tenancy");
}

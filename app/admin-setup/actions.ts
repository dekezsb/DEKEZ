"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  accessLevels,
  accessModules,
  resolveUserAccess,
  type AccessLevel,
} from "@/lib/auth/access";
import { activateAllTenantAccounts } from "@/lib/auth/activate-all-tenants";
import { requireRole } from "@/lib/auth/session";
import { normalizeInternationalPhone } from "@/lib/auth/phone";
import { phoneAuthAlias } from "@/lib/auth/registration";
import { normalizeRole } from "@/lib/auth/roles";
import { generateRecurringRentBills } from "@/lib/billing/rent-billing";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { addMonths } from "@/lib/e-tenancy";
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

const allowedRegistrationStatuses = [
  "pending_verification",
  "approved",
  "rejected",
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
  await requireRole(["super_admin"], {
    module: "admin_setup",
    level: "manage",
  });
}

function profilePath(profileId: string, result: string) {
  return `/admin-setup/users/${profileId}?${result}`;
}

export async function activateAllTenantPortalAccounts() {
  await assertAdmin();
  const actor = await getCurrentUser();
  if (!actor) {
    redirect("/admin-setup?error=tenant_activation");
  }

  let result;
  try {
    result = await activateAllTenantAccounts(actor.id);
  } catch {
    redirect("/admin-setup?error=tenant_activation");
  }

  revalidatePath("/admin-setup");
  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/rent-due-tracker");
  revalidatePath("/properties");
  revalidatePath("/tenant/profile");

  const params = new URLSearchParams({
    activated: "tenants",
    accounts: String(result.accountsActivated),
    rooms: String(result.roomsLinked),
    skipped: String(result.skippedMissingPhone),
    conflicts: String(result.conflicts),
    errors: String(result.errors),
  });
  redirect(`/admin-setup?${params.toString()}`);
}

export async function createPortalUser(formData: FormData) {
  await assertAdmin();
  const [currentUser, company] = await Promise.all([getCurrentUser(), getFirstCompany()]);

  const fullName = textValue(formData, "fullName");
  const email = textValue(formData, "email").toLowerCase();
  const phoneInput = textValue(formData, "phone");
  const password = textValue(formData, "password");
  const role = textValue(formData, "role");
  const phone = normalizeInternationalPhone(phoneInput);

  if (
    !fullName ||
    !phone ||
    !password ||
    !allowedCreateRoles.includes(role as never)
  ) {
    redirect("/admin-setup?error=user_missing");
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    redirect("/admin-setup?error=service_key");
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: email || phoneAuthAlias(phone),
    password,
    email_confirm: true,
    app_metadata: {
      role,
    },
    user_metadata: {
      full_name: fullName,
      phone: phone.e164,
    },
  });

  if (error || !data.user) {
    redirect(`/admin-setup?error=user_create&message=${encodeURIComponent(error?.message ?? "Unable to create user")}`);
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    full_name: fullName,
    phone: phone.e164,
    role,
    global_role: role,
    registration_status: "approved",
    registration_reviewed_by: currentUser?.id ?? null,
    registration_reviewed_at: new Date().toISOString(),
    registration_rejection_reason: null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    redirect(
      `/admin-setup?error=user_create&message=${encodeURIComponent(profileError.message)}`,
    );
  }

  if (company && currentUser) {
    await admin.from("company_users").upsert({
      company_id: company.id,
      profile_id: data.user.id,
      user_id: data.user.id,
      role,
      status: "active",
      created_by: currentUser.id,
    }, {
      onConflict: "company_id,profile_id",
    });
  }

  revalidatePath("/admin-setup");
  redirect("/admin-setup?created=user");
}

export async function updatePortalUser(formData: FormData) {
  await requireRole(["super_admin"], {
    module: "admin_setup",
    level: "manage",
  });
  const actor = await getCurrentUser();
  const profileId = textValue(formData, "profileId");
  const fullName = textValue(formData, "fullName");
  const phoneInput = textValue(formData, "phone");
  const requestedRole = normalizeRole(textValue(formData, "role"));
  const requestedStatus = textValue(formData, "registrationStatus");
  const rejectionReason = textValue(formData, "rejectionReason");
  const requestedAccess = accessModules.map((module) => ({
    module_key: module,
    access_level: textValue(formData, `access_${module}`),
  }));
  const hasInvalidAccess = requestedAccess.some(
    ({ access_level: accessLevel }) =>
      !accessLevels.includes(accessLevel as AccessLevel),
  );
  const normalizedPhone = phoneInput
    ? normalizeInternationalPhone(phoneInput)
    : null;

  if (
    !actor ||
    !profileId ||
    !fullName ||
    !requestedRole ||
    hasInvalidAccess ||
    !allowedRegistrationStatuses.includes(requestedStatus as never) ||
    (phoneInput && !normalizedPhone) ||
    (requestedStatus === "rejected" && !rejectionReason)
  ) {
    redirect(
      profilePath(
        profileId || "unknown",
        phoneInput && !normalizedPhone
          ? "error=phone_invalid"
          : "error=user_missing",
      ),
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    redirect(profilePath(profileId, "error=service_key"));
  }

  const [profileResult, previousPermissionsResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, phone, role, global_role, registration_status, registration_rejection_reason, organization_id")
      .eq("id", profileId)
      .maybeSingle(),
    admin
      .from("user_module_permissions")
      .select("module_key, access_level")
      .eq("profile_id", profileId),
  ]);
  const { data: profile, error: profileLookupError } = profileResult;

  const currentRole = normalizeRole(profile?.role);
  if (profileLookupError || !profile || !currentRole) {
    redirect(profilePath(profileId, "error=user_not_found"));
  }

  const isSelf = actor.id === profile.id;
  const isProtectedSuperAdmin = currentRole === "super_admin";

  const nextRole =
    isSelf || isProtectedSuperAdmin ? currentRole : requestedRole;
  const nextStatus =
    isSelf || isProtectedSuperAdmin
      ? profile.registration_status
      : requestedStatus;

  if (
    nextRole === "super_admin" &&
    currentRole !== "super_admin"
  ) {
    redirect(profilePath(profileId, "error=permission"));
  }

  const now = new Date().toISOString();
  const storedPhone = normalizedPhone?.e164 ?? null;
  const profileUpdate = {
    full_name: fullName,
    phone: storedPhone,
    role: nextRole,
    global_role: nextRole,
    registration_status: nextStatus,
    registration_reviewed_by:
      nextStatus === profile.registration_status
        ? undefined
        : actor.id,
    registration_reviewed_at:
      nextStatus === profile.registration_status
        ? undefined
        : now,
    registration_rejection_reason:
      nextStatus === "rejected" ? rejectionReason : null,
    updated_at: now,
  };

  const { error: profileUpdateError } = await admin
    .from("profiles")
    .update(profileUpdate)
    .eq("id", profile.id);

  if (profileUpdateError) {
    redirect(profilePath(profile.id, "error=user_update"));
  }

  const { data: authUserResult, error: authLookupError } =
    await admin.auth.admin.getUserById(profile.id);
  const authUser = authUserResult.user;

  if (authLookupError || !authUser) {
    await admin
      .from("profiles")
      .update({
        full_name: profile.full_name,
        phone: profile.phone,
        role: profile.role,
        global_role: profile.global_role,
        registration_status: profile.registration_status,
        registration_rejection_reason:
          profile.registration_rejection_reason,
        updated_at: now,
      })
      .eq("id", profile.id);
    redirect(profilePath(profile.id, "error=auth_update"));
  }

  const authAttributes: {
    app_metadata: Record<string, unknown>;
    user_metadata: Record<string, unknown>;
    ban_duration: string;
    phone?: string;
  } = {
    app_metadata: {
      ...(authUser.app_metadata ?? {}),
      role: nextRole,
    },
    user_metadata: {
      ...(authUser.user_metadata ?? {}),
      full_name: fullName,
      phone: storedPhone,
    },
    ban_duration:
      nextStatus === "approved" ? "none" : "876000h",
  };

  if (authUser.phone && normalizedPhone) {
    authAttributes.phone = normalizedPhone.e164;
  }

  const { error: authUpdateError } =
    await admin.auth.admin.updateUserById(profile.id, authAttributes);

  if (authUpdateError) {
    await admin
      .from("profiles")
      .update({
        full_name: profile.full_name,
        phone: profile.phone,
        role: profile.role,
        global_role: profile.global_role,
        registration_status: profile.registration_status,
        registration_rejection_reason:
          profile.registration_rejection_reason,
        updated_at: now,
      })
      .eq("id", profile.id);
    redirect(profilePath(profile.id, "error=auth_update"));
  }

  const membershipStatus =
    nextStatus === "approved" ? "active" : "inactive";
  const { error: membershipError } = await admin
    .from("company_users")
    .update({
      role: nextRole,
      status: membershipStatus,
      updated_at: now,
    })
    .or(`profile_id.eq.${profile.id},user_id.eq.${profile.id}`);

  await admin
    .from("tenants")
    .update({
      full_name: fullName,
      phone: storedPhone,
      updated_at: now,
    })
    .eq("profile_id", profile.id);

  if (
    currentRole === "owner" &&
    (nextRole !== "owner" || nextStatus !== "approved")
  ) {
    await admin
      .from("property_owners")
      .update({
        end_date: now.slice(0, 10),
        updated_at: now,
      })
      .eq("owner_id", profile.id)
      .is("end_date", null);
  }

  if (membershipError) {
    redirect(profilePath(profile.id, "error=membership_update"));
  }

  const effectiveAccess = resolveUserAccess(nextRole, requestedAccess);
  const permissionRows = requestedAccess.map((permission) => ({
    profile_id: profile.id,
    module_key: permission.module_key,
    access_level:
      isProtectedSuperAdmin
        ? "manage"
        : effectiveAccess[permission.module_key],
    created_by: actor.id,
    updated_at: now,
  }));
  const { error: permissionError } = await admin
    .from("user_module_permissions")
    .upsert(permissionRows, {
      onConflict: "profile_id,module_key",
    });

  if (permissionError) {
    redirect(profilePath(profile.id, "error=permission_update"));
  }

  await admin.from("audit_logs").insert({
    company_id: profile.organization_id ?? null,
    actor_profile_id: actor.id,
    action: "user_profile_updated",
    entity_table: "profiles",
    entity_id: profile.id,
    metadata: {
      old: {
        full_name: profile.full_name,
        phone: profile.phone,
        role: profile.role,
        registration_status: profile.registration_status,
      },
      new: {
        full_name: fullName,
        phone: storedPhone,
        role: nextRole,
        registration_status: nextStatus,
        module_access: effectiveAccess,
      },
      previous_module_access: resolveUserAccess(
        currentRole,
        previousPermissionsResult.data ?? [],
      ),
    },
  });

  revalidatePath("/admin-setup");
  revalidatePath(`/admin-setup/users/${profile.id}`);
  revalidatePath("/verification");
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  redirect(profilePath(profile.id, "saved=1"));
}

export async function removePortalUserAccess(formData: FormData) {
  await requireRole(["super_admin"], {
    module: "admin_setup",
    level: "manage",
  });
  const actor = await getCurrentUser();
  const profileId = textValue(formData, "profileId");
  const reason = textValue(formData, "reason");

  if (!actor || !profileId || !reason) {
    redirect(
      profilePath(
        profileId || "unknown",
        "error=removal_reason",
      ),
    );
  }

  if (actor.id === profileId) {
    redirect(profilePath(profileId, "error=self_remove"));
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    redirect(profilePath(profileId, "error=service_key"));
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, phone, role, registration_status, organization_id")
    .eq("id", profileId)
    .maybeSingle();

  if (!profile) {
    redirect(profilePath(profileId, "error=user_not_found"));
  }

  if (normalizeRole(profile.role) === "super_admin") {
    redirect(profilePath(profileId, "error=permission"));
  }

  const now = new Date().toISOString();
  const { error: banError } = await admin.auth.admin.updateUserById(
    profile.id,
    { ban_duration: "876000h" },
  );

  if (banError) {
    redirect(profilePath(profile.id, "error=auth_update"));
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      registration_status: "rejected",
      registration_reviewed_by: actor.id,
      registration_reviewed_at: now,
      registration_rejection_reason: reason,
      updated_at: now,
    })
    .eq("id", profile.id);

  if (profileError) {
    await admin.auth.admin.updateUserById(profile.id, {
      ban_duration: "none",
    });
    redirect(profilePath(profile.id, "error=user_update"));
  }

  const { error: membershipError } = await admin
    .from("company_users")
    .update({
      status: "inactive",
      updated_at: now,
    })
    .or(`profile_id.eq.${profile.id},user_id.eq.${profile.id}`);

  await admin
    .from("property_owners")
    .update({
      end_date: now.slice(0, 10),
      updated_at: now,
    })
    .eq("owner_id", profile.id)
    .is("end_date", null);

  if (membershipError) {
    redirect(profilePath(profile.id, "error=membership_update"));
  }

  await admin.from("audit_logs").insert({
    company_id: profile.organization_id ?? null,
    actor_profile_id: actor.id,
    action: "user_access_removed",
    entity_table: "profiles",
    entity_id: profile.id,
    metadata: {
      reason,
      preserved_records: true,
      previous_role: profile.role,
      previous_status: profile.registration_status,
    },
  });

  revalidatePath("/admin-setup");
  revalidatePath("/verification");
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  redirect("/admin-setup?removed=user");
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

  const propertyId = textValue(formData, "propertyId");
  const ownerId = textValue(formData, "ownerId");

  if (!propertyId || !ownerId) {
    redirect("/admin-setup?error=owner_missing");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_property_owner", {
    target_owner_id: ownerId,
    target_property_id: propertyId,
  });

  if (error) {
    redirect("/admin-setup?error=owner_assign");
  }

  revalidatePath("/admin-setup");
  revalidatePath("/properties");
  revalidatePath("/dashboard");
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
  const contractDurationMonths = numberValue(formData, "contractDurationMonths", 12);
  const contractEnd = textValue(formData, "contractEnd") || addMonths(contractStart, contractDurationMonths);
  const requestedDueDay = numberValue(formData, "dueDay", 0);
  const checkInDay = Number(contractStart.slice(8, 10));
  const dueDay = requestedDueDay >= 1 && requestedDueDay <= 31 ? requestedDueDay : checkInDay;

  if (!user || !tenantId || !roomId || !contractStart || ![6, 12].includes(contractDurationMonths) || dueDay < 1 || dueDay > 31) {
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

  const { data: tenancy, error: tenancyError } = await supabase.from("tenancies").insert({
    tenant_id: tenantId,
    room_id: room.id,
    property_id: room.property_id,
    unit_id: room.unit_id ?? null,
    organization_id: room.organization_id ?? null,
    monthly_rental: monthlyRental,
    deposit,
    contract_start: contractStart,
    contract_end: contractEnd || null,
    tenancy_start_date: contractStart,
    tenancy_end_date: contractEnd || null,
    contract_duration_months: contractDurationMonths,
    due_day: dueDay,
    rent_due_day: dueDay,
    check_in_date: contractStart,
    checkout_date: null,
    billing_status: "active",
    status: "active",
    created_by: user.id,
  }).select("id").single();

  if (tenancyError) {
    redirect("/admin-setup?error=tenancy_create");
  }

  await supabase.from("rooms").update({ status: "occupied" }).eq("id", room.id);
  if (tenancy?.id) {
    await generateRecurringRentBills(supabase, {
      currentDate: contractStart,
      createdBy: user.id,
      tenancyId: tenancy.id,
      includeTenantRecords: false,
    });
  }

  revalidatePath("/admin-setup");
  revalidatePath("/tenants");
  revalidatePath("/rooms");
  revalidatePath("/rent-due-tracker");
  redirect("/admin-setup?created=tenancy");
}

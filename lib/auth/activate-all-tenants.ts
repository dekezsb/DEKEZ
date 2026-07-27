import "server-only";

import { generateRecurringRentBills } from "@/lib/billing/rent-billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeInternationalPhone } from "./phone";
import { activateTenantAccount } from "./tenant-account";

type TenantRecordRow = {
  id: string;
  company_id: string;
  property_id: string;
  unit_id: string | null;
  room_id: string;
  tenant_id: string | null;
  tenancy_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  identification_number: string | null;
  monthly_rent: number | string | null;
  deposit: number | string | null;
  contract_start: string | null;
  contract_end: string | null;
  due_day: number | null;
};

type TenantRow = {
  id: string;
  company_id: string;
  profile_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  identity_number: string | null;
};

type RoomRow = {
  id: string;
  company_id: string;
  organization_id: string | null;
  property_id: string;
  unit_id: string;
  monthly_rent: number | string | null;
};

type TenancyRow = {
  id: string;
  company_id: string;
  tenant_id: string;
  room_id: string;
  status: string;
};

type RecordLink = {
  recordId: string;
  tenancyId: string;
};

export type BulkTenantActivationResult = {
  activeRecords: number;
  phoneGroups: number;
  accountsActivated: number;
  accountsCreated: number;
  accountsReset: number;
  roomsLinked: number;
  tenantsCreated: number;
  tenanciesCreated: number;
  skippedMissingPhone: number;
  conflicts: number;
  errors: number;
};

function identityKey(value: string | null) {
  return value?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || null;
}

function numberValue(value: number | string | null, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validDueDay(value: number | null, startDate: string) {
  if (value && value >= 1 && value <= 31) return value;
  const startDay = Number(startDate.slice(8, 10));
  return startDay >= 1 && startDay <= 31 ? startDay : 1;
}

function groupsOf<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

export async function activateAllTenantAccounts(
  reviewedBy: string,
): Promise<BulkTenantActivationResult> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const result: BulkTenantActivationResult = {
    activeRecords: 0,
    phoneGroups: 0,
    accountsActivated: 0,
    accountsCreated: 0,
    accountsReset: 0,
    roomsLinked: 0,
    tenantsCreated: 0,
    tenanciesCreated: 0,
    skippedMissingPhone: 0,
    conflicts: 0,
    errors: 0,
  };

  const { data: recordData, error: recordError } = await admin
    .from("tenant_records")
    .select(
      "id, company_id, property_id, unit_id, room_id, tenant_id, tenancy_id, full_name, email, phone, identification_number, monthly_rent, deposit, contract_start, contract_end, due_day",
    )
    .eq("status", "active")
    .order("created_at");
  if (recordError) {
    throw new Error("Unable to read active tenant records.");
  }

  const records = (recordData ?? []) as TenantRecordRow[];
  result.activeRecords = records.length;
  const roomIds = [...new Set(records.map((record) => record.room_id))];

  const [roomsResult, tenantsResult, tenanciesResult] = await Promise.all([
    admin
      .from("rooms")
      .select(
        "id, company_id, organization_id, property_id, unit_id, monthly_rent",
      )
      .in("id", roomIds),
    admin
      .from("tenants")
      .select(
        "id, company_id, profile_id, full_name, email, phone, identity_number",
      ),
    admin
      .from("tenancies")
      .select("id, company_id, tenant_id, room_id, status")
      .in("room_id", roomIds),
  ]);
  if (roomsResult.error || tenantsResult.error || tenanciesResult.error) {
    throw new Error("Unable to read tenant room assignments.");
  }

  const roomById = new Map(
    ((roomsResult.data ?? []) as RoomRow[]).map((room) => [room.id, room]),
  );
  const tenants = (tenantsResult.data ?? []) as TenantRow[];
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const tenancyById = new Map(
    ((tenanciesResult.data ?? []) as TenancyRow[]).map((tenancy) => [
      tenancy.id,
      tenancy,
    ]),
  );
  const activeTenancyByRoom = new Map(
    ((tenanciesResult.data ?? []) as TenancyRow[])
      .filter((tenancy) => tenancy.status === "active")
      .map((tenancy) => [tenancy.room_id, tenancy]),
  );

  const parents = records.map((_, index) => index);
  const findParent = (index: number): number => {
    if (parents[index] !== index) {
      parents[index] = findParent(parents[index]);
    }
    return parents[index];
  };
  const union = (left: number, right: number) => {
    const leftParent = findParent(left);
    const rightParent = findParent(right);
    if (leftParent !== rightParent) parents[rightParent] = leftParent;
  };
  const phoneOwner = new Map<string, number>();
  const identityOwner = new Map<string, number>();
  records.forEach((record, index) => {
    const phone = normalizeInternationalPhone(record.phone ?? "");
    const identity = identityKey(record.identification_number);
    if (phone) {
      const existingIndex = phoneOwner.get(phone.digits);
      if (existingIndex !== undefined) union(index, existingIndex);
      phoneOwner.set(phone.digits, index);
    }
    if (identity) {
      const existingIndex = identityOwner.get(identity);
      if (existingIndex !== undefined) union(index, existingIndex);
      identityOwner.set(identity, index);
    }
  });
  const tenantGroups = new Map<number, TenantRecordRow[]>();
  records.forEach((record, index) => {
    const parent = findParent(index);
    const group = tenantGroups.get(parent) ?? [];
    group.push(record);
    tenantGroups.set(parent, group);
  });
  result.phoneGroups = [...tenantGroups.values()].filter((group) =>
    group.some((record) =>
      Boolean(normalizeInternationalPhone(record.phone ?? "")),
    ),
  ).length;

  const activatedProfiles = new Set<string>();
  const processPhoneGroup = async (group: TenantRecordRow[]) => {
    const profileLinkedPhone = group
      .map((record) =>
        record.tenant_id ? tenantById.get(record.tenant_id) : null,
      )
      .find((tenant) => tenant?.profile_id)?.phone;
    const phoneFrequency = new Map<
      string,
      {
        count: number;
        phone: NonNullable<
          ReturnType<typeof normalizeInternationalPhone>
        >;
      }
    >();
    group.forEach((record) => {
      const candidate = normalizeInternationalPhone(record.phone ?? "");
      if (!candidate) return;
      const existing = phoneFrequency.get(candidate.digits);
      phoneFrequency.set(candidate.digits, {
        count: (existing?.count ?? 0) + 1,
        phone: candidate,
      });
    });
    const phone =
      normalizeInternationalPhone(profileLinkedPhone ?? "") ??
      [...phoneFrequency.values()].sort(
        (left, right) => right.count - left.count,
      )[0]?.phone ??
      null;
    if (!phone) {
      result.skippedMissingPhone += group.length;
      return;
    }

    const identities = new Set(
      group
        .map((record) => identityKey(record.identification_number))
        .filter((value): value is string => Boolean(value)),
    );
    if (identities.size > 1) {
      result.conflicts += group.length;
      return;
    }

    const links: RecordLink[] = [];
    const activationTenantByCompany = new Map<string, string>();

    for (const record of group) {
      const room = roomById.get(record.room_id);
      if (!room?.company_id || !room.property_id || !room.unit_id) {
        result.conflicts += 1;
        continue;
      }

      let tenant = record.tenant_id
        ? tenantById.get(record.tenant_id) ?? null
        : null;
      if (!tenant) {
        const recordIdentity = identityKey(record.identification_number);
        const candidates = tenants.filter((candidate) => {
          if (candidate.company_id !== room.company_id) return false;
          const candidatePhone = normalizeInternationalPhone(
            candidate.phone ?? "",
          );
          const samePhone = candidatePhone?.digits === phone.digits;
          const sameIdentity =
            recordIdentity &&
            identityKey(candidate.identity_number) === recordIdentity;
          return Boolean(samePhone || sameIdentity);
        });
        tenant =
          candidates.find((candidate) => Boolean(candidate.profile_id)) ??
          candidates[0] ??
          null;
      }

      if (!tenant) {
        const { data: createdTenant, error: tenantCreateError } = await admin
          .from("tenants")
          .insert({
            company_id: room.company_id,
            full_name: record.full_name,
            email: record.email || null,
            phone: phone.e164,
            identity_number: record.identification_number || null,
            status: "active",
          })
          .select(
            "id, company_id, profile_id, full_name, email, phone, identity_number",
          )
          .single();
        if (tenantCreateError || !createdTenant) {
          result.errors += 1;
          continue;
        }
        tenant = createdTenant as TenantRow;
        tenants.push(tenant);
        tenantById.set(tenant.id, tenant);
        result.tenantsCreated += 1;
      } else {
        const tenantUpdate: Record<string, unknown> = {
          phone: phone.e164,
          status: "active",
          updated_at: now,
        };
        if (record.full_name) tenantUpdate.full_name = record.full_name;
        if (record.email) tenantUpdate.email = record.email;
        if (record.identification_number) {
          tenantUpdate.identity_number = record.identification_number;
        }
        const { error } = await admin
          .from("tenants")
          .update(tenantUpdate)
          .eq("id", tenant.id);
        if (error) {
          result.errors += 1;
          continue;
        }
        tenant.phone = phone.e164;
      }

      let tenancy = record.tenancy_id
        ? tenancyById.get(record.tenancy_id) ?? null
        : null;
      if (!tenancy) {
        const roomTenancy = activeTenancyByRoom.get(room.id) ?? null;
        if (roomTenancy) {
          const roomTenant = tenantById.get(roomTenancy.tenant_id);
          const roomTenantPhone = normalizeInternationalPhone(
            roomTenant?.phone ?? "",
          );
          if (roomTenantPhone?.digits !== phone.digits) {
            result.conflicts += 1;
            continue;
          }
          tenancy = roomTenancy;
          tenant = roomTenant ?? tenant;
        }
      }

      if (!tenancy) {
        const startDate = record.contract_start ?? today;
        const endDate =
          record.contract_end && record.contract_end >= startDate
            ? record.contract_end
            : null;
        const monthlyRent = numberValue(
          record.monthly_rent,
          numberValue(room.monthly_rent),
        );
        const dueDay = validDueDay(record.due_day, startDate);
        const { data: createdTenancy, error: tenancyCreateError } = await admin
          .from("tenancies")
          .insert({
            company_id: room.company_id,
            organization_id: room.organization_id,
            tenant_id: tenant.id,
            property_id: room.property_id,
            unit_id: room.unit_id,
            room_id: room.id,
            monthly_rent: monthlyRent,
            monthly_rental: monthlyRent,
            deposit: numberValue(record.deposit),
            start_date: startDate,
            end_date: endDate,
            contract_start: startDate,
            contract_end: endDate,
            tenancy_start_date: startDate,
            tenancy_end_date: endDate,
            due_day: dueDay,
            rent_due_day: dueDay,
            check_in_date: startDate,
            checkout_date: null,
            billing_status: "active",
            status: "active",
            created_by: reviewedBy,
          })
          .select("id, company_id, tenant_id, room_id, status")
          .single();
        if (tenancyCreateError || !createdTenancy) {
          result.errors += 1;
          continue;
        }
        tenancy = createdTenancy as TenancyRow;
        tenancyById.set(tenancy.id, tenancy);
        activeTenancyByRoom.set(room.id, tenancy);
        result.tenanciesCreated += 1;
      }

      const { error: recordUpdateError } = await admin
        .from("tenant_records")
        .update({
          company_id: room.company_id,
          property_id: room.property_id,
          unit_id: room.unit_id,
          tenant_id: tenancy.tenant_id,
          tenancy_id: tenancy.id,
          phone: phone.e164,
          updated_at: now,
        })
        .eq("id", record.id);
      if (recordUpdateError) {
        result.errors += 1;
        continue;
      }

      const { error: roomUpdateError } = await admin
        .from("rooms")
        .update({
          current_tenancy_id: tenancy.id,
          status: "occupied",
          updated_at: now,
        })
        .eq("id", room.id);
      if (roomUpdateError) {
        result.errors += 1;
        continue;
      }

      links.push({ recordId: record.id, tenancyId: tenancy.id });
      activationTenantByCompany.set(room.company_id, tenancy.tenant_id);
      result.roomsLinked += 1;
    }

    let profileId: string | null = null;
    for (const [companyId, tenantId] of activationTenantByCompany) {
      const activation = await activateTenantAccount(tenantId, reviewedBy);
      if (!activation.ok) {
        result.errors += 1;
        continue;
      }
      profileId = activation.profileId;
      activatedProfiles.add(activation.profileId);
      if (activation.reset) {
        result.accountsReset += 1;
      } else {
        result.accountsCreated += 1;
      }

      const { error: membershipError } = await admin
        .from("company_users")
        .upsert(
          {
            company_id: companyId,
            profile_id: activation.profileId,
            user_id: activation.profileId,
            role: "tenant",
            status: "active",
            created_by: reviewedBy,
            updated_at: now,
          },
          { onConflict: "company_id,profile_id" },
        );
      if (membershipError) result.errors += 1;
    }

    if (!profileId) return;

    for (const link of links) {
      const { error: billLinkError } = await admin
        .from("rent_bills")
        .update({
          tenancy_id: link.tenancyId,
          tenant_id: profileId,
          updated_at: now,
        })
        .eq("tenant_record_id", link.recordId);
      if (billLinkError) {
        result.errors += 1;
        continue;
      }

      const billing = await generateRecurringRentBills(admin, {
        createdBy: reviewedBy,
        tenancyId: link.tenancyId,
        includeTenantRecords: false,
      });
      result.errors += billing.errors.length;
    }
  };

  for (const batch of groupsOf([...tenantGroups.values()], 6)) {
    await Promise.all(batch.map(processPhoneGroup));
  }

  result.accountsActivated = activatedProfiles.size;
  await admin.from("audit_logs").insert({
    actor_profile_id: reviewedBy,
    action: "bulk_tenant_portal_activation",
    entity_table: "tenant_records",
    metadata: result,
  });

  return result;
}

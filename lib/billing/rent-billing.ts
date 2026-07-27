type SupabaseLike = {
  from: (table: string) => any;
};

type GeneratedBillResult = {
  checkedTenancies: number;
  checkedTenantRecords: number;
  createdBills: number;
  skippedBills: number;
  errors: string[];
};

type TenancyBillingRow = {
  id: string;
  organization_id: string | null;
  tenant_id: string;
  property_id: string;
  unit_id: string | null;
  room_id: string;
  monthly_rental: number | string | null;
  contract_start: string;
  contract_end: string | null;
  tenancy_start_date?: string | null;
  tenancy_end_date?: string | null;
  due_day?: number | null;
  rent_due_day?: number | null;
  check_in_date?: string | null;
  checkout_date?: string | null;
  billing_status?: string | null;
  tenants:
    | { profile_id: string | null }
    | Array<{ profile_id: string | null }>
    | null;
};

type TenantRecordBillingRow = {
  id: string;
  company_id: string | null;
  property_id: string;
  unit_id: string | null;
  room_id: string;
  monthly_rent: number | string | null;
  contract_start: string | null;
  contract_end: string | null;
  due_day: number | null;
};

export function billMonthForDate(dateText: string) {
  return `${dateText.slice(0, 7)}-01`;
}

export function addMonthsToBillMonth(billMonth: string, months: number) {
  const [year, month] = billMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dueDateForBillMonth(billMonth: string, dueDay: number) {
  const [year, month] = billMonth.split("-").map(Number);
  const safeDay = Math.min(Math.max(dueDay, 1), lastDayOfMonth(year, month));
  return `${billMonth.slice(0, 7)}-${String(safeDay).padStart(2, "0")}`;
}

export function dayOfMonth(dateText: string) {
  return Number(dateText.slice(8, 10));
}

function targetBillingMonths(input: {
  startDate: string;
  endDate?: string | null;
  dueDay: number;
  currentDate: string;
  includeStartMonth?: boolean;
}) {
  const startMonth = billMonthForDate(input.startDate);
  const currentMonth = billMonthForDate(input.currentDate);
  const currentDueDate = dueDateForBillMonth(currentMonth, input.dueDay);
  const candidates = new Set([currentMonth]);
  if (input.includeStartMonth !== false) {
    candidates.add(startMonth);
  }
  if (input.currentDate >= currentDueDate) {
    candidates.add(addMonthsToBillMonth(currentMonth, 1));
  }

  return Array.from(candidates).sort().filter((month) => {
    const dueDate = dueDateForBillMonth(month, input.dueDay);
    if (dueDate < input.startDate) {
      return false;
    }
    return !input.endDate || dueDate <= input.endDate;
  });
}

function effectiveEndDate(input: {
  checkoutDate?: string | null;
  tenancyEndDate?: string | null;
  contractEnd?: string | null;
}) {
  return input.checkoutDate ?? input.tenancyEndDate ?? input.contractEnd ?? null;
}

function tenantProfileId(tenancy: TenancyBillingRow) {
  const tenant = Array.isArray(tenancy.tenants)
    ? tenancy.tenants[0]
    : tenancy.tenants;
  return tenant?.profile_id ?? null;
}

async function existingBillMonths(
  supabase: SupabaseLike,
  column: "tenancy_id" | "tenant_record_id",
  id: string,
) {
  const { data } = await supabase
    .from("rent_bills")
    .select("bill_month")
    .eq(column, id);

  return new Set((data ?? []).map((bill: { bill_month: string }) => bill.bill_month));
}

async function insertMissingBills(
  supabase: SupabaseLike,
  bills: Array<Record<string, unknown>>,
) {
  if (!bills.length) {
    return { inserted: 0, error: null };
  }

  const { error } = await supabase.from("rent_bills").insert(bills);
  return { inserted: error ? 0 : bills.length, error };
}

export async function generateRecurringRentBills(
  supabase: SupabaseLike,
  options: {
    currentDate?: string;
    createdBy?: string | null;
    tenancyId?: string;
    includeTenantRecords?: boolean;
  } = {},
): Promise<GeneratedBillResult> {
  const currentDate = options.currentDate ?? new Date().toISOString().slice(0, 10);
  const result: GeneratedBillResult = {
    checkedTenancies: 0,
    checkedTenantRecords: 0,
    createdBills: 0,
    skippedBills: 0,
    errors: [],
  };

  let tenancyQuery = supabase
    .from("tenancies")
    .select("id, organization_id, tenant_id, property_id, unit_id, room_id, monthly_rental, contract_start, contract_end, tenancy_start_date, tenancy_end_date, due_day, rent_due_day, check_in_date, checkout_date, billing_status, rooms!inner(status), tenants(profile_id)")
    .eq("status", "active")
    .eq("billing_status", "active")
    .eq("rooms.status", "occupied");

  if (options.tenancyId) {
    tenancyQuery = tenancyQuery.eq("id", options.tenancyId);
  }

  const { data: tenancies, error: tenancyError } = await tenancyQuery;
  if (tenancyError) {
    result.errors.push(tenancyError.message);
  }

  for (const tenancy of (tenancies ?? []) as TenancyBillingRow[]) {
    result.checkedTenancies += 1;
    const profileId = tenantProfileId(tenancy);
    if (!profileId) {
      result.errors.push(
        `Tenancy ${tenancy.id} has no activated tenant portal profile.`,
      );
      continue;
    }
    const startDate = tenancy.check_in_date ?? tenancy.tenancy_start_date ?? tenancy.contract_start;
    const dueDay = tenancy.rent_due_day ?? tenancy.due_day ?? dayOfMonth(startDate);
    const endDate = effectiveEndDate({
      checkoutDate: tenancy.checkout_date,
      tenancyEndDate: tenancy.tenancy_end_date,
      contractEnd: tenancy.contract_end,
    });
    const existingMonths = await existingBillMonths(supabase, "tenancy_id", tenancy.id);
    const targetMonths = targetBillingMonths({ startDate, endDate, dueDay, currentDate });
    const missingBills = targetMonths
      .filter((month) => !existingMonths.has(month))
      .map((billMonth) => ({
        organization_id: tenancy.organization_id,
        tenancy_id: tenancy.id,
        tenant_id: profileId,
        tenant_record_id: null,
        property_id: tenancy.property_id,
        unit_id: tenancy.unit_id,
        room_id: tenancy.room_id,
        bill_month: billMonth,
        due_date: dueDateForBillMonth(billMonth, dueDay),
        amount: Number(tenancy.monthly_rental ?? 0),
        paid_amount: 0,
        status: "unpaid",
        created_by: options.createdBy ?? null,
      }));

    result.skippedBills += targetMonths.length - missingBills.length;
    const inserted = await insertMissingBills(supabase, missingBills);
    if (inserted.error) {
      result.errors.push(inserted.error.message);
    }
    result.createdBills += inserted.inserted;
  }

  if (options.includeTenantRecords !== false) {
    const { data: tenantRecords, error: tenantRecordError } = await supabase
      .from("tenant_records")
      .select("id, company_id, property_id, unit_id, room_id, monthly_rent, contract_start, contract_end, due_day, rooms!inner(status)")
      .eq("status", "active")
      .eq("rooms.status", "occupied")
      .not("due_day", "is", null)
      .not("contract_start", "is", null);

    if (tenantRecordError) {
      result.errors.push(tenantRecordError.message);
    }

    for (const tenant of (tenantRecords ?? []) as TenantRecordBillingRow[]) {
      if (!tenant.contract_start || !tenant.due_day) {
        continue;
      }

      result.checkedTenantRecords += 1;
      const existingMonths = await existingBillMonths(supabase, "tenant_record_id", tenant.id);
      const dueDay = tenant.due_day;
      const targetMonths = targetBillingMonths({
        startDate: tenant.contract_start,
        endDate: tenant.contract_end,
        dueDay,
        currentDate,
        includeStartMonth: false,
      });
      const missingBills = targetMonths
        .filter((month) => !existingMonths.has(month))
        .map((billMonth) => ({
          organization_id: null,
          tenancy_id: null,
          tenant_id: null,
          tenant_record_id: tenant.id,
          property_id: tenant.property_id,
          unit_id: tenant.unit_id,
          room_id: tenant.room_id,
          bill_month: billMonth,
          due_date: dueDateForBillMonth(billMonth, dueDay),
          amount: Number(tenant.monthly_rent ?? 0),
          paid_amount: 0,
          status: "unpaid",
          created_by: options.createdBy ?? null,
        }));

      result.skippedBills += targetMonths.length - missingBills.length;
      const inserted = await insertMissingBills(supabase, missingBills);
      if (inserted.error) {
        result.errors.push(inserted.error.message);
      }
      result.createdBills += inserted.inserted;
    }
  }

  return result;
}

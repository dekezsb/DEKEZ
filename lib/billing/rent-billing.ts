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
  deposit: number | string | null;
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
  tenant_records:
    | Array<{
        id: string;
        status: string | null;
      }>
    | null;
  tenancy_agreements:
    | Array<{
        term_type: string | null;
        term_end_date: string | null;
        status: string | null;
      }>
    | null;
};

type TenantRecordBillingRow = {
  id: string;
  tenancy_id: string | null;
  company_id: string | null;
  property_id: string;
  unit_id: string | null;
  room_id: string;
  monthly_rent: number | string | null;
  deposit: number | string | null;
  contract_start: string | null;
  contract_end: string | null;
  due_day: number | null;
};

export const COMPANY_BILLING_START_DATE = "2024-09-01";

export function companyBillingStartDate(dateText: string) {
  return dateText < COMPANY_BILLING_START_DATE
    ? COMPANY_BILLING_START_DATE
    : dateText;
}

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

export function invoiceDueDateForBillMonth(
  billMonth: string,
  dueDay: number,
  checkInDate: string,
) {
  const recurringDueDate = dueDateForBillMonth(billMonth, dueDay);
  return billMonth === billMonthForDate(checkInDate)
    ? checkInDate
    : recurringDueDate;
}

function targetBillingMonths(input: {
  startDate: string;
  endDate?: string | null;
  dueDay: number;
  currentDate: string;
}) {
  const startMonth = billMonthForDate(input.startDate);
  const currentMonth = billMonthForDate(input.currentDate);
  const endMonth = input.endDate
    ? [currentMonth, billMonthForDate(input.endDate)].sort()[0]
    : currentMonth;

  if (input.startDate > input.currentDate || startMonth > endMonth) {
    return [];
  }

  const months: string[] = [];
  let month = startMonth;
  while (month <= endMonth) {
    months.push(month);
    month = addMonthsToBillMonth(month, 1);
  }

  const currentDueDate = dueDateForBillMonth(currentMonth, input.dueDay);
  if (input.currentDate >= currentDueDate) {
    const nextMonth = addMonthsToBillMonth(currentMonth, 1);
    const nextDueDate = dueDateForBillMonth(nextMonth, input.dueDay);
    if (!input.endDate || nextDueDate <= input.endDate) {
      months.push(nextMonth);
    }
  }

  return months;
}

function effectiveEndDate(input: {
  checkoutDate?: string | null;
  tenancyEndDate?: string | null;
  contractEnd?: string | null;
  renewalEndDate?: string | null;
}) {
  if (input.checkoutDate) return input.checkoutDate;

  return [
    input.tenancyEndDate,
    input.contractEnd,
    input.renewalEndDate,
  ]
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1) ?? null;
}

function latestPreparedRenewalEndDate(tenancy: TenancyBillingRow) {
  return (tenancy.tenancy_agreements ?? [])
    .filter(
      (agreement) =>
        agreement.term_type === "renewal" &&
        agreement.term_end_date &&
        !["cancelled", "voided", "expired"].includes(agreement.status ?? ""),
    )
    .map((agreement) => agreement.term_end_date as string)
    .sort()
    .at(-1) ?? null;
}

function tenantProfileId(tenancy: TenancyBillingRow) {
  const tenant = Array.isArray(tenancy.tenants)
    ? tenancy.tenants[0]
    : tenancy.tenants;
  return tenant?.profile_id ?? null;
}

function activeTenantRecordId(tenancy: TenancyBillingRow) {
  const records = tenancy.tenant_records ?? [];
  return records.find((record) => record.status === "active")?.id
    ?? records[0]?.id
    ?? null;
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
    .select("id, organization_id, tenant_id, property_id, unit_id, room_id, monthly_rental, deposit, contract_start, contract_end, tenancy_start_date, tenancy_end_date, due_day, rent_due_day, check_in_date, checkout_date, billing_status, rooms!tenancies_room_id_fkey!inner(status), tenants(profile_id), tenant_records!tenant_records_tenancy_id_fkey(id,status), tenancy_agreements!tenancy_agreements_tenancy_id_fkey(term_type,term_end_date,status)")
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
  const activeTenancyRoomIds = new Set(
    ((tenancies ?? []) as TenancyBillingRow[]).map(
      (tenancy) => tenancy.room_id,
    ),
  );

  for (const tenancy of (tenancies ?? []) as TenancyBillingRow[]) {
    result.checkedTenancies += 1;
    const profileId = tenantProfileId(tenancy);
    const tenantRecordId = activeTenantRecordId(tenancy);
    const tenancyStartDate =
      tenancy.check_in_date ?? tenancy.tenancy_start_date ?? tenancy.contract_start;
    const startDate = companyBillingStartDate(tenancyStartDate);
    const dueDay = tenancy.rent_due_day ?? tenancy.due_day ?? dayOfMonth(startDate);
    const endDate = effectiveEndDate({
      checkoutDate: tenancy.checkout_date,
      tenancyEndDate: tenancy.tenancy_end_date,
      contractEnd: tenancy.contract_end,
      renewalEndDate: latestPreparedRenewalEndDate(tenancy),
    });
    const existingMonths = await existingBillMonths(supabase, "tenancy_id", tenancy.id);
    const targetMonths = targetBillingMonths({
      startDate,
      endDate,
      dueDay,
      currentDate,
    });
    const missingBills = targetMonths
      .filter((month) => !existingMonths.has(month))
      .map((billMonth) => {
        const dueDate = invoiceDueDateForBillMonth(
          billMonth,
          dueDay,
          startDate,
        );
        return {
          organization_id: tenancy.organization_id,
          tenancy_id: tenancy.id,
          tenant_id: profileId,
          tenant_record_id: tenantRecordId,
          property_id: tenancy.property_id,
          unit_id: tenancy.unit_id,
          room_id: tenancy.room_id,
          bill_month: billMonth,
          due_date: dueDate,
          invoice_date: dueDate,
          amount: Number(tenancy.monthly_rental ?? 0),
          deposit_amount:
            billMonth === billMonthForDate(startDate)
              ? Number(tenancy.deposit ?? 0)
              : 0,
          paid_amount: 0,
          status: "unpaid",
          created_by: options.createdBy ?? null,
        };
      });

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
      .select("id, tenancy_id, company_id, property_id, unit_id, room_id, monthly_rent, deposit, contract_start, contract_end, due_day, rooms!inner(status)")
      .eq("status", "active")
      .eq("rooms.status", "occupied")
      .is("tenancy_id", null)
      .not("due_day", "is", null)
      .not("contract_start", "is", null);

    if (tenantRecordError) {
      result.errors.push(tenantRecordError.message);
    }

    for (const tenant of (tenantRecords ?? []) as TenantRecordBillingRow[]) {
      if (!tenant.contract_start || !tenant.due_day) {
        continue;
      }
      if (activeTenancyRoomIds.has(tenant.room_id)) {
        result.skippedBills += 1;
        continue;
      }

      result.checkedTenantRecords += 1;
      const existingMonths = await existingBillMonths(supabase, "tenant_record_id", tenant.id);
      const dueDay = tenant.due_day;
      const contractStart = companyBillingStartDate(tenant.contract_start);
      const targetMonths = targetBillingMonths({
        startDate: contractStart,
        endDate: tenant.contract_end,
        dueDay,
        currentDate,
      });
      const missingBills = targetMonths
        .filter((month) => !existingMonths.has(month))
        .map((billMonth) => {
          const dueDate = invoiceDueDateForBillMonth(
            billMonth,
            dueDay,
            contractStart,
          );
          return {
            organization_id: null,
            tenancy_id: null,
            tenant_id: null,
            tenant_record_id: tenant.id,
            property_id: tenant.property_id,
            unit_id: tenant.unit_id,
            room_id: tenant.room_id,
            bill_month: billMonth,
            due_date: dueDate,
            invoice_date: dueDate,
            amount: Number(tenant.monthly_rent ?? 0),
            deposit_amount:
              billMonth === billMonthForDate(contractStart)
                ? Number(tenant.deposit ?? 0)
                : 0,
            paid_amount: 0,
            status: "unpaid",
            created_by: options.createdBy ?? null,
          };
        });

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

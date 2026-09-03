import { getProperties, getRooms, getTenantRecords } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type DataClient = Awaited<ReturnType<typeof createClient>>;

type RawRentBill = {
  id: string;
  tenancy_id: string | null;
  tenant_id: string | null;
  tenant_record_id: string | null;
  property_id: string;
  room_id: string;
  bill_month: string;
  due_date: string;
  amount: number | string;
  deposit_amount: number | string;
  paid_amount: number | string;
  status: string;
  created_at: string;
};

type RawTenancy = {
  id: string;
  tenant_id: string | null;
  property_id: string;
  room_id: string;
  monthly_rental: number | string;
  deposit: number | string;
  due_day: number | null;
  rent_due_day: number | null;
};

type RawPayment = {
  id: string;
  rent_bill_id: string;
  amount: number | string;
  payment_date: string;
  payment_method: string | null;
  status: string;
  created_at: string;
};

type RawSubmission = {
  id: string;
  rent_bill_id: string;
  verification_status: string;
  payment_date: string | null;
  created_at: string;
};

type RawMonthlyRoomPayment = {
  id: string;
  tenancy_id: string | null;
  room_id: string;
  amount: number | string;
  payment_date: string;
  created_at: string;
};

type RawDepositPayment = {
  tenancy_id: string | null;
  room_id: string | null;
  amount: number | string;
};

type RawDepositSubmission = {
  tenancy_id: string | null;
  tenant_record_id: string | null;
  room_id: string | null;
  amount: number | string;
};

export type RentMapStatus =
  | "paid"
  | "unpaid"
  | "partially_paid"
  | "vacant"
  | "reserved"
  | "maintenance"
  | "no_bill";

export type RentCollectionStatus =
  | "paid"
  | "partially_paid"
  | "unpaid"
  | "pending_verification";

export type RentCollectionSummary = {
  totalRentDue: number;
  totalPaid: number;
  totalOutstanding: number;
  occupiedTenants: number;
  fullyPaid: number;
  partiallyPaid: number;
  unpaid: number;
};

export type RentCollectionRow = {
  billId: string;
  tenancyId: string | null;
  tenantId: string | null;
  tenantRecordId: string | null;
  propertyId: string;
  propertyName: string;
  roomId: string;
  roomNumber: string;
  tenantName: string;
  monthlyRent: number;
  previousOutstanding: number;
  currentAmountDue: number;
  paidAmount: number;
  outstanding: number;
  depositOutstanding: number;
  totalOutstanding: number;
  creditAmount: number;
  dueDate: string;
  latestPaymentDate: string | null;
  paymentCount: number;
  settlementStatus: Exclude<RentCollectionStatus, "pending_verification">;
  paymentStatus: RentCollectionStatus;
};

export type RentMapRoom = {
  id: string;
  propertyId: string;
  roomNumber: string;
  tenantName: string | null;
  dueDay: number | null;
  dueDate: string | null;
  outstanding: number;
  depositOutstanding: number;
  previousOutstanding: number;
  billedAmount: number;
  paidAmount: number;
  status: RentMapStatus;
  billStatus: string | null;
  paymentStatus: RentCollectionStatus | null;
  latestPaymentDate: string | null;
  billId: string | null;
};

export type RentMapProperty = {
  id: string;
  name: string;
  code: string | null;
  area: string | null;
  rooms: RentMapRoom[];
  collections: RentCollectionRow[];
  summary: RentCollectionSummary;
};

export type RentDueMap = {
  currentMonth: string;
  selectedMonth: string;
  selectedMonthLabel: string;
  properties: RentMapProperty[];
  summary: RentCollectionSummary;
};

const excludedBillStatuses = new Set(["draft", "cancelled", "voided", "waived"]);
const pageSize = 1000;

async function getDataClient(): Promise<DataClient> {
  try {
    return createAdminClient() as DataClient;
  } catch {
    return createClient();
  }
}

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function selectedMonthValue(requestedMonth: string | undefined, currentMonth: string) {
  if (!requestedMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) {
    return currentMonth;
  }
  return requestedMonth > currentMonth ? currentMonth : requestedMonth;
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00+08:00`));
}

function dueDayFromDate(value: string | null | undefined) {
  if (!value) return null;
  const day = Number(value.slice(8, 10));
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function chunks<T>(items: T[], size = 200) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function billDeduplicationKey(bill: RawRentBill) {
  const tenantKey = bill.tenancy_id
    ? `tenancy:${bill.tenancy_id}`
    : bill.tenant_record_id
      ? `record:${bill.tenant_record_id}`
      : bill.tenant_id
        ? `tenant:${bill.tenant_id}`
        : `room:${bill.room_id}`;
  return `${tenantKey}:${bill.room_id}:${bill.bill_month.slice(0, 7)}`;
}

function balanceOwnerKey(bill: RawRentBill) {
  const tenantKey = bill.tenant_record_id
    ? `record:${bill.tenant_record_id}`
    : bill.tenant_id
      ? `tenant:${bill.tenant_id}`
      : bill.tenancy_id
        ? `tenancy:${bill.tenancy_id}`
        : "room";
  return `${tenantKey}:${bill.room_id}`;
}

function activeBill(bill: RawRentBill) {
  return !excludedBillStatuses.has(String(bill.status));
}

function deduplicateBills(bills: RawRentBill[]) {
  const seen = new Set<string>();
  return bills.filter((bill) => {
    if (!activeBill(bill)) return false;
    const key = billDeduplicationKey(bill);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadBills(
  supabase: DataClient,
  propertyIds: string[],
  selectedMonth: string,
  mode: "selected" | "previous",
) {
  const rows: RawRentBill[] = [];

  for (let start = 0; ; start += pageSize) {
    let query = supabase
      .from("rent_bills")
      .select("id, tenancy_id, tenant_id, tenant_record_id, property_id, room_id, bill_month, due_date, amount, deposit_amount, paid_amount, status, created_at")
      .in("property_id", propertyIds)
      .is("removed_at", null);

    query = mode === "selected"
      ? query.eq("bill_month", `${selectedMonth}-01`)
      : query.lt("bill_month", `${selectedMonth}-01`);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1);

    if (error) {
      throw new Error(`Unable to load ${mode} rent bills: ${error.message}`);
    }

    const page = (data ?? []) as RawRentBill[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return deduplicateBills(rows);
}

async function loadActiveTenancies(
  supabase: DataClient,
  propertyIds: string[],
) {
  const rows: RawTenancy[] = [];

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("tenancies")
      .select("id, tenant_id, property_id, room_id, monthly_rental, deposit, due_day, rent_due_day")
      .in("property_id", propertyIds)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1);

    if (error) {
      throw new Error(`Unable to load active tenancies: ${error.message}`);
    }

    const page = (data ?? []) as RawTenancy[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function loadConfirmedMonthlyRoomPayments(
  supabase: DataClient,
  propertyIds: string[],
  selectedMonth: string,
) {
  const rows: RawMonthlyRoomPayment[] = [];
  const [year, month] = selectedMonth.split("-").map(Number);
  const nextMonthDate = new Date(Date.UTC(year, month, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(
    nextMonthDate.getUTCMonth() + 1,
  ).padStart(2, "0")}-01`;

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("payments")
      .select("id, tenancy_id, room_id, amount, payment_date, created_at")
      .in("property_id", propertyIds)
      .eq("category", "monthly_rent")
      .eq("status", "confirmed")
      .gte("payment_date", `${selectedMonth}-01`)
      .lt("payment_date", nextMonth)
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1);

    if (error) {
      throw new Error(
        `Unable to load monthly room payments: ${error.message}`,
      );
    }

    const page = (data ?? []) as RawMonthlyRoomPayment[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

function emptySummary(): RentCollectionSummary {
  return {
    totalRentDue: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    occupiedTenants: 0,
    fullyPaid: 0,
    partiallyPaid: 0,
    unpaid: 0,
  };
}

export function summarizeRentCollections(
  collections: RentCollectionRow[],
): RentCollectionSummary {
  return collections.reduce((summary, collection) => {
    summary.totalRentDue += collection.currentAmountDue;
    summary.totalPaid += collection.paidAmount;
    summary.totalOutstanding += collection.outstanding;
    summary.occupiedTenants += 1;

    if (collection.settlementStatus === "paid") {
      summary.fullyPaid += 1;
    } else if (collection.settlementStatus === "partially_paid") {
      summary.partiallyPaid += 1;
    } else {
      summary.unpaid += 1;
    }

    return summary;
  }, emptySummary());
}

const roomNumberCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export async function getRentDueMap(
  requestedMonth?: string,
): Promise<RentDueMap> {
  const currentMonth = malaysiaDate().slice(0, 7);
  const selectedMonth = selectedMonthValue(requestedMonth, currentMonth);

  const [properties, rooms, tenantRecords] = await Promise.all([
    getProperties(),
    getRooms(),
    getTenantRecords(),
  ]);
  const propertyIds = properties.map((property) => property.id);

  if (!propertyIds.length) {
    return {
      currentMonth,
      selectedMonth,
      selectedMonthLabel: monthLabel(selectedMonth),
      properties: [],
      summary: emptySummary(),
    };
  }

  const supabase = await getDataClient();
  const [
    tenancies,
    loadedSelectedBills,
    loadedPreviousBills,
    confirmedMonthlyRoomPayments,
  ] = await Promise.all([
    loadActiveTenancies(supabase, propertyIds),
    loadBills(supabase, propertyIds, selectedMonth, "selected"),
    loadBills(supabase, propertyIds, selectedMonth, "previous"),
    loadConfirmedMonthlyRoomPayments(supabase, propertyIds, selectedMonth),
  ]);

  const activeTenancyIds = new Set(tenancies.map((tenancy) => tenancy.id));
  const activeTenancyRoomIds = new Set(
    tenancies.map((tenancy) => tenancy.room_id),
  );
  const activeTenancyByTenantAndRoom = new Set(
    tenancies
      .filter((tenancy) => tenancy.tenant_id)
      .map((tenancy) => `${tenancy.tenant_id}:${tenancy.room_id}`),
  );
  const activeTenantRecordIds = new Set(
    tenantRecords
      .filter(
        (tenant) =>
          tenant.status === "active" &&
          tenant.room_id &&
          !activeTenancyRoomIds.has(tenant.room_id),
      )
      .map((tenant) => tenant.id),
  );
  const belongsToActiveOccupancy = (bill: RawRentBill) => {
    if (bill.tenancy_id) return activeTenancyIds.has(bill.tenancy_id);
    if (bill.tenant_record_id) {
      return activeTenantRecordIds.has(bill.tenant_record_id);
    }
    return Boolean(
      bill.tenant_id &&
        activeTenancyByTenantAndRoom.has(`${bill.tenant_id}:${bill.room_id}`),
    );
  };
  // The current tracker follows today's occupants. Historical trackers must
  // keep the invoice occupant from that month, even after checkout or a room
  // transfer, otherwise an old unpaid invoice disappears from the history.
  const historicalMonth = selectedMonth < currentMonth;
  const selectedBills = historicalMonth
    ? loadedSelectedBills
    : loadedSelectedBills.filter(belongsToActiveOccupancy);
  const previousBills = historicalMonth
    ? loadedPreviousBills
    : loadedPreviousBills.filter(belongsToActiveOccupancy);

  const billIds = selectedBills.map((bill) => bill.id);
  const tenantIds = unique([
    ...selectedBills.map((bill) => bill.tenant_id).filter(Boolean),
    ...tenancies.map((tenancy) => tenancy.tenant_id).filter(Boolean),
  ] as string[]);
  const billIdChunks = chunks(billIds);
  const tenantIdChunks = chunks(tenantIds);

  const [
    paymentPages,
    submissionPages,
    profilePages,
    tenantPages,
    depositPaymentsResult,
    depositSubmissionsResult,
  ] = await Promise.all([
    Promise.all(
      billIdChunks.map((ids) =>
        supabase
          .from("payments")
          .select("id, rent_bill_id, amount, payment_date, payment_method, status, created_at")
          .in("rent_bill_id", ids)
          .eq("status", "confirmed")
          .order("payment_date", { ascending: false }),
      ),
    ),
    Promise.all(
      billIdChunks.map((ids) =>
        supabase
          .from("payment_submissions")
          .select("id, rent_bill_id, verification_status, payment_date, created_at")
          .in("rent_bill_id", ids)
          .order("created_at", { ascending: false }),
      ),
    ),
    Promise.all(
      tenantIdChunks.map((ids) =>
        supabase.from("profiles").select("id, full_name").in("id", ids),
      ),
    ),
    Promise.all(
      tenantIdChunks.map((ids) =>
        supabase.from("tenants").select("id, full_name").in("id", ids),
      ),
    ),
    supabase
      .from("payments")
      .select("tenancy_id, room_id, amount")
      .in("property_id", propertyIds)
      .in("category", ["deposit", "rental_deposit", "security_deposit"])
      .eq("status", "confirmed"),
    supabase
      .from("payment_submissions")
      .select("tenancy_id, tenant_record_id, room_id, amount")
      .in("property_id", propertyIds)
      .in("payment_type", ["deposit", "rental_deposit", "security_deposit"])
      .eq("verification_status", "verified"),
  ]);

  const firstError = [
    ...paymentPages,
    ...submissionPages,
    ...profilePages,
    ...tenantPages,
    depositPaymentsResult,
    depositSubmissionsResult,
  ].find((result) => result.error)?.error;

  if (firstError) {
    throw new Error(`Unable to load monthly collection details: ${firstError.message}`);
  }

  const payments = paymentPages.flatMap((result) => result.data ?? []) as RawPayment[];
  const submissions = submissionPages.flatMap((result) => result.data ?? []) as RawSubmission[];
  const profileNames = new Map(
    profilePages.flatMap((result) => result.data ?? []).map((profile) => [
      profile.id,
      profile.full_name?.trim() || "Tenant",
    ]),
  );
  const tenantNames = new Map(
    tenantPages.flatMap((result) => result.data ?? []).map((tenant) => [
      tenant.id,
      tenant.full_name?.trim() || "Tenant",
    ]),
  );
  const tenantRecordById = new Map(
    tenantRecords.map((tenant) => [tenant.id, tenant]),
  );
  const tenantRecordByRoom = new Map(
    tenantRecords
      .filter((tenant) => tenant.room_id && tenant.status === "active")
      .map((tenant) => [tenant.room_id as string, tenant]),
  );
  const tenancyByRoom = new Map<string, RawTenancy>();
  const tenancyById = new Map(tenancies.map((tenancy) => [tenancy.id, tenancy]));

  for (const tenancy of tenancies) {
    if (tenancy.room_id && !tenancyByRoom.has(tenancy.room_id)) {
      tenancyByRoom.set(tenancy.room_id, tenancy);
    }
  }

  const addAmount = (
    map: Map<string, number>,
    key: string | null,
    amount: number | string,
  ) => {
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + Number(amount ?? 0));
  };
  const depositPaymentsByTenancy = new Map<string, number>();
  const depositPaymentsByRoom = new Map<string, number>();
  const depositSubmissionsByTenancy = new Map<string, number>();
  const depositSubmissionsByRecord = new Map<string, number>();
  const depositSubmissionsByRoom = new Map<string, number>();

  for (const payment of (depositPaymentsResult.data ?? []) as RawDepositPayment[]) {
    addAmount(depositPaymentsByTenancy, payment.tenancy_id, payment.amount);
    addAmount(depositPaymentsByRoom, payment.room_id, payment.amount);
  }
  for (const submission of (depositSubmissionsResult.data ?? []) as RawDepositSubmission[]) {
    addAmount(depositSubmissionsByTenancy, submission.tenancy_id, submission.amount);
    addAmount(depositSubmissionsByRecord, submission.tenant_record_id, submission.amount);
    addAmount(depositSubmissionsByRoom, submission.room_id, submission.amount);
  }

  const depositOutstandingFor = (
    tenancy: RawTenancy | null | undefined,
    tenantRecord: (typeof tenantRecords)[number] | null | undefined,
    roomId: string,
    paidThroughInvoice = 0,
  ) => {
    const required = Number(tenancy?.deposit ?? tenantRecord?.deposit ?? 0);
    if (required <= 0) return 0;

    const canonicalReceived = tenancy
      ? depositPaymentsByTenancy.get(tenancy.id)
        ?? depositPaymentsByRoom.get(roomId)
        ?? 0
      : depositPaymentsByRoom.get(roomId) ?? 0;
    const submittedReceived = tenancy
      ? depositSubmissionsByTenancy.get(tenancy.id)
        ?? (tenantRecord
          ? depositSubmissionsByRecord.get(tenantRecord.id)
          : undefined)
        ?? depositSubmissionsByRoom.get(roomId)
        ?? 0
      : (tenantRecord
        ? depositSubmissionsByRecord.get(tenantRecord.id)
        : undefined)
        ?? depositSubmissionsByRoom.get(roomId)
        ?? 0;
    const separatelyRecorded =
      canonicalReceived > 0 ? canonicalReceived : submittedReceived;
    const received = Math.max(separatelyRecorded, paidThroughInvoice);

    return Math.max(required - received, 0);
  };

  const paymentsByBill = new Map<string, RawPayment[]>();
  for (const payment of payments) {
    const billPayments = paymentsByBill.get(payment.rent_bill_id) ?? [];
    billPayments.push(payment);
    paymentsByBill.set(payment.rent_bill_id, billPayments);
  }

  const submissionsByBill = new Map<string, RawSubmission[]>();
  for (const submission of submissions) {
    const billSubmissions = submissionsByBill.get(submission.rent_bill_id) ?? [];
    billSubmissions.push(submission);
    submissionsByBill.set(submission.rent_bill_id, billSubmissions);
  }

  const previousOutstandingByOwner = new Map<string, number>();
  for (const bill of previousBills) {
    const amount = Number(bill.amount ?? 0);
    const paidAmount = Number(bill.paid_amount ?? 0);
    const outstanding = Math.max(amount - Math.min(paidAmount, amount), 0);
    if (outstanding <= 0) continue;
    const key = balanceOwnerKey(bill);
    previousOutstandingByOwner.set(
      key,
      (previousOutstandingByOwner.get(key) ?? 0) + outstanding,
    );
  }

  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const collections: RentCollectionRow[] = selectedBills.map((bill) => {
    const billPayments = paymentsByBill.get(bill.id) ?? [];
    const linkedVerifiedTotal = billPayments.reduce(
      (total, payment) => total + Number(payment.amount ?? 0),
      0,
    );
    const billedPaidAmount = Number(bill.paid_amount ?? 0);
    const verifiedTotal = Math.max(linkedVerifiedTotal, billedPaidAmount);
    const currentAmountDue = Number(bill.amount ?? 0);
    const paidAmount = Math.min(verifiedTotal, currentAmountDue);
    const outstanding = Math.max(currentAmountDue - paidAmount, 0);
    const billedDeposit = Number(bill.deposit_amount ?? 0);
    const depositPaidThroughInvoice = billedDeposit > 0
      ? Math.min(
          Math.max(verifiedTotal - currentAmountDue, 0),
          billedDeposit,
        )
      : 0;
    const previousOutstanding = previousOutstandingByOwner.get(balanceOwnerKey(bill)) ?? 0;
    const pendingVerification =
      ["payment_submitted", "pending_verification", "submitted"].includes(
        String(bill.status),
      )
      || (submissionsByBill.get(bill.id) ?? []).some(
        (submission) => submission.verification_status === "pending_verification",
      );
    const settlementStatus = outstanding <= 0
      ? "paid"
      : paidAmount > 0
        ? "partially_paid"
        : "unpaid";
    const tenancy = bill.tenancy_id ? tenancyById.get(bill.tenancy_id) : null;
    const tenantRecord = bill.tenant_record_id
      ? tenantRecordById.get(bill.tenant_record_id)
      : null;
    const room = roomById.get(bill.room_id);
    const property = propertyById.get(bill.property_id);
    const depositOutstanding = depositOutstandingFor(
      tenancy,
      tenantRecord,
      bill.room_id,
      depositPaidThroughInvoice,
    );

    return {
      billId: bill.id,
      tenancyId: bill.tenancy_id,
      tenantId: bill.tenant_id,
      tenantRecordId: bill.tenant_record_id,
      propertyId: bill.property_id,
      propertyName: property?.name ?? "Property",
      roomId: bill.room_id,
      roomNumber: room?.room_number || room?.name || "Room",
      tenantName:
        tenantRecord?.full_name
        ?? (bill.tenant_id ? tenantNames.get(bill.tenant_id) : null)
        ?? (bill.tenant_id ? profileNames.get(bill.tenant_id) : null)
        ?? (tenancy?.tenant_id ? tenantNames.get(tenancy.tenant_id) : null)
        ?? "Tenant",
      monthlyRent: currentAmountDue,
      previousOutstanding,
      currentAmountDue,
      paidAmount,
      outstanding,
      depositOutstanding,
      totalOutstanding: previousOutstanding + outstanding + depositOutstanding,
      creditAmount: Math.max(
        verifiedTotal
          - currentAmountDue
          - billedDeposit,
        0,
      ),
      dueDate: bill.due_date,
      latestPaymentDate: billPayments[0]?.payment_date ?? null,
      paymentCount: billPayments.length,
      settlementStatus,
      paymentStatus: pendingVerification ? "pending_verification" : settlementStatus,
    };
  });

  const billedRoomIds = new Set(selectedBills.map((bill) => bill.room_id));
  const monthlyPaymentsByRoom = new Map<string, RawMonthlyRoomPayment[]>();
  for (const payment of confirmedMonthlyRoomPayments) {
    const roomPayments = monthlyPaymentsByRoom.get(payment.room_id) ?? [];
    roomPayments.push(payment);
    monthlyPaymentsByRoom.set(payment.room_id, roomPayments);
  }

  // A confirmed rent payment can occasionally be linked to the prior bill when
  // the current invoice is missing. Count that occupied room once without
  // changing invoice-based money totals or inventing a duplicate bill.
  for (const tenancy of tenancies) {
    if (billedRoomIds.has(tenancy.room_id)) continue;
    const roomPayments = monthlyPaymentsByRoom.get(tenancy.room_id) ?? [];
    const matchingPayments = roomPayments.filter(
      (payment) =>
        !payment.tenancy_id || payment.tenancy_id === tenancy.id,
    );
    if (!matchingPayments.length) continue;

    const room = roomById.get(tenancy.room_id);
    const property = propertyById.get(tenancy.property_id);
    const tenantRecord = tenantRecordByRoom.get(tenancy.room_id);
    collections.push({
      billId: `confirmed-payment:${matchingPayments[0].id}`,
      tenancyId: tenancy.id,
      tenantId: tenancy.tenant_id,
      tenantRecordId: tenantRecord?.id ?? null,
      propertyId: tenancy.property_id,
      propertyName: property?.name ?? "Property",
      roomId: tenancy.room_id,
      roomNumber: room?.room_number || room?.name || "Room",
      tenantName:
        tenantRecord?.full_name
        ?? (tenancy.tenant_id ? tenantNames.get(tenancy.tenant_id) : null)
        ?? (tenancy.tenant_id ? profileNames.get(tenancy.tenant_id) : null)
        ?? "Tenant",
      monthlyRent: Number(tenancy.monthly_rental ?? 0),
      previousOutstanding:
        previousOutstandingByOwner.get(
          `record:${tenantRecord?.id ?? ""}:${tenancy.room_id}`,
        ) ?? 0,
      currentAmountDue: 0,
      paidAmount: 0,
      outstanding: 0,
      depositOutstanding: depositOutstandingFor(
        tenancy,
        tenantRecord,
        tenancy.room_id,
      ),
      totalOutstanding: depositOutstandingFor(
        tenancy,
        tenantRecord,
        tenancy.room_id,
      ),
      creditAmount: 0,
      dueDate: matchingPayments[0].payment_date,
      latestPaymentDate: matchingPayments[0].payment_date,
      paymentCount: matchingPayments.length,
      settlementStatus: "paid",
      paymentStatus: "paid",
    });
  }

  const collectionByBillId = new Map(
    collections.map((collection) => [collection.billId, collection]),
  );
  const billsByRoom = new Map<string, RawRentBill[]>();
  for (const bill of selectedBills) {
    const roomBills = billsByRoom.get(bill.room_id) ?? [];
    roomBills.push(bill);
    billsByRoom.set(bill.room_id, roomBills);
  }

  const roomsByProperty = new Map<string, RentMapRoom[]>();
  for (const room of rooms) {
    const tenancy = tenancyByRoom.get(room.id);
    const tenantRecord = tenantRecordByRoom.get(room.id);
    const roomBills = billsByRoom.get(room.id) ?? [];
    const bill = roomBills.find((item) => item.tenancy_id === tenancy?.id) ?? roomBills[0];
    const collection = bill ? collectionByBillId.get(bill.id) : null;
    let status: RentMapStatus;

    if (collection) {
      status = collection.depositOutstanding > 0 && collection.settlementStatus === "paid"
        ? "partially_paid"
        : collection.settlementStatus;
    } else if (selectedMonth !== currentMonth) {
      status = "no_bill";
    } else if (room.status === "vacant") {
      status = "vacant";
    } else if (room.status === "reserved") {
      status = "reserved";
    } else if (room.status === "maintenance") {
      status = "maintenance";
    } else {
      status = "no_bill";
    }

    const activeTenantName = tenancy?.tenant_id
      ? tenantNames.get(tenancy.tenant_id) ?? profileNames.get(tenancy.tenant_id)
      : null;
    const roomView: RentMapRoom = {
      id: room.id,
      propertyId: room.property_id,
      roomNumber: room.room_number || room.name,
      tenantName: collection?.tenantName ?? activeTenantName ?? tenantRecord?.full_name ?? null,
      dueDay:
        dueDayFromDate(collection?.dueDate)
        ?? tenancy?.rent_due_day
        ?? tenancy?.due_day
        ?? tenantRecord?.due_day
        ?? null,
      dueDate: collection?.dueDate ?? null,
      outstanding:
        (collection?.outstanding ?? 0)
        + (collection?.depositOutstanding ?? 0),
      depositOutstanding: collection?.depositOutstanding ?? 0,
      previousOutstanding: collection?.previousOutstanding ?? 0,
      billedAmount: collection?.currentAmountDue ?? 0,
      paidAmount: collection?.paidAmount ?? 0,
      status,
      billStatus: bill?.status ?? null,
      paymentStatus: collection?.paymentStatus ?? null,
      latestPaymentDate: collection?.latestPaymentDate ?? null,
      billId: bill?.id ?? null,
    };

    const propertyRooms = roomsByProperty.get(room.property_id) ?? [];
    propertyRooms.push(roomView);
    roomsByProperty.set(room.property_id, propertyRooms);
  }

  const propertyViews = properties.map((property) => {
    const propertyCollections = collections
      .filter((collection) => collection.propertyId === property.id)
      .sort((left, right) =>
        roomNumberCollator.compare(left.roomNumber, right.roomNumber),
      );

    return {
      id: property.id,
      name: property.name,
      code: property.property_code,
      area: property.area,
      rooms: (roomsByProperty.get(property.id) ?? []).sort((left, right) =>
        roomNumberCollator.compare(left.roomNumber, right.roomNumber),
      ),
      collections: propertyCollections,
      summary: summarizeRentCollections(propertyCollections),
    };
  });

  return {
    currentMonth,
    selectedMonth,
    selectedMonthLabel: monthLabel(selectedMonth),
    properties: propertyViews,
    summary: summarizeRentCollections(collections),
  };
}

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type RentDueBucket =
  | "before_7"
  | "before_6"
  | "before_5"
  | "before_4"
  | "before_3"
  | "before_2"
  | "before_1"
  | "due_today"
  | "overdue_1"
  | "overdue_2"
  | "overdue_3"
  | "overdue_4"
  | "overdue_5"
  | "overdue_6"
  | "overdue_7"
  | "overdue_more_7"
  | "other";

export type RentDueBill = {
  id: string;
  tenant_id: string;
  tenancy_id: string;
  property_id: string;
  unit_id: string | null;
  room_id: string;
  bill_month: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: string;
  tenantName: string;
  tenantPhone: string | null;
  propertyName: string;
  unitName: string;
  roomName: string;
  latestSubmissionId: string | null;
  latestSubmissionStatus: string | null;
  latestReceiptUrl: string | null;
  latestPaymentReference: string | null;
  outstandingAmount: number;
  daysUntilDue: number;
  bucket: RentDueBucket;
  dueStatus: "coming_up" | "due_today" | "overdue" | "severely_overdue" | "other";
  paymentStatus: string;
};

export type RentDueSummary = {
  bills: RentDueBill[];
  counts: Record<RentDueBucket, number>;
  totalDueOverdue: number;
  totalComingUp: number;
  totalOutstanding: number;
  dueToday: number;
  comingUpIn7Days: number;
  overdueTenants: number;
  pendingPaymentSlips: number;
  rentCollectedThisMonth: number;
};

const trackerBuckets: RentDueBucket[] = [
  "before_7",
  "before_6",
  "before_5",
  "before_4",
  "before_3",
  "before_2",
  "before_1",
  "due_today",
  "overdue_1",
  "overdue_2",
  "overdue_3",
  "overdue_4",
  "overdue_5",
  "overdue_6",
  "overdue_7",
  "overdue_more_7",
  "other",
];

async function getDataClient() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export function malaysiaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function dateUtc(date: string) {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

export function dayDifference(dueDate: string, currentDate = malaysiaDateString()) {
  return Math.round((dateUtc(dueDate) - dateUtc(currentDate)) / 86_400_000);
}

export function rentDueBucket(daysUntilDue: number): RentDueBucket {
  if (daysUntilDue >= 1 && daysUntilDue <= 7) {
    return `before_${daysUntilDue}` as RentDueBucket;
  }
  if (daysUntilDue === 0) {
    return "due_today";
  }
  if (daysUntilDue <= -1 && daysUntilDue >= -7) {
    return `overdue_${Math.abs(daysUntilDue)}` as RentDueBucket;
  }
  if (daysUntilDue < -7) {
    return "overdue_more_7";
  }
  return "other";
}

export function dueStatus(daysUntilDue: number) {
  if (daysUntilDue >= 1 && daysUntilDue <= 7) {
    return "coming_up" as const;
  }
  if (daysUntilDue === 0) {
    return "due_today" as const;
  }
  if (daysUntilDue <= -1 && daysUntilDue >= -7) {
    return "overdue" as const;
  }
  if (daysUntilDue < -7) {
    return "severely_overdue" as const;
  }
  return "other" as const;
}

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function getRentDueSummary(filters?: {
  bucket?: string;
  property?: string;
  unit?: string;
  room?: string;
  tenant?: string;
  month?: string;
  dueStatus?: string;
  paymentStatus?: string;
  daysOverdue?: string;
  search?: string;
}) {
  const supabase = await getDataClient();
  const currentDate = malaysiaDateString();
  const currentMonth = currentDate.slice(0, 7);

  let billsQuery = supabase
    .from("rent_bills")
    .select("id, tenancy_id, tenant_id, property_id, unit_id, room_id, bill_month, due_date, amount, paid_amount, status, properties(name), units(name), rooms(name, room_number)")
    .not("status", "in", "(paid,cancelled,waived)")
    .order("due_date", { ascending: true });

  if (filters?.property) {
    billsQuery = billsQuery.eq("property_id", filters.property);
  }
  if (filters?.unit) {
    billsQuery = billsQuery.eq("unit_id", filters.unit);
  }
  if (filters?.room) {
    billsQuery = billsQuery.eq("room_id", filters.room);
  }
  if (filters?.tenant) {
    billsQuery = billsQuery.eq("tenant_id", filters.tenant);
  }
  if (filters?.month) {
    billsQuery = billsQuery.gte("bill_month", `${filters.month}-01`).lt("bill_month", nextMonth(filters.month));
  }

  const [billsResult, profilesResult, submissionsResult, paymentsResult] = await Promise.all([
    billsQuery,
    supabase.from("profiles").select("id, full_name, phone, role"),
    supabase
      .from("payment_submissions")
      .select("id, tenant_id, rent_bill_id, verification_status, receipt_url, reference_number, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("amount, payment_date, status")
      .eq("category", "monthly_rent")
      .eq("status", "confirmed")
      .gte("payment_date", `${currentMonth}-01`)
      .lt("payment_date", nextMonth(currentMonth)),
  ]);

  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const latestSubmissionByBill = new Map<string, {
    id: string;
    verification_status: string;
    receipt_url: string | null;
    reference_number: string | null;
  }>();

  for (const submission of submissionsResult.data ?? []) {
    if (submission.rent_bill_id && !latestSubmissionByBill.has(submission.rent_bill_id)) {
      latestSubmissionByBill.set(submission.rent_bill_id, submission);
    }
  }

  let bills: RentDueBill[] = (billsResult.data ?? []).map((bill) => {
    const tenant = profileById.get(bill.tenant_id);
    const property = single(bill.properties);
    const unit = single(bill.units);
    const room = single(bill.rooms);
    const latestSubmission = latestSubmissionByBill.get(bill.id);
    const amount = Number(bill.amount ?? 0);
    const paidAmount = Number(bill.paid_amount ?? 0);
    const outstandingAmount = Math.max(amount - paidAmount, 0);
    const daysUntilDue = dayDifference(bill.due_date, currentDate);
    const bucket = rentDueBucket(daysUntilDue);
    const calculatedDueStatus = dueStatus(daysUntilDue);
    const paymentStatus = latestSubmission?.verification_status === "pending_verification"
      ? "pending_verification"
      : bill.status;

    return {
      id: bill.id,
      tenant_id: bill.tenant_id,
      tenancy_id: bill.tenancy_id,
      property_id: bill.property_id,
      unit_id: bill.unit_id,
      room_id: bill.room_id,
      bill_month: bill.bill_month,
      due_date: bill.due_date,
      amount,
      paid_amount: paidAmount,
      status: bill.status,
      tenantName: tenant?.full_name ?? tenant?.phone ?? bill.tenant_id,
      tenantPhone: tenant?.phone ?? null,
      propertyName: property?.name ?? "-",
      unitName: unit?.name ?? "-",
      roomName: room?.room_number ?? room?.name ?? "-",
      latestSubmissionId: latestSubmission?.id ?? null,
      latestSubmissionStatus: latestSubmission?.verification_status ?? null,
      latestReceiptUrl: latestSubmission?.receipt_url ?? null,
      latestPaymentReference: latestSubmission?.reference_number ?? null,
      outstandingAmount,
      daysUntilDue,
      bucket,
      dueStatus: calculatedDueStatus,
      paymentStatus,
    };
  });

  if (filters?.bucket && filters.bucket !== "all") {
    bills = bills.filter((bill) => bill.bucket === filters.bucket);
  }
  if (filters?.dueStatus && filters.dueStatus !== "all") {
    bills = bills.filter((bill) => bill.dueStatus === filters.dueStatus);
  }
  if (filters?.paymentStatus && filters.paymentStatus !== "all") {
    bills = bills.filter((bill) => bill.paymentStatus === filters.paymentStatus);
  }
  if (filters?.daysOverdue) {
    const days = Number(filters.daysOverdue);
    if (Number.isFinite(days)) {
      bills = bills.filter((bill) => bill.daysUntilDue === -days);
    }
  }
  if (filters?.search) {
    const needle = filters.search.toLowerCase();
    bills = bills.filter((bill) =>
      bill.tenantName.toLowerCase().includes(needle)
      || String(bill.tenantPhone ?? "").toLowerCase().includes(needle)
      || bill.roomName.toLowerCase().includes(needle),
    );
  }

  const counts = trackerBuckets.reduce((acc, bucket) => {
    acc[bucket] = 0;
    return acc;
  }, {} as Record<RentDueBucket, number>);

  for (const bill of bills) {
    counts[bill.bucket] += 1;
  }

  const comingUp = bills.filter((bill) => bill.dueStatus === "coming_up");
  const dueOrOverdue = bills.filter((bill) => ["due_today", "overdue", "severely_overdue"].includes(bill.dueStatus));
  const pendingPaymentSlips = bills.filter((bill) => bill.paymentStatus === "pending_verification").length;
  const rentCollectedThisMonth = (paymentsResult.data ?? []).reduce((total, payment) => total + Number(payment.amount ?? 0), 0);

  return {
    bills,
    counts,
    totalDueOverdue: dueOrOverdue.length,
    totalComingUp: comingUp.length,
    totalOutstanding: bills.reduce((total, bill) => total + bill.outstandingAmount, 0),
    dueToday: bills.filter((bill) => bill.bucket === "due_today").length,
    comingUpIn7Days: comingUp.length,
    overdueTenants: bills.filter((bill) => bill.daysUntilDue < 0).length,
    pendingPaymentSlips,
    rentCollectedThisMonth,
  } satisfies RentDueSummary;
}

export function nextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

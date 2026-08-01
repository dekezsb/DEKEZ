import { addDays, calculateTermEndDate } from "@/lib/e-tenancy";
import { createClient } from "@/lib/supabase/server";

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(new Date());
}

function daysBetween(left: string, right: string) {
  const leftDate = Date.parse(`${left}T00:00:00Z`);
  const rightDate = Date.parse(`${right}T00:00:00Z`);
  return Math.round((leftDate - rightDate) / 86_400_000);
}

export type RenewalTrackerBucket =
  | "days_60_46"
  | "days_45_31"
  | "days_30_15"
  | "days_14_1"
  | "expires_today"
  | "expired";

export type RenewalDecisionStatus =
  | "pending"
  | "requested"
  | "renew"
  | "not_renew";

export type RenewalTrackerItem = {
  tenancyId: string;
  tenantName: string;
  phone: string | null;
  propertyName: string;
  roomName: string;
  isCommercial: boolean;
  monthlyRent: number;
  contractEndDate: string;
  nextStartDate: string;
  nextEndDate: string;
  nextTermAlreadyExpired: boolean;
  daysUntilExpiry: number;
  bucket: RenewalTrackerBucket;
  decisionStatus: RenewalDecisionStatus;
  decisionRequestedAt: string | null;
  decisionRecordedAt: string | null;
  agreementId: string | null;
  agreementStatus: string | null;
};

export type AgreementRenewalSummary = {
  items: RenewalTrackerItem[];
  counts: Record<RenewalTrackerBucket, number>;
  needReminder: number;
  waitingReply: number;
  confirmedRenewal: number;
  notRenewing: number;
  unsignedAgreements: number;
};

function bucketFor(daysUntilExpiry: number): RenewalTrackerBucket {
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry === 0) return "expires_today";
  if (daysUntilExpiry <= 14) return "days_14_1";
  if (daysUntilExpiry <= 30) return "days_30_15";
  if (daysUntilExpiry <= 45) return "days_45_31";
  return "days_60_46";
}

export async function getAgreementRenewalReminders(): Promise<AgreementRenewalSummary> {
  const supabase = await createClient();
  const today = malaysiaToday();
  const reminderCutoff = addDays(today, 60);
  const { data: tenancyRows } = await supabase
    .from("tenancies")
    .select(
      "id, monthly_rental, tenancy_end_date, contract_end, checkout_date, status, billing_status, tenants(full_name, phone), properties(name, is_commercial), rooms!tenancies_room_id_fkey(name, room_number)",
    )
    .eq("status", "active")
    .is("checkout_date", null);

  const dueTenancies = (tenancyRows ?? []).filter((tenancy) => {
    const contractEndDate = tenancy.tenancy_end_date ?? tenancy.contract_end;
    return Boolean(
      contractEndDate &&
        contractEndDate <= reminderCutoff &&
        !["terminated", "completed"].includes(tenancy.billing_status ?? ""),
    );
  });
  const tenancyIds = dueTenancies.map((tenancy) => tenancy.id);

  const emptyCounts: Record<RenewalTrackerBucket, number> = {
    days_60_46: 0,
    days_45_31: 0,
    days_30_15: 0,
    days_14_1: 0,
    expires_today: 0,
    expired: 0,
  };
  if (!tenancyIds.length) {
    return {
      items: [],
      counts: emptyCounts,
      needReminder: 0,
      waitingReply: 0,
      confirmedRenewal: 0,
      notRenewing: 0,
      unsignedAgreements: 0,
    };
  }

  const [renewalsResult, agreementsResult] = await Promise.all([
    supabase
      .from("tenancy_renewals")
      .select(
        "id, tenancy_id, new_start_date, new_end_date, decision_status, decision_requested_at, decision_recorded_at, updated_at",
      )
      .in("tenancy_id", tenancyIds)
      .order("updated_at", { ascending: false }),
    supabase
      .from("tenancy_agreements")
      .select(
        "id, tenancy_id, term_start_date, status, signed_at, generated_at",
      )
      .in("tenancy_id", tenancyIds)
      .eq("term_type", "renewal")
      .is("admin_rejected_at", null)
      .order("generated_at", { ascending: false }),
  ]);

  const decisionByCycle = new Map<
    string,
    {
      decision_status: RenewalDecisionStatus;
      decision_requested_at: string | null;
      decision_recorded_at: string | null;
      new_end_date: string | null;
    }
  >();
  for (const renewal of renewalsResult.data ?? []) {
    if (!renewal.new_start_date) continue;
    const key = `${renewal.tenancy_id}:${renewal.new_start_date}`;
    if (!decisionByCycle.has(key)) {
      decisionByCycle.set(key, {
        decision_status:
          (renewal.decision_status as RenewalDecisionStatus) ?? "pending",
        decision_requested_at: renewal.decision_requested_at,
        decision_recorded_at: renewal.decision_recorded_at,
        new_end_date: renewal.new_end_date,
      });
    }
  }

  const agreementByCycle = new Map<
    string,
    { id: string; status: string; signed_at: string | null }
  >();
  for (const agreement of agreementsResult.data ?? []) {
    if (!agreement.term_start_date) continue;
    const key = `${agreement.tenancy_id}:${agreement.term_start_date}`;
    if (!agreementByCycle.has(key)) {
      agreementByCycle.set(key, agreement);
    }
  }

  const items = dueTenancies
    .map((tenancy) => {
      const contractEndDate = tenancy.tenancy_end_date ?? tenancy.contract_end;
      if (!contractEndDate) return null;
      const nextStartDate = addDays(contractEndDate, 1);
      const key = `${tenancy.id}:${nextStartDate}`;
      const decision = decisionByCycle.get(key);
      const agreement = agreementByCycle.get(key);
      const tenant = first(tenancy.tenants);
      const property = first(tenancy.properties);
      const room = first(tenancy.rooms);
      const daysUntilExpiry = daysBetween(contractEndDate, today);
      const nextEndDate =
        decision?.new_end_date ??
        calculateTermEndDate(
          nextStartDate,
          property?.is_commercial ? 12 : 6,
        );

      return {
        tenancyId: tenancy.id,
        tenantName: tenant?.full_name ?? "Tenant",
        phone: tenant?.phone ?? null,
        propertyName: property?.name ?? "Property",
        roomName: room?.room_number ?? room?.name ?? "Room",
        isCommercial: property?.is_commercial ?? false,
        monthlyRent: Number(tenancy.monthly_rental ?? 0),
        contractEndDate,
        nextStartDate,
        nextEndDate,
        nextTermAlreadyExpired: nextEndDate < today,
        daysUntilExpiry,
        bucket: bucketFor(daysUntilExpiry),
        decisionStatus: decision?.decision_status ?? "pending",
        decisionRequestedAt: decision?.decision_requested_at ?? null,
        decisionRecordedAt: decision?.decision_recorded_at ?? null,
        agreementId: agreement?.id ?? null,
        agreementStatus: agreement?.status ?? null,
      } satisfies RenewalTrackerItem;
    })
    .filter((item): item is RenewalTrackerItem => item !== null)
    .sort((left, right) => left.daysUntilExpiry - right.daysUntilExpiry);

  const counts = { ...emptyCounts };
  for (const item of items) counts[item.bucket] += 1;

  return {
    items,
    counts,
    needReminder: items.filter((item) => item.decisionStatus === "pending")
      .length,
    waitingReply: items.filter((item) => item.decisionStatus === "requested")
      .length,
    confirmedRenewal: items.filter(
      (item) => item.decisionStatus === "renew",
    ).length,
    notRenewing: items.filter((item) => item.decisionStatus === "not_renew")
      .length,
    unsignedAgreements: items.filter(
      (item) =>
        item.decisionStatus === "renew" &&
        item.agreementId &&
        !["signed", "renewal_signed"].includes(item.agreementStatus ?? ""),
    ).length,
  };
}

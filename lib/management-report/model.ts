export type ReportKind = "daily" | "test";
export type ReportSnapshot = {
  company_id: string;
  report_date: string;
  as_of: string;
  collected_today: number | null;
  collected_month: number | null;
  outstanding: number | null;
  overdue: number | null;
  overdue_tenants: number | null;
  pending_count: number | null;
  pending_amount: number | null;
  rooms_total: number | null;
  occupied: number | null;
  vacant: number | null;
  reserved: number | null;
  maintenance_rooms: number | null;
  maintenance_active: number | null;
  maintenance_urgent: number | null;
  waiting_for_parts: number | null;
  missing_bill_context: number;
  missing_bill_amount: number;
};

export function malaysiaReportDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map(k => parts.find(p => p.type === k)?.value).join("-");
}

export function isDailyReportTime(now: Date) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", hourCycle: "h23",
  }).format(now)) === 20;
}

function metric(value: number | null | undefined, money = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return money ? `RM${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value.toLocaleString("en-MY");
}

export function formatReport(s: ReportSnapshot, kind: ReportKind) {
  const time = new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(s.as_of));
  return [
    `${kind === "test" ? "[TEST] " : ""}DEKEZ Management Report`,
    `${s.report_date} · As of ${time} MYT`,
    "", "RENTAL",
    `Collected today: ${metric(s.collected_today, true)}`,
    `Collected month-to-date: ${metric(s.collected_month, true)}`,
    `Rental invoice outstanding*: ${metric(s.outstanding, true)}`,
    `Overdue invoice balance*: ${metric(s.overdue, true)}`,
    `Overdue tenants: ${metric(s.overdue_tenants)}`,
    `Payment slips awaiting verification: ${metric(s.pending_count)} (${metric(s.pending_amount, true)})`,
    "", "ROOMS",
    `Occupied: ${metric(s.occupied)} · Vacant: ${metric(s.vacant)} · Total: ${metric(s.rooms_total)}`,
    `Reserved: ${metric(s.reserved)} · Maintenance: ${metric(s.maintenance_rooms)}`,
    "", "MAINTENANCE / REPAIR",
    `Open jobs: ${metric(s.maintenance_active)} · Urgent follow-ups: ${metric(s.maintenance_urgent)}`,
    `Waiting for parts: ${metric(s.waiting_for_parts)}`,
    "", "*Invoice balances include billed extra charges, exclude security deposits. Collections use confirmed rental payment dates; pending slips are not collections.",
    "Current snapshot, not a final end-of-day accounting statement. Review details in DEKEZ.",
    ...(s.missing_bill_context || s.missing_bill_amount ? ["Data quality: some invoice amounts, due dates or tenant links require review; affected metrics are unavailable."] : []),
  ].join("\n");
}

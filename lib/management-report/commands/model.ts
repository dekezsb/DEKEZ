import { formatReport, type ReportSnapshot } from "../model";
import { APPROVED_REPORT_RECIPIENT } from "../recipient";

export const REPORT_CHANNEL = "FALCON-D9NS9";
export const REPORT_CHAT = `${APPROVED_REPORT_RECIPIENT}@s.whatsapp.net`;
export const COMMANDS = ["due_overdue", "collection", "monthly", "vacant", "maintenance", "full", "help"] as const;
export type ReportCommand = typeof COMMANDS[number];
export type IncomingReportCommand = {
  id: string; sender: string; chat: string; channel: string;
  command: ReportCommand; receivedAt: string;
};
export type DueSnapshot = Pick<ReportSnapshot, "company_id" | "report_date" | "as_of" | "overdue" | "overdue_tenants" | "missing_bill_context" | "missing_bill_amount"> & {
  due_today: number | null; due_today_tenants: number | null; due_today_invoices: number | null;
  overdue_invoices: number | null; combined_tenants: number | null;
};

const aliases: Record<string, ReportCommand> = {
  "today's due and overdue": "due_overdue", "todays due and overdue": "due_overdue", "due and overdue": "due_overdue",
  "today's rental collection": "collection", "todays rental collection": "collection", "today's collection": "collection", "todays collection": "collection",
  "monthly rental report": "monthly", "vacant rooms": "vacant", "maintenance report": "maintenance",
  "full management report": "full", "help": "help", "report commands": "help",
};

// Deliberately not an AI agent: only complete allowlisted phrases, never SQL,
// amounts, phone numbers, dates, arbitrary filters or instructions from text.
export function parseReportCommand(text: string): ReportCommand | null {
  if (text.length > 200) return null;
  const normalized = text.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ")
    .replace(/^please /, "").replace(/^send me /, "").replace(/[.!?]$/, "").trim();
  return Object.hasOwn(aliases, normalized) ? aliases[normalized] : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Identity comes exclusively from the authenticated provider envelope. LID-only
// identities are denied until a separately verified mapping is implemented.
export function incomingReportCommands(payload: unknown, now: Date): IncomingReportCommand[] {
  if (!record(payload) || payload.channel_id !== REPORT_CHANNEL || !record(payload.event)
    || payload.event.type !== "messages" || payload.event.event !== "post"
    || !Array.isArray(payload.messages) || payload.messages.length > 50) return [];
  const seen = new Set<string>();
  const result: IncomingReportCommand[] = [];
  for (const message of payload.messages) {
    if (!record(message) || message.from_me !== false || message.type !== "text"
      || message.from !== APPROVED_REPORT_RECIPIENT || message.chat_id !== REPORT_CHAT
      || typeof message.id !== "string" || !/^[A-Za-z0-9._-]{1,200}$/.test(message.id)
      || typeof message.timestamp !== "number" || !Number.isSafeInteger(message.timestamp)
      || message.timestamp < now.getTime() / 1000 - 900 || message.timestamp > now.getTime() / 1000 + 60
      || !record(message.text) || typeof message.text.body !== "string") continue;
    const command = parseReportCommand(message.text.body);
    if (!command || seen.has(message.id)) continue;
    seen.add(message.id);
    result.push({ id: message.id, sender: message.from, chat: message.chat_id, channel: REPORT_CHANNEL,
      command, receivedAt: new Date(message.timestamp * 1000).toISOString() });
  }
  return result;
}

const metric = (value: number | null | undefined, money = false) =>
  typeof value !== "number" || !Number.isFinite(value) || value < 0 ? "Unavailable"
    : money ? `RM${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value.toLocaleString("en-MY");

export function commandHelp() {
  return "DEKEZ AI MANAGER · Reporting commands\n\nToday's due and overdue\nToday's rental collection\nMonthly rental report\nVacant rooms\nMaintenance report\nFull management report\n\nRead-only company summaries, Malaysia time. No tenant personal details. Send one command per message.";
}

export function formatCommandReport(command: Exclude<ReportCommand, "help">, snapshot: ReportSnapshot | DueSnapshot) {
  if (command === "full") return `[REQUESTED] ${formatReport(snapshot as ReportSnapshot, "daily")}`;
  const s = snapshot as ReportSnapshot & DueSnapshot;
  const time = new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s.as_of));
  const lines = ["DEKEZ AI MANAGER · Requested Report", `${s.report_date} · As of ${time} MYT`, ""];
  if (command === "due_overdue") lines.push("TODAY'S DUE AND OVERDUE",
    `Unpaid invoices due today: ${metric(s.due_today_invoices)}`,
    `Due today balance*: ${metric(s.due_today, true)} · Distinct tenants: ${metric(s.due_today_tenants)}`,
    `Overdue invoices (before today): ${metric(s.overdue_invoices)}`,
    `Overdue balance*: ${metric(s.overdue, true)} · Distinct tenants: ${metric(s.overdue_tenants)}`,
    `Distinct tenants across both groups: ${metric(s.combined_tenants)}`,
    "*Unpaid issued rental invoices, including billed extras and excluding security deposits. A tenant can appear in both groups; the combined count is deduplicated.");
  if (command === "collection") lines.push("TODAY'S RENTAL COLLECTION",
    `Collected today: ${metric(s.collected_today, true)}`,
    `Payment slips awaiting verification: ${metric(s.pending_count)} (${metric(s.pending_amount, true)})`,
    "Confirmed, non-reversed rental payments dated today only. Pending slips are not collections.");
  if (command === "monthly") lines.push("MONTHLY RENTAL REPORT",
    `Collection period: ${s.report_date.slice(0, 7)}-01 to ${s.report_date} (month-to-date)`,
    `Rental collected: ${metric(s.collected_month, true)}`,
    `Current rental invoice outstanding*: ${metric(s.outstanding, true)}`,
    `Current overdue balance*: ${metric(s.overdue, true)} · Distinct tenants: ${metric(s.overdue_tenants)}`,
    `Payment slips awaiting verification: ${metric(s.pending_count)} (${metric(s.pending_amount, true)})`,
    "*Current balances cover all issued periods, not only this month; include billed extras, exclude security deposits. Collections exclude pending/reversed payments.");
  if (command === "vacant") lines.push("ROOM AVAILABILITY",
    `Vacant rooms: ${metric(s.vacant)}`, `Occupied: ${metric(s.occupied)} · Total: ${metric(s.rooms_total)}`,
    `Reserved: ${metric(s.reserved)} · Maintenance: ${metric(s.maintenance_rooms)}`,
    "Company totals only. See DEKEZ Room Availability for individual rooms.");
  if (command === "maintenance") lines.push("MAINTENANCE / REPAIR",
    `Active jobs: ${metric(s.maintenance_active)}`, `Urgent follow-ups: ${metric(s.maintenance_urgent)}`,
    `Waiting for parts: ${metric(s.waiting_for_parts)}`, "Active maintenance/repair cases only; excludes completed jobs and cleaning tasks.");
  if ((command === "due_overdue" || command === "monthly") && (s.missing_bill_context || s.missing_bill_amount))
    lines.push("Data quality: some invoice amounts, dates or tenant links require review; affected figures are unavailable.");
  lines.push("", "Current read-only snapshot, not a final accounting statement. Review details in DEKEZ.");
  return lines.join("\n");
}

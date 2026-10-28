import { malaysiaReportDate } from "@/lib/management-report/model";

export type CollectionStage = "advance_7" | "due_today" | "overdue_1_6" | "day_7_review" | "overdue_8_13" | "day_14_review" | "overdue_15_plus" | "tracking" | "resolved" | "exception";
export type CollectionInvoice = {
  id: string; tenancy_id: string | null; property_id: string | null; room_id: string | null;
  reference: string | null; property: string | null; property_code: string | null; room: string | null;
  due_date: string | null; days_overdue: number | null; base_amount: number | null; extra_amount: number | null;
  paid_amount: number | null; verified_paid: number | null; outstanding: number | null; status: string;
  pending: unknown[]; exceptions: string[]; collectible: boolean;
};
export type CollectionPreviewItem = {
  company_id: string; report_date: string; key: string; tenant_id: string | null; name: string | null; phone: string | null;
  recipient_source?: "tenant_portal_login"; masked_phone?: string | null; phone_valid?: boolean;
  protected_recipient?: boolean; whatsapp_ownership_verified?: boolean; delivery_blocks?: string[];
  stage: CollectionStage; days_overdue: number | null; recorded_days_overdue: number | null; outstanding: number | null; collectible_outstanding: number | null; arrears_outstanding: number | null; arrears_resolved: boolean; partial_invoices: number;
  invoices: CollectionInvoice[]; pending: unknown[]; pending_verification: boolean; exceptions: string[];
  policy: { enabled: boolean; compliance_approved: boolean; consent: string; hold: string; opt_out_ready?: boolean; approved_recipient?: string | null };
  send_eligible: boolean; resolved: boolean; fingerprint: string;
};
export type CollectionPreview = {
  company_id: string; report_date: string; as_of: string; items: CollectionPreviewItem[]; next_cursor: string | null;
  summary: { tenants: number; groups: number; unlinked_records: number; stages: {stage: CollectionStage; tenants: number; groups: number; unlinked_records: number; amount: number; recorded_amount: number; partial_tenants: number; send_eligible: number}[];
    exceptions: {code: string; tenants: number}[]; pending_verification: number;
    delivery_blocks?: {code: string; groups: number; tenants: number; unlinked_records: number}[] };
};
export type CollectionHistory = {
  items: { tenant_key: string; stage: CollectionStage; outstanding: number | null; last_checked_at: string;
    snapshot: CollectionPreviewItem; delivery: null | {state: string; delivery_state?: string; delivery_updated_at?: string | null; provider_message_id: string | null; created_at: string; finished_at: string | null; error_code: string | null} }[];
  next_cursor: string | null; new_day_7_reviews: number; new_day_14_reviews: number;
};

export const collectionStageLabels: Record<CollectionStage, string> = {
  advance_7: "Due in 7 days", due_today: "Due today", overdue_1_6: "Overdue 1–6 days",
  day_7_review: "Day 7 — urgent account review", overdue_8_13: "Overdue 8–13 — final warnings",
  day_14_review: "Day 14 — termination review", overdue_15_plus: "15+ days — urgent follow-up",
  tracking: "Outstanding — tracking", resolved: "Verified settlement", exception: "Data exception — review required",
};

export function collectionStage(days: number | null, outstanding: number): CollectionStage {
  if (!Number.isFinite(outstanding) || outstanding < 0 || days === null || !Number.isInteger(days)) return "exception";
  if (outstanding === 0) return "resolved";
  if (days === -7) return "advance_7";
  if (days === 0) return "due_today";
  if (days > 0 && days < 7) return "overdue_1_6";
  if (days === 7) return "day_7_review";
  if (days > 7 && days < 14) return "overdue_8_13";
  if (days === 14) return "day_14_review";
  return days > 14 ? "overdue_15_plus" : "tracking";
}

export function originalOverdueDays(dueDate: string, now: Date): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate) throw new Error("Invalid original due date.");
  return Math.round((Date.parse(`${malaysiaReportDate(now)}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

export function isCollectionTime(now: Date): boolean {
  return new Intl.DateTimeFormat("en-GB", {timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", hourCycle: "h23"}).format(now) === "09";
}
export function collectionMoney(amount: number | null) {
  return amount === null || !Number.isFinite(amount) ? "Unavailable" : `RM ${amount.toLocaleString("en-MY", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}
const safeLabel = (value: string | null) => (value || "Unavailable").replace(/[\r\n\t\u0000-\u001f]/g, " ").slice(0, 100);
const dateLabel = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? new Intl.DateTimeFormat("en-GB", {day: "numeric", month: "long", year: "numeric", timeZone: "UTC"}).format(new Date(`${value}T00:00:00Z`)) : "Unavailable";

// A preview is not an authorization to send. Database claims independently recheck
// current balances, identity, consent, holds and the original invoice clock.
export function formatCollectionMessage(item: CollectionPreviewItem): string | null {
  if (item.pending_verification) return [
    "DEKEZ MANAGEMENT — PAYMENT VERIFICATION", "", "Dear Tenant,", "",
    "We have received your submitted rental payment and its verification is pending.",
    "Please check the relevant payment submission in your DEKEZ Tenant Portal.",
    "We will update the account once verification is completed. The submitted amount should not be demanded again while verification is pending.",
    "", "Thank you,", "DEKEZ Management",
  ].join("\n");
  if (item.resolved || item.outstanding === null || item.outstanding <= 0 || ["tracking", "resolved", "exception"].includes(item.stage)
    || item.exceptions.length > 0 || !item.invoices.length) return null;
  const allOutstanding = item.invoices.filter(i => i.outstanding !== null && i.outstanding > 0);
  if (!allOutstanding.length || allOutstanding.some(i => !i.due_date || i.days_overdue === null || i.verified_paid === null || !Number.isFinite(i.verified_paid))) return null;
  if (allOutstanding.reduce((sum, i) => sum + Math.round(i.outstanding! * 100), 0) !== Math.round(item.outstanding * 100)) return null;
  // Scan every invoice, but never demand a future balance as overdue. Advance
  // reminders contain exactly the invoices due in seven days, not nearer dates.
  const invoices = allOutstanding.filter(i => item.stage === "advance_7" ? i.days_overdue === -7 : i.days_overdue! >= 0);
  if (!invoices.length) return null;
  const multi = invoices.length > 1;
  const total = invoices.reduce((sum, i) => sum + Math.round(i.outstanding! * 100), 0) / 100;
  const days = item.days_overdue;
  const headlines: Partial<Record<CollectionStage, string>> = {
    advance_7: "DEKEZ MANAGEMENT — ADVANCE RENTAL REMINDER", due_today: "DEKEZ MANAGEMENT — PAYMENT DUE TODAY",
    overdue_1_6: "DEKEZ MANAGEMENT — OVERDUE RENTAL NOTICE", day_7_review: "DEKEZ MANAGEMENT — URGENT FINAL PAYMENT WARNING",
    overdue_8_13: "DEKEZ MANAGEMENT — FINAL-STAGE OVERDUE REMINDER", day_14_review: "DEKEZ MANAGEMENT — FINAL DEFAULT NOTICE",
    overdue_15_plus: "DEKEZ MANAGEMENT — OUTSTANDING RENT FOLLOW-UP",
  };
  const opening = item.stage === "advance_7" ? "This is a friendly reminder from DEKEZ Management. The rental invoice(s) listed below are due in 7 days."
    : item.stage === "due_today" ? "Your rental payment is due TODAY."
    : `${multi ? "Your oldest outstanding rental invoice is" : "Your rental account is now"} ${days} ${days === 1 ? "day" : "days"} overdue.`;
  const details = invoices.flatMap((i, index) => [
    ...(multi ? [`Invoice ${index + 1}: ${safeLabel(i.reference)}`] : []),
    `Property/Room: ${safeLabel(i.property_code || i.property)} / ${safeLabel(i.room)}`,
    `Original Due Date: ${dateLabel(i.due_date)}`,
    ...(multi ? [`Overdue days: ${i.days_overdue! > 0 ? i.days_overdue : 0}${i.days_overdue! < 0 ? " (not yet due)" : ""}`] : []),
    `Total Verified Payments: ${collectionMoney(i.verified_paid)}`,
    `Remaining Outstanding Balance: ${collectionMoney(i.outstanding)}`, "",
  ]);
  const action = item.stage === "advance_7" ? "Please arrange payment through the DEKEZ Tenant Portal before the due date to avoid overdue escalation."
    : item.stage === "due_today" ? "Please complete payment through the DEKEZ Tenant Portal today. If your payment is pending verification, please check your payment status in the portal."
    : item.stage === "overdue_1_6" ? "Please settle the outstanding rent promptly through your DEKEZ Tenant Portal.\n\nUnresolved accounts are escalated for account-restriction review at Day 7 and formal tenancy termination review at Day 14, subject to your tenancy agreement and applicable law.\n\nIf you have already submitted payment, please inform Management so we can verify it."
    : item.stage === "day_7_review" ? "Your account has been escalated for urgent management review.\n\nPlease settle the verified rental arrears immediately or contact DEKEZ Management if your payment is disputed or pending verification.\n\nContinued default may result in formal tenancy termination review from Day 14, subject to your agreement and applicable law."
    : item.stage === "overdue_8_13" ? "Your account remains under management escalation review. If the amount is not resolved, it will be referred for formal tenancy termination review on Day 14.\n\nPlease settle the amount or contact Management immediately if you have already paid or dispute the balance."
    : item.stage === "day_14_review" ? "Despite any partial payments made, the remaining rental balance has not been fully settled within the required period.\n\nYour account has been referred for formal tenancy termination review under the DEKEZ collection policy.\n\nPlease contact DEKEZ Management immediately to resolve the outstanding amount.\n\nAny termination or enforcement action remains subject to the signed tenancy agreement and applicable law."
    : "Please settle the outstanding amount or contact Management to resolve the account.\n\nYour case remains under formal management review. Further action, if required, will follow the appropriate legal process.";
  const body = [headlines[item.stage], "", "Dear Tenant,", "", opening, "", ...details,
    ...(multi ? [`Total due / overdue invoice balance: ${collectionMoney(total)}`, "Review thresholds apply separately to each original due date; partial payments do not extend it.", ""] : []),
    ...(invoices.some(i => i.extra_amount !== 0) ? ["Invoice balances include billed extra charges and exclude security deposits. Refer to the portal for the breakdown.", ""] : []),
    action, "", "DEKEZ Management"].join("\n");
  // Never truncate financial details to fit WhatsApp. Route oversized cases to Admin.
  return body.length <= 4000 ? body : null;
}

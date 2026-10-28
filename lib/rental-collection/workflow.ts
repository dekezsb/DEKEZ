import type { buildCollectionFailureReportPreview } from "./failure-report";

export type ReminderFollowupAccount = ReturnType<typeof buildCollectionFailureReportPreview>["actionList"][number];
export const reminderQueues = [
  {key: "all", label: "All follow-ups"},
  {key: "phone", label: "Phone / identity"},
  {key: "consent", label: "Consent / STOP / holds"},
  {key: "payment", label: "Payment / source review"},
  {key: "delivery", label: "Delivery outcomes"},
] as const;
export type ReminderQueue = typeof reminderQueues[number]["key"];

// Presentation only: this never clears a hold, decides send eligibility or changes
// a balance. Input must already be filtered by authenticated company access.
export function inReminderQueue(row: ReminderFollowupAccount, queue: ReminderQueue) {
  if (queue === "all") return true;
  if (queue === "phone") return !row.tenant_id || !row.loginPhone || row.categories.includes("invalid_login_phone");
  if (queue === "consent") return row.categories.includes("communications_hold");
  if (queue === "payment") return row.categories.includes("source_exception");
  return row.categories.some(category => ["confirmed_failure", "awaiting_delivery", "delivery_unknown", "unconfirmed_rejection", "evidence_conflict"].includes(category));
}

export function reminderWorklist(rows: readonly ReminderFollowupAccount[], requestedQueue?: string, requestedPage?: string) {
  const queue: ReminderQueue = reminderQueues.some(item => item.key === requestedQueue) ? requestedQueue as ReminderQueue : "all";
  const matching = rows.filter(row => inReminderQueue(row, queue));
  const pages = Math.max(1, Math.ceil(matching.length / 25));
  const value = requestedPage && /^[1-9][0-9]{0,5}$/.test(requestedPage) ? Number(requestedPage) : 1;
  const page = Math.min(value, pages);
  return {queue, page, pages, total: matching.length, rows: matching.slice((page - 1) * 25, page * 25),
    counts: reminderQueues.map(item => ({...item, count: rows.filter(row => inReminderQueue(row, item.key)).length}))};
}

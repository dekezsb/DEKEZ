import "server-only";
import { setTimeout as pace } from "node:timers/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaReportDate } from "@/lib/management-report/model";
import { sendWhapiReport } from "@/lib/management-report/whapi";
import { collectionConfig } from "./config";
import { formatCollectionMessage, isCollectionTime, type CollectionPreview, type CollectionHistory } from "./model";
import { collectionCommunicationHolds, tenantReminderRecipient } from "./recipient";

// One deadline covers both the tenant batch and its consolidated follow-up.
// Keep 20 seconds below the route's 300-second limit; never renew this budget
// after claiming a worker lease or a delivery reservation.
export const COLLECTION_REQUEST_BUDGET_MS = 280_000;
export const COLLECTION_RPC_BUDGET_MS = 30_000;
export function collectionHasBudget(deadline: number, required: number) {
  return Number.isFinite(deadline) && deadline - Date.now() >= required;
}
export function collectionRpc<T>(request: {abortSignal(signal: AbortSignal): PromiseLike<T>}, deadline = Date.now() + COLLECTION_RPC_BUDGET_MS): PromiseLike<T> {
  const remaining = Math.min(COLLECTION_RPC_BUDGET_MS, Math.floor(deadline - Date.now()));
  return request.abortSignal(remaining > 0 ? AbortSignal.timeout(remaining) : AbortSignal.abort());
}
// Claim30 + provider15 + delivery-finalization30 + run-finalization30 + margin5.
const TENANT_CLAIM_RESERVE_MS = 110_000;
const TENANT_SEND_RESERVE_MS = 80_000;

function scope() {
  const config = collectionConfig();
  if (!config.scopeReady) throw new Error("Collection company scope is not configured.");
  return config;
}
export async function collectionPreview(now = new Date(), after: string | null = null, limit = 25, deadline?: number): Promise<CollectionPreview> {
  const config = scope();
  const {data, error} = await collectionRpc(createAdminClient().rpc("dekez_collection_preview", {
    p_company: config.companyId, p_as_of: now.toISOString(), p_after: after, p_limit: limit,
  }), deadline);
  if (error || !data || data.company_id !== config.companyId || data.report_date !== malaysiaReportDate(now)) throw new Error("Collection preview is unavailable. No reminders were sent.");
  return data as CollectionPreview;
}
export async function collectionHistory(day = malaysiaReportDate(), after: string | null = null, limit = 25): Promise<CollectionHistory> {
  const config = scope();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Invalid reporting date.");
  const {data, error} = await createAdminClient().rpc("dekez_collection_history", {p_company: config.companyId, p_day: day, p_after: after, p_limit: limit});
  if (error || !data) throw new Error("Collection history is unavailable.");
  return data as CollectionHistory;
}

async function runRentalCollectionBatch(now: Date, deadline: number) {
  // These are standing activation/policy gates, not per-day approval tokens.
  // Each scheduled run scans fresh data and claims only currently eligible rows.
  const config = collectionConfig();
  if (!config.policyEnabled || !config.scopeReady) return {state: "disabled"};
  if (!isCollectionTime(now)) return {state: "outside_window"};
  const client = createAdminClient();
  // The full company scan and review ledger complete first, even when all sends
  // are held. A timeout rolls the scan back; never silently report partial success.
  if (!collectionHasBudget(deadline, COLLECTION_RPC_BUDGET_MS)) return {state: "incomplete", reason: "budget_review_required"};
  const {data: scan, error: scanError} = await collectionRpc(client.rpc("dekez_collection_scan", {p_company: config.companyId}), deadline);
  if (scanError || !scan) throw new Error("Daily collection review failed. No reminders were sent.");
  if (!config.sendEnabled || !config.token) return {state: "review_only", scan};
  if (!collectionHasBudget(deadline, 2 * COLLECTION_RPC_BUDGET_MS + TENANT_CLAIM_RESERVE_MS)) return {state: "incomplete", reason: "budget_review_required", scan};
  const {data: run, error: runError} = await collectionRpc(client.rpc("dekez_collection_begin_run", {p_company: config.companyId}), deadline);
  if (runError || !run) throw new Error("Payment reminder run reservation failed. No reminders were sent.");
  if (!run.claimed) return {state: run.state, scan};
  let runState = "incomplete";
  try {
  let after: string | null = null;
  const counts = {accepted: 0, rejected: 0, uncertain: 0, withheld: 0};
  do {
    // Reserve time for the final claim, provider timeout and durable finalization,
    // including scan/page time in the 300-second function budget.
    if (!collectionHasBudget(deadline, COLLECTION_RPC_BUDGET_MS + TENANT_CLAIM_RESERVE_MS)) return {state: "incomplete", reason: "budget_review_required", scan, counts};
    const page = await collectionPreview(now, after, 25, deadline);
    for (const item of page.items) {
      if (!item.send_eligible || collectionCommunicationHolds(item).length > 0) {counts.withheld++; continue;}
      // Bounded, sequential transport. Never launch an unbounded fan-out. A
      // partial batch is explicit, not retried automatically; all cases were tracked.
      if (!collectionHasBudget(deadline, TENANT_CLAIM_RESERVE_MS)) return {state: "incomplete", reason: "budget_review_required", scan, counts};
      let body: string | null;
      try {body = formatCollectionMessage(item);} catch {body = null;}
      if (!body) {
        // Retain a durable, narrowly scoped follow-up when a source is otherwise
        // eligible but its consolidated message cannot safely be rendered/sent.
        const {data: hold, error: holdError} = await collectionRpc(client.rpc("dekez_collection_record_message_hold", {
          p_company: config.companyId, p_key: item.key, p_fingerprint: item.fingerprint,
        }), deadline);
        if (holdError || !hold || !["recorded", "source_changed", "withheld", "not_found"].includes(hold.state)) {
          throw new Error("Message review could not be recorded. Check private history before retrying.");
        }
        counts.withheld++; continue;
      }
      // Conservative sequential pacing; channel-specific limits still require
      // approval before activation. Recheck the source only AFTER this wait.
      if (counts.accepted > 0) await pace(1000);
      if (!collectionHasBudget(deadline, TENANT_CLAIM_RESERVE_MS)) return {state: "incomplete", reason: "budget_review_required", scan, counts};
      const {data: claim, error} = await collectionRpc(client.rpc("dekez_collection_claim", {
        p_company: config.companyId, p_key: item.key, p_fingerprint: item.fingerprint, p_body: body,
      }), deadline);
      if (error || !claim) throw new Error("Collection reservation failed. Review private delivery history before retrying.");
      if (!claim.claimed) {counts.withheld++; continue;}
      // Never accept a routing override, a protected management number or a
      // changed message after review. Retain the reservation for investigation.
      if (claim.recipient !== tenantReminderRecipient(item.phone) || claim.body !== body) {
        await collectionRpc(client.rpc("dekez_collection_finish", {
          p_attempt: claim.attempt_id, p_state: "uncertain", p_provider_id: null,
          p_http_status: null, p_error: "worker_interrupted",
        }), deadline);
        return {state: "recipient_review_required", scan, counts};
      }
      if (!collectionHasBudget(deadline, TENANT_SEND_RESERVE_MS)) {
        // A late reservation is retained and explicitly marked uncertain. No
        // provider call or automatic lease/reservation reset is permitted.
        await collectionRpc(client.rpc("dekez_collection_finish", {
          p_attempt: claim.attempt_id, p_state: "uncertain", p_provider_id: null,
          p_http_status: null, p_error: "worker_interrupted",
        }), deadline);
        return {state: "incomplete", reason: "budget_review_required", scan, counts};
      }
      const outcome = await sendWhapiReport(config.token, claim.recipient, claim.body);
      const {error: finishError} = await collectionRpc(client.rpc("dekez_collection_finish", {
        p_attempt: claim.attempt_id, p_state: outcome.state, p_provider_id: outcome.providerId,
        p_http_status: outcome.httpStatus, p_error: outcome.errorCode,
      }), deadline);
      if (finishError) return {state: "uncertain", scan, counts: {...counts, uncertain: counts.uncertain + 1}};
      counts[outcome.state]++;
      // Any uncertain delivery or provider rejection stops this run. No blind
      // retries, and especially no continued sending after rate-limit responses.
      if (outcome.state !== "accepted") return {state: outcome.state, scan, counts};
    }
    after = page.next_cursor;
  } while (after);
  runState = "complete";
  return {state: "complete", scan, counts};
  } catch (error) {runState = "failed"; throw error;}
  finally {
    const {error} = await collectionRpc(client.rpc("dekez_collection_finish_run", {p_run: run.run_id, p_state: runState}), deadline);
    if (error) throw new Error("Payment reminder run needs review. Do not retry automatically.");
  }
}

export async function runRentalCollections(now = new Date()) {
  const deadline = Date.now() + COLLECTION_REQUEST_BUDGET_MS;
  const result = await runRentalCollectionBatch(now, deadline);
  if (["disabled", "outside_window"].includes(result.state)) return result;
  // One consolidated follow-up; later receipts only update the portal/history.
  // The separate digest flag and durable daily reservation remain authoritative.
  const {sendCollectionFailureDigest} = await import("./failure-service");
  let followUpReport: Awaited<ReturnType<typeof sendCollectionFailureDigest>> | {state: "review_required"};
  try { followUpReport = await sendCollectionFailureDigest(now, deadline); }
  catch { followUpReport = {state: "review_required"}; }
  // A completed tenant phase is not a completed combined run when the required
  // management report was withheld or failed. Surface that as an incomplete
  // cron outcome without reopening either ledger, retrying or taking time from
  // eligible tenants. Provider acceptance still does not prove final delivery.
  const followUpNeedsReview = !["disabled", "outside_window", "no_followups", "accepted", "already_reserved"].includes(followUpReport.state);
  if (followUpNeedsReview && !["uncertain", "rejected", "incomplete", "recipient_review_required"].includes(result.state)) {
    return {...result, tenantState: result.state, state: "incomplete", reason: "followup_review_required", followUpReport, followUpNeedsReview};
  }
  return {...result, followUpReport, followUpNeedsReview};
}

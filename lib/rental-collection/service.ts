import "server-only";
import { setTimeout as pace } from "node:timers/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaReportDate } from "@/lib/management-report/model";
import { sendWhapiReport } from "@/lib/management-report/whapi";
import { collectionConfig } from "./config";
import { formatCollectionMessage, isCollectionTime, type CollectionPreview, type CollectionHistory } from "./model";

function scope() {
  const config = collectionConfig();
  if (!config.scopeReady) throw new Error("Collection company scope is not configured.");
  return config;
}
export async function collectionPreview(now = new Date(), after: string | null = null, limit = 25): Promise<CollectionPreview> {
  const config = scope();
  const {data, error} = await createAdminClient().rpc("dekez_collection_preview", {
    p_company: config.companyId, p_as_of: now.toISOString(), p_after: after, p_limit: limit,
  });
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

export async function runRentalCollections(now = new Date()) {
  const started = Date.now();
  const config = collectionConfig();
  if (!config.policyEnabled || !config.scopeReady) return {state: "disabled"};
  if (!isCollectionTime(now)) return {state: "outside_window"};
  const client = createAdminClient();
  // The full company scan and review ledger complete first, even when all sends
  // are held. A timeout rolls the scan back; never silently report partial success.
  const {data: scan, error: scanError} = await client.rpc("dekez_collection_scan", {p_company: config.companyId});
  if (scanError || !scan) throw new Error("Daily collection review failed. No reminders were sent.");
  if (!config.sendEnabled || !config.token) return {state: "review_only", scan};
  let after: string | null = null;
  const counts = {accepted: 0, rejected: 0, uncertain: 0, withheld: 0};
  do {
    // Reserve time for the final claim, provider timeout and durable finalization,
    // including scan/page time in the 300-second function budget.
    if (Date.now() - started > 230_000) return {state: "incomplete", scan, counts};
    const page = await collectionPreview(now, after, 25);
    for (const item of page.items) {
      if (!item.send_eligible || item.pending_verification) {counts.withheld++; continue;}
      // Bounded, sequential transport. Never launch an unbounded fan-out. A
      // partial batch is explicit, not retried automatically; all cases were tracked.
      if (Date.now() - started > 250_000) return {state: "incomplete", scan, counts};
      const body = formatCollectionMessage(item);
      if (!body) {counts.withheld++; continue;}
      // Conservative sequential pacing; channel-specific limits still require
      // approval before activation. Recheck the source only AFTER this wait.
      if (counts.accepted > 0) await pace(1000);
      const {data: claim, error} = await client.rpc("dekez_collection_claim", {
        p_company: config.companyId, p_key: item.key, p_fingerprint: item.fingerprint, p_body: body,
      });
      if (error || !claim) throw new Error("Collection reservation failed. Review private delivery history before retrying.");
      if (!claim.claimed) {counts.withheld++; continue;}
      const outcome = await sendWhapiReport(config.token, claim.recipient, claim.body);
      const {error: finishError} = await client.rpc("dekez_collection_finish", {
        p_attempt: claim.attempt_id, p_state: outcome.state, p_provider_id: outcome.providerId,
        p_http_status: outcome.httpStatus, p_error: outcome.errorCode,
      });
      if (finishError) return {state: "uncertain", scan, counts: {...counts, uncertain: counts.uncertain + 1}};
      counts[outcome.state]++;
      // Any uncertain delivery or provider rejection stops this run. No blind
      // retries, and especially no continued sending after rate-limit responses.
      if (outcome.state !== "accepted") return {state: outcome.state, scan, counts};
    }
    after = page.next_cursor;
  } while (after);
  return {state: "complete", scan, counts};
}

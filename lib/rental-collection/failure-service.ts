import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectionConfig } from "./config";
import { collectionPreview, collectionHasBudget, collectionRpc, COLLECTION_REQUEST_BUDGET_MS, COLLECTION_RPC_BUDGET_MS } from "./service";
import { buildCollectionFailureReportPreview, COLLECTION_FAILURE_REPORT_RECIPIENT,
  type CollectionFailureEvidence, type CollectionContactCaseEvidence, type FailureReportRecipientAuthorization } from "./failure-report";
import type { CollectionPreviewItem } from "./model";
import { isCollectionTime } from "./model";
import { sendWhapiReport } from "@/lib/management-report/whapi";

export type CollectionDigestStatus = {
  report_date: string; state: string; delivery_state: string; error_code: string | null;
  updated_at: string | null; needs_admin_review: boolean;
};
type EvidencePage = {report_date: string; fingerprint: string; recipient_authorization: FailureReportRecipientAuthorization | null;
  digest_status?: CollectionDigestStatus | null; digest_alerts?: CollectionDigestStatus[]; digest_alert_count?: number;
  items: {key: string; kind: "attempt" | "case"; data: CollectionFailureEvidence | CollectionContactCaseEvidence}[];
  next_cursor: string | null; total: number; daily_reservation: "unknown" | "not_reserved" | "reserved" | "sent"};
// Three source reads may each take30s. Claim30 + provider15 + finish30 + margin5
// must remain AFTER the preview; the enclosing worker's deadline is never reset.
const DIGEST_PREVIEW_BUDGET_MS = 90_000;
const DIGEST_CLAIM_RESERVE_MS = 80_000;
const DIGEST_SEND_RESERVE_MS = 50_000;
class CollectionBudgetError extends Error {
  constructor() { super("Reminder follow-up budget requires review."); }
}

// Read-only, bounded pagination. Any changing source or incomplete history
// withholds the digest rather than silently omitting a tenant.
export async function collectionFailurePreview(now = new Date(), portalAuthorized = false, requestDeadline = Date.now() + DIGEST_PREVIEW_BUDGET_MS) {
  const config = collectionConfig();
  if (!config.scopeReady) throw new Error("Reminder follow-up company is not configured.");
  const client = createAdminClient(), started = Date.now();
  const deadline = Math.min(requestDeadline, started + DIGEST_PREVIEW_BUDGET_MS);
  let budgetReviewRequired = false;
  const page = async (after: string | null): Promise<EvidencePage> => {
    if (!collectionHasBudget(deadline, COLLECTION_RPC_BUDGET_MS)) throw new CollectionBudgetError();
    const {data, error} = await collectionRpc(client.rpc("dekez_collection_failure_evidence", {p_company: config.companyId, p_after: after, p_limit: 100}), deadline);
    if (error || !data || !Array.isArray(data.items) || typeof data.fingerprint !== "string") throw new Error("Reminder follow-up evidence is unavailable.");
    return data as EvidencePage;
  };
  const anchor = await page(null);
  const current: CollectionPreviewItem[] = [], evidence: CollectionFailureEvidence[] = [], contact: CollectionContactCaseEvidence[] = [];
  let complete = true, after: string | null = null, rounds = 0;
  const cursors = new Set<string>();
  do {
    if (++rounds > 100 || Date.now() - started > 45_000) { complete = false; break; }
    // Leave a complete source-read allowance for the final authorization and
    // fingerprint recheck. Partial evidence is never sent or exposed as complete.
    if (!collectionHasBudget(deadline, 2 * COLLECTION_RPC_BUDGET_MS)) {complete = false; budgetReviewRequired = true; break;}
    const preview = await collectionPreview(now, after, 100, deadline);
    if (preview.report_date !== anchor.report_date) {complete = false; break;}
    current.push(...preview.items); after = preview.next_cursor;
    if (after && cursors.has(after)) {complete = false; break;} if (after) cursors.add(after);
  } while (after);
  let batch = anchor; rounds = 0; cursors.clear();
  do {
    if (++rounds > 100 || Date.now() - started > 50_000 || batch.fingerprint !== anchor.fingerprint) {complete = false; break;}
    for (const item of batch.items) {
      if (item.kind === "attempt") evidence.push(item.data as CollectionFailureEvidence);
      else if (item.kind === "case") contact.push(item.data as CollectionContactCaseEvidence);
      else complete = false;
    }
    after = batch.next_cursor;
    if (after && cursors.has(after)) {complete = false; break;} if (after) cursors.add(after);
    if (after) {
      if (!collectionHasBudget(deadline, 2 * COLLECTION_RPC_BUDGET_MS)) {complete = false; budgetReviewRequired = true; break;}
      batch = await page(after);
    }
  } while (after);
  let final: EvidencePage;
  if (collectionHasBudget(deadline, COLLECTION_RPC_BUDGET_MS)) final = await page(null);
  else {complete = false; budgetReviewRequired = true; final = {...anchor, recipient_authorization: null};}
  complete = complete && final.fingerprint === anchor.fingerprint && evidence.length + contact.length === anchor.total;
  const dailyComplete = !evidence.some(item => ["sending", "pending", "accepted", "uncertain", "unknown"].includes(item.state));
  const preview = buildCollectionFailureReportPreview({company_id: config.companyId, report_date: anchor.report_date,
    current_items: current, evidence, contact_cases: contact, all_history_loaded: complete, daily_outcomes_complete: dailyComplete,
    recipient_authorization: final.recipient_authorization, daily_reservation: final.daily_reservation, portal_authorized: portalAuthorized});
  return {...preview, fingerprint: anchor.fingerprint, allHistoryLoaded: complete, budgetReviewRequired,
    digestStatusAvailable: portalAuthorized && Object.hasOwn(final, "digest_status"),
    digestStatus: portalAuthorized ? final.digest_status ?? null : null,
    digestAlerts: portalAuthorized ? final.digest_alerts ?? [] : [],
    digestAlertCount: portalAuthorized ? final.digest_alert_count ?? 0 : 0,
    reviewableAttempts: portalAuthorized && complete ? evidence.filter(item => item.resolved_at === null && item.state !== "delivered")
      .map(item => ({id: item.attempt_id, name: current.find(row => row.tenant_id === item.tenant_id)?.name ?? "Account requires review", state: item.state})) : [],
    companyId: config.companyId, reportDate: anchor.report_date, recipientAuthorization: final.recipient_authorization};
}

export async function sendCollectionFailureDigest(now = new Date(), deadline = Date.now() + COLLECTION_REQUEST_BUDGET_MS) {
  const config = collectionConfig();
  if (!config.policyEnabled || !config.sendEnabled || !config.scopeReady || !config.token
    || process.env.DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED !== "true") return {state: "disabled"};
  if (!isCollectionTime(now)) return {state: "outside_window"};
  if (!collectionHasBudget(deadline, DIGEST_PREVIEW_BUDGET_MS + DIGEST_CLAIM_RESERVE_MS)) return {state: "budget_review_required"};
  let preview;
  try {preview = await collectionFailurePreview(now, false, deadline - DIGEST_CLAIM_RESERVE_MS);}
  catch (error) {if (error instanceof CollectionBudgetError) return {state: "budget_review_required"}; throw error;}
  if (preview.budgetReviewRequired) return {state: "budget_review_required"};
  if (!preview.allHistoryLoaded) return {state: "incomplete_evidence"};
  if (!preview.followUpGroups) return {state: "no_followups"};
  if (!collectionHasBudget(deadline, DIGEST_CLAIM_RESERVE_MS)) return {state: "budget_review_required"};
  const client = createAdminClient();
  const {data: claim, error} = await collectionRpc(client.rpc("dekez_collection_failure_claim", {
    p_company: config.companyId, p_fingerprint: preview.fingerprint, p_body: preview.body,
    p_snapshot: {company_id: config.companyId, report_date: preview.reportDate, recipient: COLLECTION_FAILURE_REPORT_RECIPIENT,
      all_history_loaded: true, contains_personal_details: preview.containsPersonalDetails},
  }), deadline);
  if (error || !claim) throw new Error("Daily follow-up report reservation failed. Do not retry without review.");
  if (!claim.claimed) return {state: claim.state};
  if (claim.recipient !== COLLECTION_FAILURE_REPORT_RECIPIENT || claim.body !== preview.body) {
    await collectionRpc(client.rpc("dekez_collection_failure_finish", {p_attempt: claim.attempt_id, p_state: "uncertain", p_provider_id: null, p_http_status: null, p_error: "worker_interrupted"}), deadline);
    return {state: "recipient_review_required"};
  }
  if (!collectionHasBudget(deadline, DIGEST_SEND_RESERVE_MS)) {
    await collectionRpc(client.rpc("dekez_collection_failure_finish", {p_attempt: claim.attempt_id, p_state: "uncertain", p_provider_id: null, p_http_status: null, p_error: "worker_interrupted"}), deadline);
    return {state: "budget_review_required"};
  }
  const outcome = await sendWhapiReport(config.token, claim.recipient, claim.body);
  const {error: finishError} = await collectionRpc(client.rpc("dekez_collection_failure_finish", {p_attempt: claim.attempt_id,
    p_state: outcome.state, p_provider_id: outcome.providerId, p_http_status: outcome.httpStatus, p_error: outcome.errorCode}), deadline);
  return {state: finishError ? "uncertain" : outcome.state};
}

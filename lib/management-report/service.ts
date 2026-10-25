import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportConfig } from "./config";
import { formatReport, isDailyReportTime, malaysiaReportDate, type ReportKind, type ReportSnapshot } from "./model";
import { sendWhapiReport } from "./whapi";

export async function reportPreview(now = new Date()) {
  const config = reportConfig();
  if (!config.scopeReady) throw new Error("Report company scope is not configured.");
  const { data, error } = await createAdminClient().rpc("dekez_management_report_snapshot", {
    p_company: config.companyId, p_as_of: now.toISOString(),
  });
  if (error || !data || data.company_id !== config.companyId || data.report_date !== malaysiaReportDate(now)) {
    throw new Error("Report data is unavailable. No message was sent.");
  }
  return data as ReportSnapshot;
}

export async function deliverManagementReport(kind: ReportKind, actor: string | null = null, now = new Date()) {
  const config = reportConfig();
  if (!config.sendEnabled || !config.configured || (kind === "test" ? !config.testEnabled || !actor : !config.scheduleEnabled)) {
    return { state: "disabled" };
  }
  if (kind === "daily" && !isDailyReportTime(now)) return { state: "outside_window" };
  const snapshot = await reportPreview(now);
  const client = createAdminClient();
  const { data: claim, error } = await client.rpc("dekez_management_report_claim", {
    p_company: config.companyId, p_date: snapshot.report_date, p_recipient: config.recipient,
    p_kind: kind, p_snapshot: snapshot, p_body: formatReport(snapshot, kind), p_actor: actor,
  });
  if (error || !claim) throw new Error("Could not reserve report delivery. No message was sent.");
  if (!claim.claimed) return { state: claim.state, duplicate: true };
  const outcome = await sendWhapiReport(config.token, config.recipient, claim.body);
  const { error: finishError } = await client.rpc("dekez_management_report_finish", {
    p_attempt: claim.attempt_id, p_state: outcome.state, p_provider_id: outcome.providerId,
    p_http_status: outcome.httpStatus, p_error: outcome.errorCode,
  });
  if (finishError) {
    console.error("DEKEZ report delivery requires reconciliation", { runId: claim.run_id });
    return { state: "uncertain" };
  }
  if (outcome.state !== "accepted") console.error("DEKEZ report not confirmed", { runId: claim.run_id, state: outcome.state });
  return { state: outcome.state };
}

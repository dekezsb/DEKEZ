import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaReportDate } from "../model";
import { reportPreview } from "../service";
import { sendWhapiReport } from "../whapi";
import { commandConfig } from "./config";
import { commandHelp, formatCommandReport, REPORT_CHANNEL, REPORT_CHAT, type DueSnapshot, type IncomingReportCommand } from "./model";

export async function executeReportCommand(message: IncomingReportCommand, now = new Date()) {
  const config = commandConfig();
  if (!config.ready) return { state: "disabled" };
  if (message.sender !== config.recipient || message.chat !== REPORT_CHAT || message.channel !== REPORT_CHANNEL) return { state: "ignored" };
  const client = createAdminClient();
  // Reservation commits before any data retrieval or outbound request. The DB
  // serializes rate limits and permanently deduplicates provider message IDs.
  const { data: claim, error: claimError } = await client.rpc("dekez_report_command_claim", {
    p_company: config.companyId, p_channel: message.channel, p_message_id: message.id,
    p_sender: message.sender, p_chat: message.chat, p_command: message.command, p_received_at: message.receivedAt,
  });
  if (claimError || !claim) throw new Error("Command reservation unavailable");
  if (!claim.claimed) return { state: claim.state };
  const requestId = claim.request_id;
  let snapshot = null;
  let body: string;
  try {
    if (message.command === "help") body = commandHelp();
    else {
      if (message.command === "due_overdue") {
        const { data, error } = await client.rpc("dekez_report_due_snapshot", { p_company: config.companyId, p_as_of: now.toISOString() });
        if (error || !data) throw new Error("Report unavailable");
        snapshot = data as DueSnapshot;
      } else snapshot = await reportPreview(now);
      if (snapshot.company_id !== config.companyId || snapshot.report_date !== malaysiaReportDate(now)
        || snapshot.report_date !== claim.report_date || new Date(snapshot.as_of).getTime() !== now.getTime()) throw new Error("Report scope mismatch");
      body = formatCommandReport(message.command, snapshot);
    }
  } catch {
    const { error } = await client.rpc("dekez_report_command_finish", {
      p_request: requestId, p_state: "failed", p_snapshot: null, p_body: null,
      p_provider_id: null, p_http_status: null, p_error: "report_unavailable",
    });
    console.error("DEKEZ command report unavailable", { requestId, auditSaved: !error });
    // No partial figures and no automatic retry of the same incoming command.
    return { state: "failed" };
  }
  // Persist the exact content before the network side effect. A crash afterward
  // leaves evidence for manual reconciliation, never a retryable reservation.
  const { data: prepared, error: prepareError } = await client.rpc("dekez_report_command_prepare", {
    p_request: requestId, p_snapshot: snapshot, p_body: body,
  });
  if (prepareError || !prepared?.prepared) {
    console.error("DEKEZ command preparation unavailable", { requestId });
    return { state: "failed" };
  }
  const outcome = await sendWhapiReport(config.token, config.recipient, prepared.body);
  const { error: finishError } = await client.rpc("dekez_report_command_finish", {
    p_request: requestId, p_state: outcome.state, p_snapshot: snapshot, p_body: prepared.body,
    p_provider_id: outcome.providerId, p_http_status: outcome.httpStatus, p_error: outcome.errorCode,
  });
  if (finishError) {
    console.error("DEKEZ command delivery requires reconciliation", { requestId });
    return { state: "uncertain" };
  }
  if (outcome.state !== "accepted") console.error("DEKEZ command delivery not confirmed", { requestId, state: outcome.state });
  return { state: outcome.state };
}

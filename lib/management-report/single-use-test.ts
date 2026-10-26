import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportConfig } from "./config";
import { formatReport, malaysiaReportDate } from "./model";
import { reportPreview } from "./service";
import { sendWhapiReport } from "./whapi";

// This exception is deliberately narrower than ordinary report configuration.
// It never enables the scheduled sender or permits a user-supplied destination.
const TEST_RECIPIENT = "60168173911";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TestAuthorization = {
  state: "ready";
  authorizationId: string;
  expiresAt: string;
  reportDate: string;
  recipient: string;
  body: string;
};

function testConfigurationReady(config: ReturnType<typeof reportConfig>) {
  return config.configured && config.recipient === TEST_RECIPIENT && !config.scheduleEnabled;
}

export async function requestTestAuthorization(actor: string): Promise<TestAuthorization | { state: "unavailable" | "duplicate" }> {
  const config = reportConfig();
  if (!UUID.test(actor) || !testConfigurationReady(config)) return { state: "unavailable" };
  const snapshot = await reportPreview();
  const { data, error } = await createAdminClient().rpc("dekez_management_report_authorize_test", {
    p_company: config.companyId, p_date: snapshot.report_date, p_recipient: config.recipient,
    p_snapshot: snapshot, p_body: formatReport(snapshot, "test"), p_actor: actor,
  });
  if (error || !data) throw new Error("Unable to prepare a test authorization. No message was sent.");
  if (data.state === "duplicate") return { state: "duplicate" };
  if (!UUID.test(data.authorization_id ?? "") || data.company_id !== config.companyId ||
      data.recipient !== TEST_RECIPIENT || data.report_date !== snapshot.report_date ||
      typeof data.body !== "string" || !data.body.startsWith("[TEST]") || data.body.length > 4000 ||
      !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) {
    throw new Error("The test authorization is unavailable. No message was sent.");
  }
  return {
    state: "ready", authorizationId: data.authorization_id, expiresAt: data.expires_at,
    reportDate: data.report_date, recipient: data.recipient, body: data.body,
  };
}

export async function executeAuthorizedTest(actor: string, authorizationId: string) {
  const config = reportConfig();
  if (!UUID.test(actor) || !UUID.test(authorizationId) || !testConfigurationReady(config)) return { state: "unavailable" };

  // The RPC commits consumption AND the existing delivery reservation before HTTP.
  // A lost RPC response, process crash, or uncertain send never reopens this grant.
  const client = createAdminClient();
  const { data: claim, error } = await client.rpc("dekez_management_report_consume_test", {
    p_authorization: authorizationId, p_company: config.companyId, p_recipient: config.recipient, p_actor: actor,
  });
  if (error || !claim) throw new Error("Could not confirm test consumption. Check private delivery state; do not retry.");
  if (!claim.claimed) return { state: String(claim.state), duplicate: claim.state === "duplicate" || claim.state === "consumed" };
  if (!UUID.test(claim.run_id ?? "") || !UUID.test(claim.attempt_id ?? "") ||
      claim.company_id !== config.companyId || claim.recipient !== TEST_RECIPIENT ||
      claim.report_date !== malaysiaReportDate(new Date()) || typeof claim.body !== "string" ||
      !claim.body.startsWith("[TEST]") || claim.body.length > 4000) {
    throw new Error("Invalid delivery reservation. Check private delivery state; do not retry.");
  }

  // Use precisely the server-generated preview the Admin confirmed, not a new
  // report that could change between confirmation and sending (maximum 5 minutes).
  const outcome = await sendWhapiReport(config.token, TEST_RECIPIENT, claim.body);
  const { error: finishError } = await client.rpc("dekez_management_report_finish", {
    p_attempt: claim.attempt_id, p_state: outcome.state, p_provider_id: outcome.providerId,
    p_http_status: outcome.httpStatus, p_error: outcome.errorCode,
  });
  if (finishError) {
    console.error("DEKEZ one-time report requires delivery reconciliation", { runId: claim.run_id });
    return { state: "uncertain" };
  }
  if (outcome.state !== "accepted") console.error("DEKEZ one-time report not confirmed", { runId: claim.run_id, state: outcome.state });
  return { state: outcome.state };
}

export async function revokeTestAuthorization(actor: string, authorizationId: string) {
  const config = reportConfig();
  // Revocation does not require a working provider token or any sending flag.
  if (!UUID.test(actor) || !UUID.test(authorizationId) || !config.scopeReady || config.recipient !== TEST_RECIPIENT) return { state: "unavailable" };
  const { data, error } = await createAdminClient().rpc("dekez_management_report_revoke_test", {
    p_authorization: authorizationId, p_company: config.companyId, p_recipient: config.recipient, p_actor: actor,
  });
  if (error || !data) throw new Error("Unable to confirm cancellation. The authorization still expires automatically.");
  return { state: String(data.state) };
}

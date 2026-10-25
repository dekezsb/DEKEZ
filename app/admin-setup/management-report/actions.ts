"use server";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { deliverManagementReport } from "@/lib/management-report/service";
import { executeAuthorizedTest, requestTestAuthorization, revokeTestAuthorization } from "@/lib/management-report/single-use-test";

export type OneTimeTestState = {
  phase: "idle" | "ready" | "finished";
  message: string;
  authorization?: {
    authorizationId: string;
    expiresAt: string;
    reportDate: string;
    recipient: string;
    body: string;
  };
};

const authorizationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Each submission authenticates afresh; no recipient, company or actor comes from the browser. */
export async function oneTimeTestAction(_previous: OneTimeTestState, form: FormData): Promise<OneTimeTestState> {
  const actor = await reportAdministrator();
  if (!actor) return { phase: "finished", message: "Not authorized to send management reports." };

  const intent = form.get("intent");
  try {
    if (intent === "request") {
      const result = await requestTestAuthorization(actor);
      if (result.state !== "ready") return {
        phase: "finished",
        message: result.state === "duplicate"
          ? "No new authorization created. Today's test already has a delivery record; check it before taking further action."
          : "One-time testing is unavailable. Check configuration, the reviewed migration and the disabled daily schedule.",
      };
      return {
        phase: "ready",
        message: "Nothing has been sent. Review this exact report, then explicitly confirm one delivery before the authorization expires.",
        authorization: {
          authorizationId: result.authorizationId, expiresAt: result.expiresAt,
          reportDate: result.reportDate, recipient: result.recipient, body: result.body,
        },
      };
    }

    const authorizationId = form.get("authorizationId");
    if (typeof authorizationId !== "string" || !authorizationIdPattern.test(authorizationId)) {
      return { phase: "finished", message: "A valid one-time authorization is required. Nothing was sent by this request." };
    }
    if (intent === "cancel") {
      const result = await revokeTestAuthorization(actor, authorizationId);
      return {
        phase: "finished",
        message: result.state === "revoked"
          ? "Authorization cancelled. This cancellation request sent no message."
          : "Cancellation could not be confirmed. Check the authorization and delivery record before taking further action.",
      };
    }
    if (intent !== "execute" || form.get("confirm") !== "send-once") {
      return { phase: "finished", message: "Explicit confirmation is required. Nothing was sent by this request." };
    }

    const result = await executeAuthorizedTest(actor, authorizationId);
    if (result.duplicate) return { phase: "finished", message: "No new message sent. This authorization or today's test has already been used. Check the delivery record; do not resend." };
    if (result.state === "accepted") return { phase: "finished", message: "Whapi accepted the one-time [TEST] report. The authorization is consumed. Check WhatsApp Business; acceptance is not proof of delivery." };
    if (result.state === "rejected") return { phase: "finished", message: "Whapi rejected the test. The authorization is consumed. No automatic retry will occur; review the delivery record." };
    if (["expired", "revoked", "not_authorized", "unavailable", "disabled", "invalid"].includes(result.state)) return { phase: "finished", message: "The authorization is expired, cancelled or unavailable. No new message was sent by this request." };
    return { phase: "finished", message: "Delivery is uncertain. Do not resend. Check the private delivery record and Whapi before taking further action." };
  } catch {
    console.error("DEKEZ one-time test action failed; inspect the private authorization and delivery state.");
    return { phase: "finished", message: "Unable to confirm the outcome. Do not resend; check the private authorization and delivery record first." };
  }
}

export async function sendTestReport() {
  const actor = await reportAdministrator();
  if (!actor) {
    return "Not authorized to send management reports.";
  }
  try {
    const result = await deliverManagementReport("test", actor);
    if (result.duplicate) return `No new message sent. Today's test report is already ${result.state}.`;
    if (result.state === "accepted") return "Whapi accepted the test report. Please confirm it appeared in WhatsApp; acceptance is not proof of delivery.";
    if (result.state === "disabled") return "Test sending is disabled. Configuration and approval are required first.";
    if (result.state === "rejected") return "Whapi rejected the request. Check configuration before retrying; a five-minute cooldown applies.";
    return "Delivery is uncertain. Do not resend until the provider record has been checked.";
  } catch {
    console.error("DEKEZ management test report failed; private delivery state must be checked.");
    return "Unable to complete the report. Check private delivery state before retrying.";
  }
}

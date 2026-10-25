"use server";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { deliverManagementReport } from "@/lib/management-report/service";

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

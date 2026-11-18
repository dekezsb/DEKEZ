import "server-only";
import { isWhapiRetired } from "@/lib/whapi/retired";
import { APPROVED_REPORT_RECIPIENT } from "./recipient";

export function reportConfig() {
  const companyId = process.env.DEKEZ_REPORT_COMPANY_ID?.trim() ?? "";
  const recipient = process.env.WHAPI_REPORT_TO?.trim() || APPROVED_REPORT_RECIPIENT;
  const token = process.env.WHAPI_TOKEN?.trim() ?? "";
  const scopeReady = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId);
  const configured = scopeReady && recipient === APPROVED_REPORT_RECIPIENT && !!token;
  const retired = isWhapiRetired();
  return {
    companyId, recipient, token, scopeReady, configured, retired,
    sendEnabled: !retired && process.env.DEKEZ_REPORT_SEND_ENABLED === "true",
    testEnabled: !retired && process.env.DEKEZ_REPORT_TEST_ENABLED === "true",
    scheduleEnabled: !retired && process.env.DEKEZ_REPORT_SCHEDULE_ENABLED === "true",
  };
}

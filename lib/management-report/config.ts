import "server-only";

export function reportConfig() {
  const companyId = process.env.DEKEZ_REPORT_COMPANY_ID?.trim() ?? "";
  const recipient = process.env.WHAPI_REPORT_TO?.trim() || "60168173911";
  const token = process.env.WHAPI_TOKEN?.trim() ?? "";
  const scopeReady = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId);
  const configured = scopeReady && /^[1-9][0-9]{8,14}$/.test(recipient) && !!token;
  return {
    companyId, recipient, token, scopeReady, configured,
    sendEnabled: process.env.DEKEZ_REPORT_SEND_ENABLED === "true",
    testEnabled: process.env.DEKEZ_REPORT_TEST_ENABLED === "true",
    scheduleEnabled: process.env.DEKEZ_REPORT_SCHEDULE_ENABLED === "true",
  };
}

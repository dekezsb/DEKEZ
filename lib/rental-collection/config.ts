import "server-only";

export function collectionConfig() {
  const companyId = process.env.DEKEZ_REPORT_COMPANY_ID?.trim() ?? "";
  const token = process.env.WHAPI_TOKEN?.trim() ?? "";
  return {
    companyId, token,
    scopeReady: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId),
    // Independent of the working 8 PM report. No flag or credentials are mutated.
    policyEnabled: process.env.DEKEZ_COLLECTION_POLICY_ENABLED === "true",
    sendEnabled: process.env.DEKEZ_COLLECTION_SEND_ENABLED === "true",
  };
}

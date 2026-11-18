/**
 * Code-level retirement of the Whapi Cloud gateway.
 *
 * Default is retired so the site does not call gate.whapi.cloud after the
 * subscription ends 30 Nov 2026. This is not a Vercel env var we need to set
 * for production. Set WHAPI_RETIRED=false only to exercise the historical
 * sender in tests, or if the service is later restored.
 */
export const WHAPI_RETIRED = true;

export function isWhapiRetired(): boolean {
  return process.env.WHAPI_RETIRED === "false" ? false : WHAPI_RETIRED;
}

import "server-only";
import { timingSafeEqual } from "node:crypto";
import { reportAdministrator } from "@/lib/management-report/authorization";

const HARD_EXPIRY = "2026-10-27T02:00:00.000Z";
const COMPANY = "660cc0c4-daee-445b-9146-ccd112e791d4";
const RECIPIENT = "60198894911";
const CHANNEL = "FALCON-D9NS9";
const CALLBACK = "https://dekez.vercel.app/api/webhooks/whapi-reporting";
const ORIGIN = "https://gate.whapi.cloud";
const MAX_BYTES = 64 * 1024;
const KNOWN_FIELDS = new Set(["url", "mode", "events", "headers", "webhook_max_age_seconds", "send_undecrypted_ad"]);
type Code = "ADMIN_REQUIRED" | "CONFIGURATION_UNAVAILABLE" | "HEALTH_REQUEST_FAILED" | "HEALTH_HTTP_FAILED"
  | "HEALTH_RESPONSE_INVALID" | "CHANNEL_MISMATCH" | "CHANNEL_NOT_AUTHENTICATED"
  | "SETTINGS_REQUEST_FAILED" | "SETTINGS_HTTP_FAILED" | "SETTINGS_RESPONSE_INVALID" | "SETTINGS_INVALID" | "DIAGNOSTIC_UNAVAILABLE";
class DiagnosticFailure extends Error { constructor(readonly code: Code) { super(code); } }
type Config = { token: string; secret: string };
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const has = (value: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export type CallbackDiagnostic = {
  index: number;
  exactUrlMatch: boolean;
  mode: "body" | "path" | "method" | "other" | "missing";
  expectedModeMatch: boolean;
  eventsExactMatch: boolean;
  requiredMessagesPostPresent: boolean;
  eventCount: number | null;
  headerCount: number | null;
  authorizationExactKeyCount: number;
  authorizationCaseInsensitiveKeyCount: number;
  exactBearerSecretMatch: boolean;
  caseInsensitiveAuthorizationValueMatch: boolean;
  maxAge: "missing" | "expected" | "other-number" | "invalid";
  maxAgeExpectedMatch: boolean;
  maxAgeBoundedNumericPresent: boolean;
  sendUndecryptedAd: "missing" | "false" | "true" | "invalid";
  extraFieldCount: number;
  unexpectedFieldCount: number;
  shapeValid: boolean;
  exactExpectedMatch: boolean;
  onlyHeaderDifferences: boolean;
  onlyAuthorizationKeyCaseDifference: boolean;
  onlyKnownSafeDefaultDifferences: boolean;
  onlyHeaderCaseOrKnownSafeDefaultDifferences: boolean;
};
export type TemporaryWhapiDiagnostic = {
  status: "ready" | "blocked";
  code?: Code;
  message: string;
  expiresAt: string;
  report?: {
    readOnly: true;
    channelVerified: true;
    callbackCount: number;
    matchingUrlCount: number;
    exactUrlCount: number;
    malformedCallbackCount: number;
    matchingCallbacks: CallbackDiagnostic[];
  };
};

function configuration(): Config | null {
  const token = process.env.WHAPI_TOKEN?.trim() ?? "";
  const secret = process.env.WHAPI_REPORT_WEBHOOK_SECRET ?? "";
  if (Date.now() >= Date.parse(HARD_EXPIRY) || process.env.VERCEL_ENV !== "production"
    || !/^dpl_[A-Za-z0-9]{8,100}$/.test(process.env.VERCEL_DEPLOYMENT_ID ?? "")
    || ![undefined, "false"].includes(process.env.DEKEZ_REPORT_COMMANDS_ENABLED)
    || process.env.DEKEZ_REPORT_COMPANY_ID?.trim() !== COMPANY || process.env.WHAPI_REPORT_TO?.trim() !== RECIPIENT
    || !token || token.length > 4096 || /[\r\n\0]/.test(token) || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)
    || secret === token || secret === process.env.CRON_SECRET) return null;
  return { token, secret };
}

// Both paths are fixed and GET-only. No callbacks, contacts, messages or channel
// update endpoints can be selected through this temporary diagnostic.
async function readProvider(config: Config, path: "/health?wakeup=false" | "/settings"): Promise<unknown> {
  if (!configuration()) throw new DiagnosticFailure("CONFIGURATION_UNAVAILABLE");
  const health = path === "/health?wakeup=false";
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}${path}`, {
      method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
    });
  } catch { throw new DiagnosticFailure(health ? "HEALTH_REQUEST_FAILED" : "SETTINGS_REQUEST_FAILED"); }
  if (response.status !== 200) throw new DiagnosticFailure(health ? "HEALTH_HTTP_FAILED" : "SETTINGS_HTTP_FAILED");
  try {
    if (!response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
      || Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error(); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { throw new DiagnosticFailure(health ? "HEALTH_RESPONSE_INVALID" : "SETTINGS_RESPONSE_INVALID"); }
}

function secretMatches(value: unknown, secret: string) {
  if (typeof value !== "string") return false;
  const actual = Buffer.from(value), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function describeCallback(value: RecordValue, index: number, secret: string): CallbackDiagnostic {
  const exactUrlMatch = value.url === CALLBACK;
  const mode = value.mode === "body" || value.mode === "path" || value.mode === "method" ? value.mode
    : !has(value, "mode") ? "missing" : "other";
  const events = Array.isArray(value.events) ? value.events : null;
  const eventShape = !!events && events.every(event => object(event) && typeof event.type === "string" && typeof event.method === "string");
  const requiredMessagesPostPresent = !!events?.some(event => object(event) && event.type === "messages" && event.method === "post");
  const eventsExactMatch = !!events && events.length === 1 && object(events[0])
    && events[0].type === "messages" && events[0].method === "post" && Object.keys(events[0]).length === 2;
  const headers = object(value.headers) ? value.headers : null;
  const headerKeys = headers ? Object.keys(headers) : [];
  const authorizationKeys = headerKeys.filter(key => key.toLowerCase() === "authorization");
  const authorizationExactKeyCount = headerKeys.includes("Authorization") ? 1 : 0;
  const exactBearerSecretMatch = !!headers && authorizationExactKeyCount === 1 && secretMatches(headers.Authorization, secret);
  const caseInsensitiveAuthorizationValueMatch = !!headers && authorizationKeys.length === 1 && secretMatches(headers[authorizationKeys[0]], secret);
  const maxAgeBoundedNumericPresent = typeof value.webhook_max_age_seconds === "number"
    && Number.isSafeInteger(value.webhook_max_age_seconds) && value.webhook_max_age_seconds >= 0 && value.webhook_max_age_seconds <= 2_147_483_647;
  const maxAgeExpectedMatch = value.webhook_max_age_seconds === 900;
  const maxAge = !has(value, "webhook_max_age_seconds") ? "missing" : maxAgeExpectedMatch ? "expected"
    : maxAgeBoundedNumericPresent ? "other-number" : "invalid";
  const sendUndecryptedAd = !has(value, "send_undecrypted_ad") ? "missing"
    : value.send_undecrypted_ad === false ? "false" : value.send_undecrypted_ad === true ? "true" : "invalid";
  const unexpectedFieldCount = Object.keys(value).filter(key => !KNOWN_FIELDS.has(key)).length;
  const extraFieldCount = unexpectedFieldCount + (has(value, "send_undecrypted_ad") ? 1 : 0);
  const shapeValid = typeof value.url === "string" && ["body", "path", "method"].includes(mode)
    && eventShape && !!headers && headerKeys.every(key => typeof headers[key] === "string")
    && maxAgeBoundedNumericPresent && sendUndecryptedAd !== "invalid";
  const ordinaryFieldsMatch = exactUrlMatch && mode === "body" && eventsExactMatch && maxAgeExpectedMatch;
  const exactHeadersMatch = headerKeys.length === 1 && exactBearerSecretMatch;
  const caseInsensitiveHeadersMatch = headerKeys.length === 1 && caseInsensitiveAuthorizationValueMatch;
  const exactExpectedMatch = ordinaryFieldsMatch && exactHeadersMatch && extraFieldCount === 0;
  const onlyKnownSafeDefaultDifferences = ordinaryFieldsMatch && exactHeadersMatch && unexpectedFieldCount === 0 && sendUndecryptedAd === "false";
  return {
    index, exactUrlMatch, mode, expectedModeMatch: mode === "body", eventsExactMatch, requiredMessagesPostPresent,
    eventCount: events?.length ?? null, headerCount: headers ? headerKeys.length : null,
    authorizationExactKeyCount, authorizationCaseInsensitiveKeyCount: authorizationKeys.length,
    exactBearerSecretMatch, caseInsensitiveAuthorizationValueMatch, maxAge, maxAgeExpectedMatch, maxAgeBoundedNumericPresent,
    sendUndecryptedAd, extraFieldCount, unexpectedFieldCount, shapeValid, exactExpectedMatch,
    onlyHeaderDifferences: ordinaryFieldsMatch && extraFieldCount === 0 && !exactHeadersMatch,
    onlyAuthorizationKeyCaseDifference: ordinaryFieldsMatch && extraFieldCount === 0 && caseInsensitiveHeadersMatch && authorizationExactKeyCount === 0,
    onlyKnownSafeDefaultDifferences,
    onlyHeaderCaseOrKnownSafeDefaultDifferences: ordinaryFieldsMatch && caseInsensitiveHeadersMatch && unexpectedFieldCount === 0
      && (sendUndecryptedAd === "missing" || sendUndecryptedAd === "false") && !exactExpectedMatch,
  };
}

const blocked = (code: Code): TemporaryWhapiDiagnostic => ({
  status: "blocked", code, expiresAt: HARD_EXPIRY,
  message: "Read-only diagnostic unavailable. No configuration or messages were changed.",
});

export async function readTemporaryWhapiDiagnostic(): Promise<TemporaryWhapiDiagnostic> {
  try { if (!await reportAdministrator()) return blocked("ADMIN_REQUIRED"); }
  catch { return blocked("ADMIN_REQUIRED"); }
  const config = configuration();
  if (!config) return blocked("CONFIGURATION_UNAVAILABLE");
  try {
    const health = await readProvider(config, "/health?wakeup=false");
    if (!object(health)) throw new DiagnosticFailure("HEALTH_RESPONSE_INVALID");
    if (health.channel_id !== CHANNEL) throw new DiagnosticFailure("CHANNEL_MISMATCH");
    if (!object(health.status) || health.status.text !== "AUTH") throw new DiagnosticFailure("CHANNEL_NOT_AUTHENTICATED");
    const settings = await readProvider(config, "/settings");
    if (!object(settings)) throw new DiagnosticFailure("SETTINGS_INVALID");
    const hooks = has(settings, "webhooks") ? settings.webhooks : [];
    if (!Array.isArray(hooks) || hooks.length > 50) throw new DiagnosticFailure("SETTINGS_INVALID");
    const matchingCallbacks: CallbackDiagnostic[] = [];
    let malformedCallbackCount = 0;
    for (let index = 0; index < hooks.length; index++) {
      const hook = hooks[index];
      if (!object(hook) || typeof hook.url !== "string") { malformedCallbackCount++; continue; }
      if (hook.url === "") continue;
      let url: URL;
      try { url = new URL(hook.url); } catch { malformedCallbackCount++; continue; }
      if (url.origin === "https://dekez.vercel.app" && url.pathname.replace(/\/$/, "") === "/api/webhooks/whapi-reporting")
        matchingCallbacks.push(describeCallback(hook, index, config.secret));
    }
    return {
      status: "ready", expiresAt: HARD_EXPIRY,
      message: "Approved authenticated channel verified. Read-only callback comparison only; nothing was changed or sent.",
      report: { readOnly: true, channelVerified: true, callbackCount: hooks.length, matchingUrlCount: matchingCallbacks.length,
        exactUrlCount: matchingCallbacks.filter(item => item.exactUrlMatch).length, malformedCallbackCount, matchingCallbacks },
    };
  } catch (error) { return blocked(error instanceof DiagnosticFailure ? error.code : "DIAGNOSTIC_UNAVAILABLE"); }
}

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { reportAdministrator } from "@/lib/management-report/authorization";

// Temporary, fixed-purpose control. Extending this hard stop requires a reviewed
// code release; a stale deployment cannot remain writable through env changes.
const HARD_EXPIRY = "2026-10-27T01:15:00.000Z";
const COMPANY = "660cc0c4-daee-445b-9146-ccd112e791d4";
const CHANNEL = "FALCON-D9NS9";
const SENDER = "60168173911";
const RECIPIENT = "60198894911";
const ORIGIN = "https://gate.whapi.cloud";
const CALLBACK = "https://dekez.vercel.app/api/webhooks/whapi-reporting";
const MAX_BYTES = 64 * 1024;
const TICKET_MS = 2 * 60 * 1000;
const SETTING_KEYS = new Set([
  "pdo_sync", "callback_backoff_delay_ms", "max_callback_backoff_delay_ms",
  "callback_persist", "media", "webhooks", "proxy", "proxy_trust_filters",
  "mobile_proxy", "offline_mode", "full_history", "auto_read_messages", "locale",
  "mock_pairing_code", "ignored_presences", "data_mode", "outgoing_calls_enabled",
]);
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Settings = { [key: string]: Json; webhooks: Json[] };
type Config = { token: string; secret: string; deployment: string; expiresAt: string };
type Ticket = { v: 1; actor: string; deployment: string; company: string; before: string; after: string; issued: number; expires: number };
// Only these static diagnostics may cross the server boundary. Never include
// provider bodies, setting names/values, credentials or upstream error text.
const FAILURE_MESSAGES = {
  ADMIN_AUTHORIZATION_FAILED: "Administrator authorization could not be verified.",
  CONFIGURATION_UNAVAILABLE: "The approved temporary setup configuration is unavailable or expired.",
  INVALID_REQUEST: "The setup action is not valid.",
  TICKET_INVALID_OR_EXPIRED: "The confirmation is invalid or expired. Review a fresh preview before applying.",
  HEALTH_REQUEST_FAILED: "The read-only channel health request could not complete.",
  HEALTH_HTTP_FAILED: "The channel health endpoint did not return a successful response.",
  HEALTH_RESPONSE_INVALID: "The channel health response could not be safely read.",
  CHANNEL_MISMATCH: "The channel identity does not match the approved channel.",
  HEALTH_NOT_AUTHENTICATED: "The channel does not report the required authenticated status.",
  SENDER_METADATA_INVALID: "The optional sender metadata does not match the supported format.",
  SENDER_PHONE_MISMATCH: "The sender phone does not match the approved sender.",
  SETTINGS_REQUEST_FAILED: "The channel settings request could not complete.",
  SETTINGS_HTTP_FAILED: "The channel settings endpoint did not return a successful response.",
  SETTINGS_RESPONSE_INVALID: "The channel settings response could not be safely read.",
  SETTINGS_INVALID: "The returned settings do not match the supported format.",
  UNKNOWN_SETTINGS_FIELD: "The provider returned an unrecognized setting; review is required before any update.",
  WEBHOOK_MALFORMED: "An existing webhook does not match the supported format.",
  CALLBACK_CONFLICT: "An existing reporting callback conflicts with the approved configuration.",
  SETTINGS_CHANGED: "The settings changed after preview. The previous confirmation cannot be used.",
  CALLBACK_NOT_CONFIGURED: "The approved callback is not configured.",
  SETUP_VERIFICATION_FAILED: "The setup checks could not be completed safely.",
} as const;
type FailureCode = keyof typeof FAILURE_MESSAGES;
class SetupFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}
export type SetupState = {
  phase: "idle" | "preview" | "verified" | "blocked" | "uncertain";
  message: string;
  code?: FailureCode;
  ticket?: string;
  existingWebhooks?: number;
  expiresAt?: string;
};

function configuration(): Config | null {
  const expiry = process.env.DEKEZ_WHAPI_SETUP_EXPIRES_AT ?? "";
  const expires = Date.parse(expiry);
  const token = process.env.WHAPI_TOKEN?.trim() ?? "";
  const secret = process.env.WHAPI_REPORT_WEBHOOK_SECRET ?? "";
  const deployment = process.env.VERCEL_DEPLOYMENT_ID ?? "";
  if (process.env.DEKEZ_WHAPI_SETUP_ENABLED !== "true"
    || process.env.VERCEL_ENV !== "production"
    || ![undefined, "false"].includes(process.env.DEKEZ_REPORT_COMMANDS_ENABLED)
    || process.env.DEKEZ_REPORT_COMPANY_ID?.trim() !== COMPANY
    || process.env.WHAPI_REPORT_TO?.trim() !== RECIPIENT
    || !/^dpl_[A-Za-z0-9]{8,100}$/.test(deployment)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry)
    || !Number.isFinite(expires) || expires > Date.parse(HARD_EXPIRY) || Date.now() >= expires
    || !token || token.length > 4096 || /[\r\n\0]/.test(token)
    || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)
    || secret === token || secret === process.env.CRON_SECRET) return null;
  return { token, secret, deployment, expiresAt: new Date(expires).toISOString() };
}

export function getSetupAvailability(): { available: boolean; expiresAt: string } {
  const config = configuration();
  return { available: !!config, expiresAt: config?.expiresAt ?? HARD_EXPIRY };
}

function object(value: unknown): value is Record<string, Json> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  // JSON.parse can accept an overflowing numeric literal as Infinity. Never
  // silently turn such a provider setting into null during the PATCH round-trip.
  if (typeof value === "number" && !Number.isFinite(value)) throw new SetupFailure("SETTINGS_INVALID");
  return JSON.stringify(value);
}
const digest = (value: Json) => createHash("sha256").update(canonical(value)).digest("hex");

function settings(value: unknown): Settings {
  if (!object(value)) throw new SetupFailure("SETTINGS_INVALID");
  if (Object.keys(value).some(key => !SETTING_KEYS.has(key))) throw new SetupFailure("UNKNOWN_SETTINGS_FIELD");
  for (const key of ["pdo_sync", "callback_persist", "proxy_trust_filters", "offline_mode", "full_history", "auto_read_messages", "outgoing_calls_enabled"])
    if (key in value && typeof value[key] !== "boolean") throw new SetupFailure("SETTINGS_INVALID");
  for (const key of ["proxy", "mobile_proxy", "locale", "mock_pairing_code", "data_mode"])
    if (key in value && typeof value[key] !== "string") throw new SetupFailure("SETTINGS_INVALID");
  for (const key of ["callback_backoff_delay_ms", "max_callback_backoff_delay_ms"])
    if (key in value && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) throw new SetupFailure("SETTINGS_INVALID");
  if ("media" in value && !object(value.media)) throw new SetupFailure("SETTINGS_INVALID");
  if ("ignored_presences" in value && !Array.isArray(value.ignored_presences)) throw new SetupFailure("SETTINGS_INVALID");
  // The provider may omit its optional webhooks property when no rows exist.
  // An explicit null or malformed value is not equivalent to that absence.
  const webhooks = Object.prototype.hasOwnProperty.call(value, "webhooks") ? value.webhooks : [];
  if (!Array.isArray(webhooks) || webhooks.length > 50
    || webhooks.some(hook => !object(hook) || typeof hook.url !== "string")) throw new SetupFailure("WEBHOOK_MALFORMED");
  // PATCH resets omitted defaulted fields. GET may omit these documented
  // defaults; make them explicit while preserving every returned field/value.
  return {
    pdo_sync: true, offline_mode: false, full_history: false,
    auto_read_messages: false, locale: "", ...value, webhooks,
  };
}

function desiredSettings(current: Settings, config: Config): { next: Settings; exists: boolean } {
  const approved = {
    url: CALLBACK, mode: "body", events: [{ type: "messages", method: "post" }],
    headers: { Authorization: `Bearer ${config.secret}` }, webhook_max_age_seconds: 900,
  };
  const matches = current.webhooks.filter(hook => {
    if (!object(hook) || typeof hook.url !== "string") throw new SetupFailure("WEBHOOK_MALFORMED");
    // The documented provider schema permits a blank URL row. Preserve that
    // exact row; it is not our target and does not authorize any callback.
    if (hook.url === "") return false;
    try {
      const url = new URL(hook.url);
      return url.origin === "https://dekez.vercel.app" && url.pathname.replace(/\/$/, "") === "/api/webhooks/whapi-reporting";
    } catch { throw new SetupFailure("WEBHOOK_MALFORMED"); }
  });
  if (matches.length > 1 || (matches.length === 1 && canonical(matches[0]) !== canonical(approved)))
    throw new SetupFailure("CALLBACK_CONFLICT");
  return { exists: matches.length === 1, next: matches.length ? current : { ...current, webhooks: [...current.webhooks, approved] } };
}

async function provider(config: Config, path: "/settings" | "/health?wakeup=false", body?: Settings): Promise<unknown> {
  if (body && path !== "/settings") throw new SetupFailure("INVALID_REQUEST");
  const isHealth = path === "/health?wakeup=false";
  let result: Response;
  try {
    result = await fetch(`${ORIGIN}${path}`, {
      method: body ? "PATCH" : "GET", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new SetupFailure(isHealth ? "HEALTH_REQUEST_FAILED" : "SETTINGS_REQUEST_FAILED"); }
  if (result.status !== 200) throw new SetupFailure(isHealth ? "HEALTH_HTTP_FAILED" : "SETTINGS_HTTP_FAILED");
  try {
    if (!result.headers.get("content-type")?.toLowerCase().startsWith("application/json")
      || Number(result.headers.get("content-length")) > MAX_BYTES || !result.body) throw new Error();
    const reader = result.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error(); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { throw new SetupFailure(isHealth ? "HEALTH_RESPONSE_INVALID" : "SETTINGS_RESPONSE_INVALID"); }
}

type SenderMetadata = "phone" | "full-jid" | "unavailable";
async function health(config: Config): Promise<SenderMetadata> {
  const result = await provider(config, "/health?wakeup=false");
  if (!object(result)) throw new SetupFailure("HEALTH_RESPONSE_INVALID");
  if (result.channel_id !== CHANNEL) throw new SetupFailure("CHANNEL_MISMATCH");
  if (!object(result.status) || result.status.text !== "AUTH") throw new SetupFailure("HEALTH_NOT_AUTHENTICATED");
  // The exact authenticated channel is the authorization boundary for this
  // fixed webhook-only operation. Optional phone data is corroboration, not a
  // reason to query contacts or alter the existing channel connection.
  if (result.user === undefined || result.user === null) return "unavailable";
  if (!object(result.user)) throw new SetupFailure("SENDER_METADATA_INVALID");
  const { phone, id } = result.user;
  if ((phone !== undefined && phone !== null && typeof phone !== "string")
    || (id !== undefined && id !== null && typeof id !== "string")) throw new SetupFailure("SENDER_METADATA_INVALID");
  if (typeof phone === "string" && phone !== "" && phone.replace(/^\+/, "") !== SENDER)
    throw new SetupFailure("SENDER_PHONE_MISMATCH");
  const fullJid = typeof id === "string" && id.endsWith("@s.whatsapp.net");
  if (fullJid && id !== `${SENDER}@s.whatsapp.net`) throw new SetupFailure("SENDER_PHONE_MISMATCH");
  if (phone) return "phone";
  if (fullJid) return "full-jid";
  // Bare IDs, LIDs and other opaque string IDs are never called phone proof.
  return "unavailable";
}

const channelNotice = (metadata: SenderMetadata) => "Approved authenticated channel verified; the existing connection is unchanged. "
  + (metadata === "phone" ? "Returned phone metadata matches the approved sender."
    : metadata === "full-jid" ? "Phone metadata is unavailable; the returned full account ID matches the approved sender."
      : "Phone metadata is unavailable and has not been independently verified.");

function signature(payload: string, config: Config) {
  return createHmac("sha256", config.secret).update(`dekez-temporary-whapi-setup-v1\n${payload}`).digest("base64url");
}
function makeTicket(actor: string, config: Config, before: Settings, after: Settings): string {
  const issued = Date.now();
  const value: Ticket = { v: 1, actor, deployment: config.deployment, company: COMPANY, before: digest(before), after: digest(after), issued,
    expires: Math.min(issued + TICKET_MS, Date.parse(config.expiresAt)) };
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload, config)}`;
}
function readTicket(raw: string | undefined, actor: string, config: Config): Ticket | null {
  if (!raw || raw.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const [payload, supplied] = raw.split(".");
  const expected = signature(payload, config);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!object(value) || value.v !== 1 || value.actor !== actor || value.company !== COMPANY || value.deployment !== config.deployment
      || typeof value.before !== "string" || !/^[a-f0-9]{64}$/.test(value.before)
      || typeof value.after !== "string" || !/^[a-f0-9]{64}$/.test(value.after)
      || typeof value.issued !== "number" || typeof value.expires !== "number"
      || !Number.isFinite(value.issued) || !Number.isFinite(value.expires)
      || value.issued > Date.now() || value.expires <= Date.now() || value.expires - value.issued > TICKET_MS
      || value.expires <= value.issued || value.expires > Date.parse(config.expiresAt)) return null;
    return value as Ticket;
  } catch { return null; }
}

function patchResponseMatches(value: unknown, before: Settings, after: Settings): boolean {
  if (!object(value) || !Array.isArray(value.changes) || !value.changes.length
    || value.changes.some(change => change !== "webhooks")) return false;
  try { return digest(settings(value.before_update)) === digest(before) && digest(settings(value.after_update)) === digest(after); }
  catch { return false; }
}

const blocked = (code: FailureCode = "SETUP_VERIFICATION_FAILED"): SetupState => ({
  phase: "blocked", code, message: `${FAILURE_MESSAGES[code]} No update was made. Check code: ${code}.`,
});
const verified = (count: number, metadata: SenderMetadata): SetupState => ({ phase: "verified", message: `${channelNotice(metadata)} The approved callback is independently verified. Incoming reporting commands remain disabled. No message was sent.`, existingWebhooks: count });

export async function runSetup(intent: "preview" | "apply" | "verify", ticket?: string): Promise<SetupState> {
  // Fresh real identity/profile authorization occurs on every action, never from
  // client role metadata. This helper cannot modify accounts or reporting data.
  let actor: string | null;
  try { actor = await reportAdministrator(); } catch { return blocked("ADMIN_AUTHORIZATION_FAILED"); }
  if (!actor) return blocked("ADMIN_AUTHORIZATION_FAILED");
  const config = configuration();
  if (!config) return blocked("CONFIGURATION_UNAVAILABLE");
  if (!["preview", "apply", "verify"].includes(intent)) return blocked("INVALID_REQUEST");
  const approval = intent === "apply" || ticket ? readTicket(ticket, actor, config) : null;
  if ((intent === "apply" || ticket) && !approval) return blocked("TICKET_INVALID_OR_EXPIRED");
  try {
    const metadata = await health(config);
    const current = settings(await provider(config, "/settings"));
    const { next, exists } = desiredSettings(current, config);
    if (approval && digest(current) !== approval.before && digest(current) !== approval.after) return blocked("SETTINGS_CHANGED");
    if (exists) {
      if (approval && digest(current) !== approval.after) return blocked("SETTINGS_CHANGED");
      return verified(current.webhooks.length, metadata);
    }
    if (intent === "verify") return blocked("CALLBACK_NOT_CONFIGURED");
    if (intent === "preview") return {
      phase: "preview", message: `${channelNotice(metadata)} Add one approved reporting callback and preserve all existing channel settings. Confirm within two minutes. No message will be sent.`,
      ticket: makeTicket(actor, config, current, next), existingWebhooks: current.webhooks.length, expiresAt: config.expiresAt,
    };
    if (!approval || digest(current) !== approval.before || digest(next) !== approval.after) return blocked("SETTINGS_CHANGED");
    // Recheck time, config and Admin immediately before the sole write. Tickets
    // bind a snapshot, not a durable one-use claim. Repeated execution becomes a
    // fixed-config no-op; no claim of cross-worker atomic single-use is made.
    const fresh = configuration();
    if (!fresh || canonical(fresh) !== canonical(config)) return blocked("CONFIGURATION_UNAVAILABLE");
    if (await reportAdministrator() !== actor) return blocked("ADMIN_AUTHORIZATION_FAILED");
    if (!readTicket(ticket, actor, fresh)) return blocked("TICKET_INVALID_OR_EXPIRED");
    let responseKnown = false;
    let responseSafe = false;
    try {
      const result = await provider(config, "/settings", next);
      responseKnown = true;
      responseSafe = patchResponseMatches(result, current, next);
    } catch { /* A possibly accepted write is never retried. */ }
    try {
      const actual = settings(await provider(config, "/settings"));
      if (digest(actual) === digest(next) && (!responseKnown || responseSafe)) return verified(actual.webhooks.length, metadata);
    } catch { /* Only the independent GET is allowed after an uncertain PATCH. */ }
    return {
      phase: "uncertain", message: "The update could not be fully verified. Do not repeat Apply. Use read-only Verify and review the provider settings before any further change.", ticket,
    };
  } catch (error) { return blocked(error instanceof SetupFailure ? error.code : "SETUP_VERIFICATION_FAILED"); }
}

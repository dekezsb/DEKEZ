import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { reportAdministrator } from "@/lib/management-report/authorization";

// Temporary, fixed-purpose control. Extending this hard stop requires a reviewed
// code release; a stale deployment cannot remain writable through env changes.
const HARD_EXPIRY = "2026-10-26T16:30:00.000Z";
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
  "mock_pairing_code", "ignored_presences", "data_mode",
]);
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Settings = { [key: string]: Json; webhooks: Json[] };
type Config = { token: string; secret: string; deployment: string; expiresAt: string };
type Ticket = { v: 1; actor: string; deployment: string; company: string; before: string; after: string; issued: number; expires: number };
export type SetupState = {
  phase: "idle" | "preview" | "verified" | "blocked" | "uncertain";
  message: string;
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
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid numeric setting");
  return JSON.stringify(value);
}
const digest = (value: Json) => createHash("sha256").update(canonical(value)).digest("hex");

function settings(value: unknown): Settings {
  if (!object(value) || Object.keys(value).some(key => !SETTING_KEYS.has(key))) throw new Error("Unrecognized settings");
  for (const key of ["pdo_sync", "callback_persist", "proxy_trust_filters", "offline_mode", "full_history", "auto_read_messages"])
    if (key in value && typeof value[key] !== "boolean") throw new Error("Invalid settings");
  for (const key of ["proxy", "mobile_proxy", "locale", "mock_pairing_code", "data_mode"])
    if (key in value && typeof value[key] !== "string") throw new Error("Invalid settings");
  for (const key of ["callback_backoff_delay_ms", "max_callback_backoff_delay_ms"])
    if (key in value && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) throw new Error("Invalid settings");
  if ("media" in value && !object(value.media)) throw new Error("Invalid settings");
  if ("ignored_presences" in value && !Array.isArray(value.ignored_presences)) throw new Error("Invalid settings");
  if (!Array.isArray(value.webhooks) || value.webhooks.length > 50
    || value.webhooks.some(hook => !object(hook) || typeof hook.url !== "string")) throw new Error("Invalid webhooks");
  // PATCH resets omitted defaulted fields. GET may omit these documented
  // defaults; make them explicit while preserving every returned field/value.
  return {
    pdo_sync: true, offline_mode: false, full_history: false,
    auto_read_messages: false, locale: "", ...value, webhooks: value.webhooks,
  };
}

function desiredSettings(current: Settings, config: Config): { next: Settings; exists: boolean } {
  const approved = {
    url: CALLBACK, mode: "body", events: [{ type: "messages", method: "post" }],
    headers: { Authorization: `Bearer ${config.secret}` }, webhook_max_age_seconds: 900,
  };
  const matches = current.webhooks.filter(hook => {
    if (!object(hook) || typeof hook.url !== "string") throw new Error("Invalid webhook");
    try {
      const url = new URL(hook.url);
      return url.origin === "https://dekez.vercel.app" && url.pathname.replace(/\/$/, "") === "/api/webhooks/whapi-reporting";
    } catch { throw new Error("Invalid webhook URL"); }
  });
  if (matches.length > 1 || (matches.length === 1 && canonical(matches[0]) !== canonical(approved)))
    throw new Error("Existing callback conflicts with approved configuration");
  return { exists: matches.length === 1, next: matches.length ? current : { ...current, webhooks: [...current.webhooks, approved] } };
}

async function provider(config: Config, path: "/settings" | "/health?wakeup=false", body?: Settings): Promise<unknown> {
  const result = await fetch(`${ORIGIN}${path}`, {
    method: body ? "PATCH" : "GET", cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
  });
  if (result.status !== 200 || !result.headers.get("content-type")?.toLowerCase().startsWith("application/json")
    || Number(result.headers.get("content-length")) > MAX_BYTES || !result.body) throw new Error("Provider unavailable");
  const reader = result.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Provider response too large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function health(config: Config) {
  const result = await provider(config, "/health?wakeup=false");
  if (!object(result) || result.channel_id !== CHANNEL || !object(result.status) || result.status.text !== "AUTH"
    || !object(result.user) || typeof result.user.phone !== "string"
    || result.user.phone.replace(/^\+/, "") !== SENDER) throw new Error("Channel identity could not be verified");
}

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

const blocked = (): SetupState => ({ phase: "blocked", message: "Setup is unavailable or the approved channel/settings could not be verified. No update was made." });
const verified = (count: number): SetupState => ({ phase: "verified", message: "The approved callback is independently verified. Incoming reporting commands remain disabled. No message was sent.", existingWebhooks: count });

export async function runSetup(intent: "preview" | "apply" | "verify", ticket?: string): Promise<SetupState> {
  // Fresh real identity/profile authorization occurs on every action, never from
  // client role metadata. This helper cannot modify accounts or reporting data.
  let actor: string | null;
  try { actor = await reportAdministrator(); } catch { return blocked(); }
  const config = configuration();
  if (!actor || !config || !["preview", "apply", "verify"].includes(intent)) return blocked();
  const approval = intent === "apply" || ticket ? readTicket(ticket, actor, config) : null;
  if ((intent === "apply" || ticket) && !approval) return blocked();
  try {
    await health(config);
    const current = settings(await provider(config, "/settings"));
    const { next, exists } = desiredSettings(current, config);
    if (approval && digest(current) !== approval.before && digest(current) !== approval.after) return blocked();
    if (exists) {
      if (approval && digest(current) !== approval.after) return blocked();
      return verified(current.webhooks.length);
    }
    if (intent === "verify") return { phase: "blocked", message: "The approved callback is not configured. This read-only verification made no changes." };
    if (intent === "preview") return {
      phase: "preview", message: "Preview verified: add one approved reporting callback and preserve all existing channel settings. Confirm within two minutes. No message will be sent.",
      ticket: makeTicket(actor, config, current, next), existingWebhooks: current.webhooks.length, expiresAt: config.expiresAt,
    };
    if (!approval || digest(current) !== approval.before || digest(next) !== approval.after) return blocked();
    // Recheck time, config and Admin immediately before the sole write. Tickets
    // bind a snapshot, not a durable one-use claim. Repeated execution becomes a
    // fixed-config no-op; no claim of cross-worker atomic single-use is made.
    const fresh = configuration();
    if (!fresh || canonical(fresh) !== canonical(config) || await reportAdministrator() !== actor || !readTicket(ticket, actor, fresh)) return blocked();
    let responseKnown = false;
    let responseSafe = false;
    try {
      const result = await provider(config, "/settings", next);
      responseKnown = true;
      responseSafe = patchResponseMatches(result, current, next);
    } catch { /* A possibly accepted write is never retried. */ }
    try {
      const actual = settings(await provider(config, "/settings"));
      if (digest(actual) === digest(next) && (!responseKnown || responseSafe)) return verified(actual.webhooks.length);
    } catch { /* Only the independent GET is allowed after an uncertain PATCH. */ }
    return {
      phase: "uncertain", message: "The update could not be fully verified. Do not repeat Apply. Use read-only Verify and review the provider settings before any further change.", ticket,
    };
  } catch { return blocked(); }
}

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

// TEMPORARY, REVIEW-ONLY INSTALLER. Remove after separately approved execution.
// No messaging, consent, collection policy, environment or scheduler mutations.
const COMPANY = "660cc0c4-daee-445b-9146-ccd112e791d4";
const PROJECT = "prj_YkRkOBkodAdGUErZMYsoIwjqaFiQ";
const CHANNEL = "FALCON-D9NS9";
const SENDER = "60168173911";
export const COLLECTION_CALLBACK = "https://dekez.vercel.app/api/webhooks/whapi-rental-reminders";
const REPORT_CALLBACK = "https://dekez.vercel.app/api/webhooks/whapi-reporting";
const GATEWAY = "https://gate.whapi.cloud";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASKED = /\*{3,}|•|redacted|masked|<[^>]+>/i;
type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
type ObjectValue = {[key: string]: Json};
type SetupConfig = {companyId: string; operationId: string; token: string; secret: string; reportSecret: string; deployment: string};
export type SetupResult = {state: string; message: string; ticket?: string; existingWebhookCount?: number};
export type SetupDiagnostic = {state: "blocked" | "compatible"; stage: string; code: string; field?: string; httpStatus?: number; callbackPresent?: boolean};
// Only fixed codes and explicitly allowlisted field names are exposed. Never
// attach provider payloads, unknown keys, URLs, headers or thrown error messages.
class SetupValidationError extends Error {
  constructor(readonly code: string, readonly field?: string, readonly httpStatus?: number) {super("Setup validation failed.");}
}
const fail = (code = "validation_failed", field?: string, httpStatus?: number): never => {throw new SetupValidationError(code, field, httpStatus);};
const object = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const canonical = (value: Json): string => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fingerprint = (value: Json) => createHash("sha256").update(canonical(value)).digest("hex");

export function setupConfig(env: NodeJS.ProcessEnv = process.env): SetupConfig | null {
  const token = env.WHAPI_TOKEN?.trim() ?? "", secret = env.WHAPI_COLLECTION_WEBHOOK_SECRET ?? "";
  const reportSecret = env.WHAPI_REPORT_WEBHOOK_SECRET ?? "", cron = env.CRON_SECRET ?? "";
  const operationId = env.DEKEZ_COLLECTION_SETUP_OPERATION ?? "", deployment = env.VERCEL_DEPLOYMENT_ID ?? "";
  if (env.DEKEZ_COLLECTION_SETUP_ENABLED !== "true" || env.VERCEL_ENV !== "production"
    || env.VERCEL_PROJECT_ID !== PROJECT || env.DEKEZ_REPORT_COMPANY_ID !== COMPANY
    || env.DEKEZ_COLLECTION_SEND_ENABLED !== "false" || env.DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED !== "false"
    || !UUID.test(operationId) || !/^dpl_[A-Za-z0-9]{8,100}$/.test(deployment)
    || !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? "")
    || !token || !reportSecret || !cron || /[\r\n]/.test(token + reportSecret + cron) || !/^[A-Za-z0-9_-]{43,256}$/.test(secret)
    || [token, reportSecret, cron].includes(secret) || MASKED.test(token) || MASKED.test(reportSecret)) return null;
  return {companyId: COMPANY, operationId, token, secret, reportSecret, deployment};
}

function exactKeys(value: ObjectValue, allowed: readonly string[], code = "unknown_webhook_field") {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(code);
}
function webhook(value: unknown): asserts value is ObjectValue {
  if (!object(value)) return fail("webhook_shape");
  exactKeys(value, ["url", "mode", "headers", "events", "webhook_max_age_seconds", "send_undecrypted_ad"]);
  if (typeof value.url !== "string") return fail("webhook_url");
  let url: URL;
  try {url = new URL(value.url);} catch {return fail("webhook_url");}
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) fail("webhook_url");
  if (url.origin === "https://dekez.vercel.app") {
    // The platform may canonicalize slashes, percent escapes and dot segments.
    // Never append another callback when an existing URL is an equivalent alias.
    let path = url.pathname;
    for (let depth = 0; depth < 8; depth++) {
      let decoded: string;
      try {decoded = decodeURIComponent(path);} catch {return fail("webhook_url_encoding");}
      if (decoded === path) break;
      path = decoded;
      if (depth === 7) return fail("webhook_url_encoding");
    }
    const normalized = new URL(`https://dekez.vercel.app${path.replace(/\\/g, "/").replace(/\/+/g, "/")}`).pathname.replace(/\/+$/, "");
    for (const fixed of [COLLECTION_CALLBACK, REPORT_CALLBACK]) {
      if (normalized.toLowerCase() === new URL(fixed).pathname && value.url !== fixed) fail("callback_url_alias");
    }
  }
  if (value.mode !== undefined && !["body", "path", "method"].includes(String(value.mode))) fail("webhook_mode");
  if (value.headers !== undefined) {
    if (!object(value.headers) || Object.keys(value.headers).length > 5) return fail("webhook_headers");
    const names = Object.keys(value.headers).map(key => key.toLowerCase());
    if (new Set(names).size !== names.length || Object.entries(value.headers).some(([key, val]) =>
      !/^[A-Za-z0-9-]+$/.test(key) || typeof val !== "string" || /[\r\n]/.test(val) || MASKED.test(val))) fail("webhook_headers");
  }
  if (!Array.isArray(value.events) || value.events.length > 100) return fail("webhook_events");
  for (const event of value.events) {
    if (!object(event)) return fail("webhook_events");
    exactKeys(event, ["type", "method"], "unknown_event_field");
    if (!["messages", "statuses", "chats", "contacts", "groups", "presences", "calls", "channel", "users", "labels", "service"].includes(String(event.type))
      || !["post", "put", "delete", "patch"].includes(String(event.method))) fail("webhook_events");
  }
  if (value.webhook_max_age_seconds !== undefined && value.webhook_max_age_seconds !== null
    && (typeof value.webhook_max_age_seconds !== "number" || value.webhook_max_age_seconds < 15 || value.webhook_max_age_seconds > 172800)) fail("webhook_max_age");
  if (value.send_undecrypted_ad !== undefined && typeof value.send_undecrypted_ad !== "boolean") fail("webhook_undecrypted_setting");
}

function validateSettings(value: unknown): asserts value is ObjectValue & {webhooks: ObjectValue[]} {
  if (!object(value)) return fail("settings_shape");
  const booleans = ["pdo_sync", "callback_persist", "offline_mode", "full_history", "auto_read_messages", "outgoing_calls_enabled"];
  exactKeys(value, [...booleans, "callback_backoff_delay_ms", "max_callback_backoff_delay_ms", "media", "webhooks",
    "proxy", "proxy_trust_filters", "mobile_proxy", "locale", "mock_pairing_code", "ignored_presences", "data_mode"], "unknown_setting");
  // Official provider references disagree about whether omitted settings reset.
  // Never PATCH from a sparse snapshot that cannot preserve known default-bearing
  // channel settings. Older API shapes need operator review, not guessed defaults.
  for (const key of booleans) if (typeof value[key] !== "boolean") fail("required_boolean", key);
  // The provider's current settings reference documents this optional boolean
  // even though its public YAML omits it. Preserve the exact returned value;
  // never enable proxy certificate trust or invent a default during setup.
  if (value.proxy_trust_filters !== undefined && typeof value.proxy_trust_filters !== "boolean") fail("optional_boolean", "proxy_trust_filters");
  for (const [key, min, max] of [["callback_backoff_delay_ms", 3000, 15000], ["max_callback_backoff_delay_ms", 600000, 3600000]] as const) {
    const n = value[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) fail("required_bounded_number", key);
  }
  for (const key of ["proxy", "mobile_proxy", "locale", "mock_pairing_code"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || MASKED.test(value[key] as string))) fail("optional_string_unavailable", key);
  }
  if (!["original", "replace", "extend"].includes(String(value.data_mode))) fail("required_enum", "data_mode");
  if (!Array.isArray(value.ignored_presences) || value.ignored_presences.some(v => typeof v !== "string")) fail("required_string_array", "ignored_presences");
  if (!object(value.media)) return fail("required_object", "media");
  exactKeys(value.media, ["auto_download", "init_avatars"], "unknown_media_field");
  if (typeof value.media.init_avatars !== "boolean") fail("required_boolean", "media.init_avatars");
  if (!Array.isArray(value.media.auto_download)
    || value.media.auto_download.some(v => !["image", "audio", "voice", "video", "document", "sticker"].includes(String(v)))) fail("required_enum_array", "media.auto_download");
  if (!Array.isArray(value.webhooks) || value.webhooks.length > 20) return fail("required_bounded_array", "webhooks");
  value.webhooks.forEach(webhook);
}

export function verifyChannel(health: unknown) {
  if (!object(health)) return fail("health_shape");
  if (health.channel_id !== CHANNEL) return fail("channel_identity");
  if (!object(health.status) || health.status.text !== "AUTH") return fail("channel_not_authenticated");
  if (!object(health.user)) return fail("sender_identity");
  const number = (value: Json | undefined) => typeof value === "string" ? value.replace(/^\+/, "").replace(/@(?:s\.whatsapp\.net|c\.us)$/, "") : "";
  if (number(health.user.id) !== SENDER || (health.user.phone !== undefined && number(health.user.phone) !== SENDER)) fail("sender_identity");
}

export function planCallbackSetup(settings: unknown, config: Pick<SetupConfig, "secret" | "reportSecret">) {
  validateSettings(settings);
  const before = JSON.parse(JSON.stringify(settings)) as typeof settings;
  const reports = before.webhooks.filter(hook => hook.url === REPORT_CALLBACK);
  if (reports.length !== 1) return fail("report_callback_count");
  if ((reports[0].mode ?? "body") !== "body") return fail("report_callback_mode");
  if (!object(reports[0].headers)
    || Object.entries(reports[0].headers).find(([key]) => key.toLowerCase() === "authorization")?.[1] !== `Bearer ${config.reportSecret}`) return fail("report_callback_authentication");
  if (!(reports[0].events as ObjectValue[]).some(event => event.type === "messages" && event.method === "post")) return fail("report_callback_events");
  const target = {url: COLLECTION_CALLBACK, mode: "body", headers: {Authorization: `Bearer ${config.secret}`},
    events: [{type: "messages", method: "post"}, {type: "statuses", method: "post"}],
    webhook_max_age_seconds: null, send_undecrypted_ad: false};
  const matches = before.webhooks.filter(hook => hook.url === COLLECTION_CALLBACK);
  if (matches.length > 1) return fail("rental_callback_duplicate");
  if (matches.length === 1 && canonical(matches[0]) !== canonical(target)) return fail("rental_callback_conflict");
  const alreadyConfigured = matches.length === 1;
  const after = {...before, webhooks: alreadyConfigured ? before.webhooks : [...before.webhooks, target]};
  return {before, after, alreadyConfigured, existingWebhookCount: before.webhooks.length};
}

async function provider(config: {token: string}, path: "/health?wakeup=false" | "/settings", body?: Json) {
  // Only these three provider operations exist. Never follow redirects or print bodies.
  if (body !== undefined && path !== "/settings") return fail();
  const response = await fetch(`${GATEWAY}${path}`, {method: body === undefined ? "GET" : "PATCH", cache: "no-store", redirect: "error",
    headers: {Authorization: `Bearer ${config.token}`, Accept: "application/json", ...(body === undefined ? {} : {"Content-Type": "application/json"})},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)});
  if (!response.ok) {void response.body?.cancel().catch(() => {}); return fail("provider_http", undefined, response.status);}
  if (!response.body) return fail("provider_empty_body");
  if (Number(response.headers.get("content-length")) > 131072) {void response.body.cancel().catch(() => {}); return fail("provider_body_limit");}
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength; if (length > 131072) {void reader.cancel().catch(() => {}); return fail("provider_body_limit");} chunks.push(next.value); }
    try {return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;} catch {return fail("provider_json");}
  } finally {reader.releaseLock();}
}

async function ledger(config: SetupConfig, actor: string, action: "check" | "claim" | "finish", extra: Record<string, string> = {}) {
  const {data, error} = await createAdminClient().rpc(`dekez_collection_setup_${action}`, {
    p_company: config.companyId, p_actor: actor, p_operation: config.operationId, ...extra,
  }).abortSignal(AbortSignal.timeout(5000));
  if (error || !data || typeof data !== "object" || typeof data.state !== "string") return fail();
  return data as {state: string; expires_at?: string; outcome?: string; consumed?: boolean; before_hash?: string; after_hash?: string; deployment?: string};
}
type Ticket = {actor: string; operation: string; deployment: string; before: string; after: string; expires: number};
function sign(payload: string, config: SetupConfig) {return createHmac("sha256", config.secret).update(`rental-callback-setup-v1:${payload}`).digest("base64url");}
function ticketValue(ticket: string, config: SetupConfig, actor: string): Ticket {
  if (ticket.length > 2048) return fail();
  const pieces = ticket.split("."); if (pieces.length !== 2) return fail();
  const signature = Buffer.from(sign(pieces[0], config)); const received = Buffer.from(pieces[1]);
  if (signature.length !== received.length || !timingSafeEqual(signature, received)) return fail();
  const data = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8")) as Ticket;
  if (data.actor !== actor || data.operation !== config.operationId || data.deployment !== config.deployment
    || !/^[a-f0-9]{64}$/.test(data.before) || !/^[a-f0-9]{64}$/.test(data.after)
    || !Number.isFinite(data.expires) || data.expires <= Date.now() || data.expires > Date.now() + 120000) return fail();
  return data;
}
const unavailable = (): SetupResult => ({state: "unavailable", message: "Setup is unavailable, expired or not authorized. No settings were changed."});

export async function previewCallbackSetup(): Promise<SetupResult> {
  try {
    const config = setupConfig(), actor = await reportAdministrator(); if (!config || !actor) return unavailable();
    const permit = await ledger(config, actor, "check");
    if (permit.state !== "ready" || !permit.expires_at) return unavailable();
    verifyChannel(await provider(config, "/health?wakeup=false"));
    const plan = planCallbackSetup(await provider(config, "/settings"), config);
    const expires = Math.min(Date.now() + 120000, Date.parse(permit.expires_at));
    if (!Number.isFinite(expires) || expires <= Date.now() + 10000) return unavailable();
    const payload = Buffer.from(JSON.stringify({actor, operation: config.operationId, deployment: config.deployment,
      before: fingerprint(plan.before), after: fingerprint(plan.after), expires} satisfies Ticket)).toString("base64url");
    return {state: "preview", message: plan.alreadyConfigured ? "The exact authenticated callback is already present. Confirmation will record verification without changing provider settings."
      : "Ready to add only the authenticated rental callback. All existing settings and callbacks must remain unchanged. Tenant and Rosley sending remain off.",
    existingWebhookCount: plan.existingWebhookCount, ticket: `${payload}.${sign(payload, config)}`};
  } catch {return {state: "review_required", message: "Preflight could not be verified. No settings were changed. Review the channel, permit and supported settings privately."};}
}

export async function executeCallbackSetup(ticket: string, confirmed: boolean): Promise<SetupResult> {
  let claimed = false, attempted = false, config: SetupConfig | null = null, actor: string | null = null;
  try {
    config = setupConfig(); actor = await reportAdministrator(); if (!confirmed || !config || !actor) return unavailable();
    const signed = ticketValue(ticket, config, actor);
    const permit = await ledger(config, actor, "check"); if (permit.state !== "ready") return unavailable();
    verifyChannel(await provider(config, "/health?wakeup=false"));
    const plan = planCallbackSetup(await provider(config, "/settings"), config);
    if (fingerprint(plan.before) !== signed.before || fingerprint(plan.after) !== signed.after) return fail();
    const reservation = await ledger(config, actor, "claim", {p_before_hash: signed.before, p_after_hash: signed.after, p_deployment: config.deployment});
    if (reservation.state !== "claimed") return unavailable();
    claimed = true;
    const permitExpires = Date.parse(reservation.expires_at ?? "");
    // Revocation/expiry after preflight or a lock wait must prevent the PATCH.
    if (await reportAdministrator() !== actor || !setupConfig() || Date.now() >= signed.expires
      || !Number.isFinite(permitExpires) || Date.now() >= permitExpires) return fail();
    const current = await ledger(config, actor, "check");
    if (current.state !== "consumed" || current.outcome) return fail();
    if (!plan.alreadyConfigured) {
      if (Date.now() + 8000 >= signed.expires || Date.now() + 8000 >= permitExpires) return fail();
      attempted = true; // A failed response may still mean Whapi applied the PATCH.
      const updated = await provider(config, "/settings", plan.after);
      if (!object(updated) || fingerprint(updated.before_update) !== signed.before || fingerprint(updated.after_update) !== signed.after) return fail();
    }
    const saved = await provider(config, "/settings"); validateSettings(saved);
    if (fingerprint(saved) !== signed.after) return fail();
    const finished = await ledger(config, actor, "finish", {p_outcome: "verified"});
    if (!["recorded", "already_finished"].includes(finished.state) || finished.outcome !== "verified") return fail();
    return {state: "verified", message: "Callback settings verified. No WhatsApp messages were sent and sending remains off. Remove the temporary installer; live STOP/delivery transport verification is a separate step."};
  } catch {
    if (claimed && config && actor) {
      try {await ledger(config, actor, "finish", {p_outcome: attempted ? "uncertain" : "preflight_failed"});} catch { /* consumed reservation remains authoritative */ }
    }
    return {state: claimed ? "consumed_review_required" : "review_required", message: claimed
      ? "The one-use operation is consumed. Do not retry a settings update. Privately inspect provider settings and the setup ledger; sending remains off."
      : "Setup stopped before a provider update. Review authorization, expiry and settings changes before preparing a new preview."};
  }
}

// Recovery is deliberately GET-only, including after an uncertain/expired claim.
// It never reopens the permit or rewrites the historical outcome.
export async function inspectCallbackSetup(): Promise<SetupResult> {
  try {
    const config = setupConfig(), actor = await reportAdministrator(); if (!config || !actor) return unavailable();
    const permit = await ledger(config, actor, "check");
    if (!permit.consumed || !permit.after_hash || !/^[a-f0-9]{64}$/.test(permit.after_hash)) return unavailable();
    verifyChannel(await provider(config, "/health?wakeup=false"));
    const plan = planCallbackSetup(await provider(config, "/settings"), config);
    return plan.alreadyConfigured && fingerprint(plan.before) === permit.after_hash
      ? {state: "readback_verified", message: "Read-only inspection matches the reserved settings. No update, retry, message or audit-history rewrite occurred. Provider callback delivery still requires separate verification."}
      : {state: "readback_mismatch", message: "Saved settings differ from the reserved setup. Keep sending off; obtain an operator review. This control will not retry or revert the update."};
  } catch {return {state: "readback_unavailable", message: "Read-only verification could not be completed. No settings were changed; keep sending off and retain the consumed permit."};}
}

// Separate, default-off GET-only diagnosis works after installer retirement.
// It never consults/changes a setup permit or needs a retired setup RPC grant.
export function callbackDiagnosticsEnabled() {
  return process.env.DEKEZ_COLLECTION_DIAGNOSTICS_ENABLED === "true"
    && process.env.DEKEZ_COLLECTION_SETUP_ENABLED === "false";
}

function diagnosticConfig(env: NodeJS.ProcessEnv) {
  if (env.DEKEZ_COLLECTION_DIAGNOSTICS_ENABLED !== "true") return fail("diagnostics_disabled");
  if (env.DEKEZ_COLLECTION_SETUP_ENABLED !== "false") return fail("installer_not_disabled");
  if (env.VERCEL_ENV !== "production" || env.VERCEL_PROJECT_ID !== PROJECT) return fail("production_project");
  if (env.DEKEZ_REPORT_COMPANY_ID !== COMPANY) return fail("company_scope");
  if (env.DEKEZ_COLLECTION_SEND_ENABLED !== "false" || env.DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED !== "false") return fail("sending_not_disabled");
  if (!/^dpl_[A-Za-z0-9]{8,100}$/.test(env.VERCEL_DEPLOYMENT_ID ?? "")
    || !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? "")) return fail("deployment_identity");
  const token = env.WHAPI_TOKEN?.trim() ?? "", secret = env.WHAPI_COLLECTION_WEBHOOK_SECRET ?? "";
  const reportSecret = env.WHAPI_REPORT_WEBHOOK_SECRET ?? "", cron = env.CRON_SECRET ?? "";
  if (!token || /[\r\n]/.test(token) || MASKED.test(token)) return fail("provider_credential");
  if (!reportSecret || /[\r\n]/.test(reportSecret) || MASKED.test(reportSecret)) return fail("report_credential");
  if (!cron || /[\r\n]/.test(cron)) return fail("cron_credential");
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(secret) || [token, reportSecret, cron].includes(secret)) return fail("dedicated_callback_credential");
  return {token, secret, reportSecret};
}

async function assertDiagnosticAdministrator(actor: string) {
  const client = createAdminClient();
  const {error} = await client.rpc("dekez_collection_assert_admin", {p_company: COMPANY, p_actor: actor})
    .abortSignal(AbortSignal.timeout(5000));
  if (error) return fail("company_authorization");
  const permission = await client.from("user_module_permissions").select("access_level")
    .eq("profile_id", actor).eq("module_key", "admin_setup").abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (permission.error || (permission.data && permission.data.access_level !== "manage")) return fail("module_authorization");
}

export async function diagnoseCallbackSetup(): Promise<SetupDiagnostic> {
  let stage = "authorization";
  try {
    const actor = await reportAdministrator();
    if (!actor) return {state: "blocked", stage, code: "administrator_required"};
    stage = "configuration";
    const config = diagnosticConfig(process.env);
    stage = "authorization";
    await assertDiagnosticAdministrator(actor);
    stage = "health_request";
    const health = await provider(config, "/health?wakeup=false");
    stage = "health_validation";
    verifyChannel(health);
    stage = "settings_request";
    const settings = await provider(config, "/settings");
    stage = "settings_validation";
    validateSettings(settings);
    stage = "callback_preservation";
    const plan = planCallbackSetup(settings, config);
    stage = "authorization";
    if (await reportAdministrator() !== actor) return fail("administrator_required");
    await assertDiagnosticAdministrator(actor);
    return {state: "compatible", stage: "complete", code: "read_only_checks_passed", callbackPresent: plan.alreadyConfigured};
  } catch (error) {
    return error instanceof SetupValidationError
      ? {state: "blocked", stage, code: error.code, ...(error.field ? {field: error.field} : {}),
        ...(error.httpStatus !== undefined ? {httpStatus: error.httpStatus} : {})}
      : {state: "blocked", stage, code: "request_failed"};
  }
}

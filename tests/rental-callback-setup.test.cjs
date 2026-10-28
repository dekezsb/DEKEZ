// Review-only setup tests: synthetic credentials and provider payloads, no real network.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const makeLoader = require('./marketplace-component-loader.cjs');

const COMPANY = '660cc0c4-daee-445b-9146-ccd112e791d4';
const OPERATION = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'synthetic_whapi_api_token_' + 'T'.repeat(43);
const SECRET = 'synthetic_collection_webhook_secret_' + 'S'.repeat(43);
const REPORT_SECRET = 'synthetic_report_webhook_secret_' + 'R'.repeat(43);
const CRON_SECRET = 'synthetic_existing_cron_secret_' + 'C'.repeat(43);
const CALLBACK = 'https://dekez.vercel.app/api/webhooks/whapi-rental-reminders';
const REPORT_CALLBACK = 'https://dekez.vercel.app/api/webhooks/whapi-reporting';
const MODULE = 'lib/rental-collection/callback-setup.ts';
let originalFetch, forbiddenFetches, originalNow, originalEnv;
const ENV_KEYS = Object.keys(environment());
beforeEach(() => {
  originalFetch = global.fetch; forbiddenFetches = 0;
  originalNow = Date.now; originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  global.fetch = async () => { forbiddenFetches++; throw Error('Real network forbidden in setup tests'); };
});
afterEach(() => {
  global.fetch = originalFetch;
  Date.now = originalNow;
  for (const key of ENV_KEYS) if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  assert.equal(forbiddenFetches, 0, 'Test attempted an unstubbed network request');
});

function moduleUnderTest(overrides = {}) {
  return makeLoader({
    'server-only': {},
    '@/lib/management-report/authorization': { reportAdministrator: async () => null },
    '@/lib/supabase/admin': { createAdminClient: () => { throw Error('Unexpected database use in pure test'); } },
    ...overrides,
  })(MODULE);
}
function environment(change = {}) {
  return {
    VERCEL_ENV: 'production', VERCEL_PROJECT_ID: 'prj_YkRkOBkodAdGUErZMYsoIwjqaFiQ',
    VERCEL_URL: 'dekez-synthetic-review.vercel.app', VERCEL_DEPLOYMENT_ID: 'dpl_SyntheticReview12345', DEKEZ_REPORT_COMPANY_ID: COMPANY,
    DEKEZ_COLLECTION_SETUP_ENABLED: 'true', DEKEZ_COLLECTION_SETUP_OPERATION: OPERATION,
    DEKEZ_COLLECTION_SEND_ENABLED: 'false', DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED: 'false',
    WHAPI_TOKEN: TOKEN, WHAPI_COLLECTION_WEBHOOK_SECRET: SECRET,
    WHAPI_REPORT_WEBHOOK_SECRET: REPORT_SECRET, CRON_SECRET,
    ...change,
  };
}
function settings() {
  return {
    pdo_sync: false, callback_backoff_delay_ms: 6000, max_callback_backoff_delay_ms: 1200000,
    callback_persist: false, media: { auto_download: ['document', 'image'], init_avatars: false },
    proxy: '', mobile_proxy: '', offline_mode: true, full_history: false,
    auto_read_messages: false, outgoing_calls_enabled: false, locale: 'ms-MY',
    mock_pairing_code: '', ignored_presences: [], data_mode: 'extend',
    webhooks: [{ url: REPORT_CALLBACK, mode: 'body', headers: { Authorization: `Bearer ${REPORT_SECRET}` },
      events: [{ type: 'messages', method: 'post' }], webhook_max_age_seconds: 900, send_undecrypted_ad: false }],
  };
}
function config(mod = moduleUnderTest()) {
  const result = mod.setupConfig(environment()); assert.ok(result); return result;
}
const clone = value => JSON.parse(JSON.stringify(value));

test('setup is disabled by default and requires the pinned production project and company', () => {
  const { setupConfig } = moduleUnderTest();
  assert.equal(setupConfig({}), null);
  for (const change of [
    { DEKEZ_COLLECTION_SETUP_ENABLED: undefined }, { DEKEZ_COLLECTION_SETUP_ENABLED: 'false' },
    { DEKEZ_COLLECTION_SETUP_ENABLED: 'TRUE' }, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' },
    { VERCEL_PROJECT_ID: 'another-project' }, { VERCEL_DEPLOYMENT_ID: '' },
    { VERCEL_DEPLOYMENT_ID: 'evil.example' }, { VERCEL_DEPLOYMENT_ID: 'dekez.vercel.app' },
    { DEKEZ_REPORT_COMPANY_ID: '22222222-2222-4222-8222-222222222222' },
    { DEKEZ_COLLECTION_SETUP_OPERATION: '' }, { DEKEZ_COLLECTION_SETUP_OPERATION: 'not-a-uuid' },
  ]) assert.equal(setupConfig(environment(change)), null, JSON.stringify(change));
  const ready = setupConfig(environment());
  assert.equal(ready.companyId, COMPANY); assert.equal(ready.operationId, OPERATION);
  assert.equal(ready.token, TOKEN); assert.equal(ready.secret, SECRET); assert.equal(ready.reportSecret, REPORT_SECRET);
});

test('setup requires both tenant and Rosley sends explicitly false and never changes flags', () => {
  const { setupConfig } = moduleUnderTest();
  for (const name of ['DEKEZ_COLLECTION_SEND_ENABLED', 'DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED']) {
    for (const value of [undefined, '', 'true', 'FALSE']) assert.equal(setupConfig(environment({ [name]: value })), null);
  }
  const env = environment({ DEKEZ_REPORT_SEND_ENABLED: 'true', DEKEZ_REPORT_SCHEDULE_ENABLED: 'true', DEKEZ_REPORT_COMMANDS_ENABLED: 'true' });
  const before = clone(env); assert.ok(setupConfig(env)); assert.deepEqual(env, before);
});

test('setup rejects missing, weak and reused callback secrets', () => {
  const { setupConfig } = moduleUnderTest();
  for (const change of [
    { WHAPI_TOKEN: '' }, { WHAPI_COLLECTION_WEBHOOK_SECRET: '' }, { WHAPI_COLLECTION_WEBHOOK_SECRET: 'short' },
    { WHAPI_COLLECTION_WEBHOOK_SECRET: 'x'.repeat(42) }, { WHAPI_COLLECTION_WEBHOOK_SECRET: 'x'.repeat(50) + '\r\n' },
    { WHAPI_COLLECTION_WEBHOOK_SECRET: TOKEN }, { WHAPI_COLLECTION_WEBHOOK_SECRET: REPORT_SECRET },
    { WHAPI_COLLECTION_WEBHOOK_SECRET: CRON_SECRET },
  ]) assert.equal(setupConfig(environment(change)), null);
});

test('channel verification fails closed on a different channel, sender or missing identity', () => {
  const { verifyChannel } = moduleUnderTest();
  const healthy = { channel_id: 'FALCON-D9NS9', status: { code: 4, text: 'AUTH' }, user: { id: '60168173911', phone: '60168173911', name: 'DEKEZ AI MANAGER' } };
  assert.doesNotThrow(() => verifyChannel(healthy));
  for (const health of [null, {}, [], { ...healthy, channel_id: 'OTHER-CHANNEL' },
    { ...healthy, user: undefined }, { ...healthy, user: { id: '60198894911', phone: '60198894911' } },
    { ...healthy, user: { id: '60168173911', phone: '60198894911' } },
    { ...healthy, status: undefined }, { ...healthy, status: 'AUTH' },
    { ...healthy, status: { text: 'QR' } }, { ...healthy, status: { text: 'ERROR' } },
    { ...healthy, status: { text: 'SYNC_ERROR' } }, { ...healthy, status: { text: 'INIT' } },
  ]) assert.throws(() => verifyChannel(health));
});

test('planning preserves the complete settings snapshot and existing management callback without mutation', () => {
  const mod = moduleUnderTest(), current = settings(), before = clone(current);
  const plan = mod.planCallbackSetup(current, config(mod));
  assert.deepEqual(current, before, 'Planning must not mutate the provider input');
  assert.deepEqual(plan.before, before); assert.equal(plan.alreadyConfigured, false);
  assert.equal(plan.existingWebhookCount, 1); assert.equal(plan.after.webhooks.length, 2);
  const { webhooks: _beforeHooks, ...beforeRest } = before;
  const { webhooks: _afterHooks, ...afterRest } = plan.after;
  assert.deepEqual(afterRest, beforeRest); assert.deepEqual(plan.after.webhooks[0], before.webhooks[0]);
  const callback = plan.after.webhooks[1];
  assert.equal(callback.url, CALLBACK); assert.equal(callback.mode, 'body');
  assert.deepEqual(callback.headers, { Authorization: `Bearer ${SECRET}` });
  assert.deepEqual(callback.events, [{ type: 'messages', method: 'post' }, { type: 'statuses', method: 'post' }]);
});

test('planning preserves all original hook ordering, independent headers and subscriptions', () => {
  const mod = moduleUnderTest(), current = settings();
  current.webhooks.push({ url: 'https://existing.example.invalid/hooks', mode: 'path',
    headers: { 'X-Existing-Header': 'synthetic-existing-value' }, events: [{ type: 'channel', method: 'post' }] });
  const before = clone(current), plan = mod.planCallbackSetup(current, config(mod));
  assert.equal(plan.existingWebhookCount, 2);
  assert.deepEqual(plan.after.webhooks.slice(0, 2), before.webhooks);
  assert.equal(plan.after.webhooks.filter(hook => hook.url === CALLBACK).length, 1);
});

test('an exactly matching installed callback is a no-op, not a second callback', () => {
  const mod = moduleUnderTest(), cfg = config(mod);
  const installed = mod.planCallbackSetup(settings(), cfg).after;
  const plan = mod.planCallbackSetup(installed, cfg);
  assert.equal(plan.alreadyConfigured, true); assert.deepEqual(plan.after, installed);
  assert.equal(plan.after.webhooks.filter(hook => hook.url === CALLBACK).length, 1);
});

test('conflicting or duplicate rental callbacks are rejected rather than overwritten', () => {
  const mod = moduleUnderTest(), cfg = config(mod), installed = mod.planCallbackSetup(settings(), cfg).after;
  for (const change of [
    hook => ({ ...hook, headers: { Authorization: 'Bearer wrong-secret' } }),
    hook => ({ ...hook, mode: 'path' }),
    hook => ({ ...hook, events: [{ type: 'messages', method: 'post' }] }),
    hook => ({ ...hook, events: [...hook.events, { type: 'groups', method: 'post' }] }),
  ]) {
    const other = clone(installed); other.webhooks[1] = change(other.webhooks[1]);
    assert.throws(() => mod.planCallbackSetup(other, cfg));
  }
  const duplicate = clone(installed); duplicate.webhooks.push(clone(duplicate.webhooks[1]));
  assert.throws(() => mod.planCallbackSetup(duplicate, cfg));
});

test('unknown, malformed, masked and ambiguous settings fail closed', () => {
  const mod = moduleUnderTest(), cfg = config(mod);
  for (const value of [null, [], {}, { ...settings(), unreviewed_new_setting: true },
    { ...settings(), pdo_sync: 'false' }, { ...settings(), callback_backoff_delay_ms: 2999 },
    { ...settings(), max_callback_backoff_delay_ms: 3600001 },
    { ...settings(), data_mode: 'unreviewed-mode' }, { ...settings(), webhooks: null },
    { ...settings(), media: { auto_download: ['unreviewed-media'] } },
    { ...settings(), proxy: '********' },
  ]) assert.throws(() => mod.planCallbackSetup(value, cfg));
  const masked = settings(); masked.webhooks[0].headers.Authorization = 'Bearer ********';
  assert.throws(() => mod.planCallbackSetup(masked, cfg));
});

test('incomplete provider snapshots cannot reset omitted channel defaults', () => {
  const mod = moduleUnderTest(), cfg = config(mod);
  for (const key of ['pdo_sync', 'callback_persist', 'offline_mode', 'full_history', 'auto_read_messages',
    'outgoing_calls_enabled', 'callback_backoff_delay_ms', 'max_callback_backoff_delay_ms',
    'media', 'ignored_presences', 'data_mode']) {
    const incomplete = settings(); delete incomplete[key];
    assert.throws(() => mod.planCallbackSetup(incomplete, cfg), key);
  }
  for (const key of ['auto_download', 'init_avatars']) {
    const incomplete = settings(); delete incomplete.media[key];
    assert.throws(() => mod.planCallbackSetup(incomplete, cfg), `media.${key}`);
  }
  assert.throws(() => mod.planCallbackSetup({ webhooks: settings().webhooks }, cfg));
});

test('optional proxy and identity settings are preserved when present and are not invented when absent', () => {
  const mod = moduleUnderTest(), cfg = config(mod), current = settings();
  for (const key of ['proxy', 'mobile_proxy', 'locale', 'mock_pairing_code']) delete current[key];
  const plan = mod.planCallbackSetup(current, cfg);
  for (const key of ['proxy', 'mobile_proxy', 'locale', 'mock_pairing_code']) assert.equal(Object.hasOwn(plan.after, key), false);
});

test('provider errors returned by planning do not contain either credential or raw settings', () => {
  const mod = moduleUnderTest(), current = settings(); current.unrecognized = SECRET;
  try { mod.planCallbackSetup(current, config(mod)); assert.fail('Expected rejection'); }
  catch (error) {
    const message = String(error);
    for (const secret of [TOKEN, SECRET, REPORT_SECRET, CRON_SECRET]) assert.equal(message.includes(secret), false);
  }
});

test('the existing command callback must retain its exact authentication and required event', () => {
  const mod = moduleUnderTest(), cfg = config(mod);
  for (const replace of [
    () => [],
    hooks => [...hooks, clone(hooks[0])],
    hooks => [{ ...hooks[0], headers: {} }],
    hooks => [{ ...hooks[0], headers: { Authorization: 'Bearer synthetic_wrong_secret' } }],
    hooks => [{ ...hooks[0], events: [{ type: 'statuses', method: 'post' }] }],
  ]) {
    const current = settings(); current.webhooks = replace(current.webhooks);
    assert.throws(() => mod.planCallbackSetup(current, cfg));
  }
  const current = settings(); current.webhooks[0].headers = { authorization: `Bearer ${REPORT_SECRET}` };
  const plan = mod.planCallbackSetup(current, cfg);
  assert.deepEqual(plan.after.webhooks[0], current.webhooks[0], 'Existing header casing remains unchanged');
});

test('ambiguous headers and callback URL variants are rejected without leaking destination details', () => {
  const mod = moduleUnderTest(), cfg = config(mod);
  for (const change of [
    { headers: { Authorization: `Bearer ${REPORT_SECRET}`, authorization: `Bearer ${REPORT_SECRET}` } },
    { headers: { Authorization: `Bearer ${REPORT_SECRET}\r\nX-Injected: value` } },
    { url: 'http://dekez.vercel.app/api/webhooks/whapi-reporting' },
    { url: REPORT_CALLBACK + '?token=synthetic' }, { url: REPORT_CALLBACK + '#fragment' },
    { url: 'https://user:password@dekez.vercel.app/api/webhooks/whapi-reporting' },
  ]) {
    const current = settings(); current.webhooks[0] = { ...current.webhooks[0], ...change };
    assert.throws(() => mod.planCallbackSetup(current, cfg));
  }
});

test('existing target or management URL aliases cannot cause duplicate callback subscriptions', () => {
  const mod = moduleUnderTest(), cfg = config(mod);
  for (const fixed of [CALLBACK, REPORT_CALLBACK]) {
    const parsed = new URL(fixed);
    for (const alias of [
      `${fixed}/`, `${fixed}//`, fixed.replace('dekez.vercel.app', 'DEKEZ.VERCEL.APP'),
      fixed.replace('dekez.vercel.app', 'dekez.vercel.app:443'),
      fixed.replace('/api/', '/%61pi/'), fixed.replace('/api/', '/%2561pi/'),
      fixed.replace('/api/webhooks/', '/api%2Fwebhooks/'),
      fixed.replace('/api/webhooks/', '/api/unused/../webhooks/'),
      fixed.replace('/api/webhooks/', '/api/%2e/webhooks/'),
      `${parsed.origin}//${parsed.pathname.slice(1)}`,
    ]) {
      const current = settings();
      current.webhooks.push({ ...clone(current.webhooks[0]), url: alias });
      assert.throws(() => mod.planCallbackSetup(current, cfg), alias);
    }
  }
});

const ACTOR = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-28T10:00:00.000Z');
function orchestration(options = {}) {
  Object.assign(process.env, environment()); Date.now = () => NOW;
  const calls = [], rpcs = [], authCalls = [], outcomes = [];
  let current = clone(options.settings ?? settings()), consumed = false, reservation;
  const expiry = new Date(NOW + 10 * 60 * 1000).toISOString();
  const db = { rpc: (name, args) => ({ abortSignal: async signal => {
    assert.ok(signal instanceof AbortSignal); rpcs.push({ name, args });
    assert.equal(args.p_company, COMPANY); assert.equal(args.p_actor, ACTOR); assert.equal(args.p_operation, OPERATION);
    const action = name.replace('dekez_collection_setup_', '');
    if (options.rpc) {
      const result = await options.rpc(action, args, { consumed });
      if (result !== undefined) return result;
    }
    if (action === 'check') return { data: { state: consumed ? 'consumed' : 'ready', expires_at: expiry,
      consumed, before_hash: reservation?.p_before_hash, after_hash: reservation?.p_after_hash, deployment: reservation?.p_deployment }, error: null };
    if (action === 'claim') {
      assert.match(args.p_before_hash, /^[a-f0-9]{64}$/); assert.match(args.p_after_hash, /^[a-f0-9]{64}$/);
      assert.match(args.p_deployment, /^dpl_[A-Za-z0-9]{8,100}$/);
      if (consumed) return { data: { state: 'used', expires_at: expiry }, error: null };
      consumed = true; reservation = args; if (options.onClaim) options.onClaim();
      return { data: { state: 'claimed', expires_at: expiry }, error: null };
    }
    if (action === 'finish') { outcomes.push(args.p_outcome); return { data: { state: 'recorded', outcome: args.p_outcome }, error: null }; }
    throw Error('Unexpected setup RPC');
  } }) };
  const mod = moduleUnderTest({
    '@/lib/management-report/authorization': { reportAdministrator: async () => {
      authCalls.push(true);
      return options.admin ? options.admin(authCalls.length) : ACTOR;
    } },
    '@/lib/supabase/admin': { createAdminClient: () => db },
  });
  global.fetch = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://gate.whapi.cloud');
    assert.ok(['/settings', '/health'].includes(parsed.pathname));
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`); assert.ok(init.signal instanceof AbortSignal);
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (options.fetch) {
      const result = await options.fetch(url, init, { current: clone(current), calls });
      if (result !== undefined) return result;
    }
    if (parsed.pathname === '/health') {
      assert.equal(init.method, 'GET'); assert.equal(parsed.search, '?wakeup=false');
      return Response.json({ channel_id: 'FALCON-D9NS9', status: { code: 4, text: 'AUTH' }, user: { id: '60168173911', phone: '60168173911' } });
    }
    assert.equal(parsed.search, '');
    if (init.method === 'GET') return Response.json(current);
    assert.equal(init.method, 'PATCH');
    const before = current; current = JSON.parse(init.body);
    const result = { before_update: before, after_update: current, changes: ['webhooks'] };
    if (options.afterPatch) current = options.afterPatch(clone(current));
    return Response.json(result);
  };
  return { mod, calls, rpcs, outcomes, authCalls, get current() { return current; },
    setSettings(value) { current = clone(value); }, get consumed() { return consumed; } };
}
const patches = harness => harness.calls.filter(call => call.method === 'PATCH');
const claims = harness => harness.rpcs.filter(call => call.name.endsWith('_claim'));
function safeOutput(result) {
  const serialized = JSON.stringify(result);
  for (const value of [TOKEN, SECRET, REPORT_SECRET, CRON_SECRET]) assert.equal(serialized.includes(value), false);
  assert.equal(serialized.includes('before_update'), false); assert.equal(serialized.includes('after_update'), false);
  return result;
}

test('preview reads only a permitted channel and returns a short signed non-secret ticket', async () => {
  const h = orchestration(), result = safeOutput(await h.mod.previewCallbackSetup());
  assert.equal(result.state, 'preview'); assert.equal(result.existingWebhookCount, 1); assert.ok(result.ticket);
  assert.equal(claims(h).length, 0); assert.equal(patches(h).length, 0); assert.equal(h.consumed, false);
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'GET']);
  const decoded = JSON.parse(Buffer.from(result.ticket.split('.')[0], 'base64url').toString());
  safeOutput(decoded); assert.equal(decoded.actor, ACTOR); assert.equal(decoded.operation, OPERATION);
  assert.ok(decoded.expires <= NOW + 120000); assert.ok(decoded.expires > NOW);
});

test('missing, consumed, revoked and expired permits cannot contact the provider', async () => {
  for (const state of ['missing', 'consumed', 'revoked', 'expired', 'not_authorized']) {
    const h = orchestration({ rpc: async () => ({ data: { state }, error: null }) });
    const result = safeOutput(await h.mod.previewCallbackSetup());
    assert.equal(result.state, 'unavailable'); assert.equal(h.calls.length, 0); assert.equal(claims(h).length, 0);
  }
});

test('an unauthenticated or unauthorized user cannot read provider settings or consume setup', async () => {
  const h = orchestration({ admin: () => null });
  assert.equal((await h.mod.previewCallbackSetup()).state, 'unavailable');
  assert.equal((await h.mod.executeCallbackSetup('not-a-ticket', true)).state, 'unavailable');
  assert.equal(h.calls.length, 0); assert.equal(h.rpcs.length, 0);
});

test('an unauthenticated channel cannot proceed to settings inspection, claim or PATCH', async () => {
  const h = orchestration({ fetch: async url => url.endsWith('/health?wakeup=false')
    ? Response.json({ channel_id: 'FALCON-D9NS9', status: { text: 'QR' }, user: { id: '60168173911', phone: '60168173911' } }) : undefined });
  assert.equal((await h.mod.previewCallbackSetup()).state, 'review_required');
  assert.equal(h.calls.length, 1); assert.equal(claims(h).length, 0); assert.equal(patches(h).length, 0);
});

test('execution requires explicit confirmation and rejects tampered or expired tickets before provider use', async () => {
  const h = orchestration(), preview = await h.mod.previewCallbackSetup(), count = h.calls.length;
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, false)).state, 'unavailable');
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket + 'tampered', true)).state, 'review_required');
  Date.now = () => NOW + 120001;
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'review_required');
  assert.equal(h.calls.length, count); assert.equal(claims(h).length, 0);
});

test('one approved execution consumes before one PATCH, preserves settings and records verified outcome', async () => {
  const h = orchestration(), before = clone(h.current), preview = await h.mod.previewCallbackSetup();
  const result = safeOutput(await h.mod.executeCallbackSetup(preview.ticket, true));
  assert.equal(result.state, 'verified'); assert.equal(claims(h).length, 1); assert.equal(patches(h).length, 1);
  assert.deepEqual(h.outcomes, ['verified']); assert.equal(h.consumed, true); assert.equal(h.authCalls.length, 3);
  assert.deepEqual(h.current.webhooks[0], before.webhooks[0]); assert.equal(h.current.webhooks.length, 2);
  assert.equal(process.env.DEKEZ_COLLECTION_SEND_ENABLED, 'false'); assert.equal(process.env.DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED, 'false');
  const second = safeOutput(await h.mod.executeCallbackSetup(preview.ticket, true));
  assert.equal(second.state, 'unavailable'); assert.equal(patches(h).length, 1);
});

test('changed settings after preview reject execution before claim and PATCH', async () => {
  const h = orchestration(), preview = await h.mod.previewCallbackSetup();
  h.setSettings({ ...h.current, locale: 'en-MY' });
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'review_required');
  assert.equal(claims(h).length, 0); assert.equal(patches(h).length, 0);
});

test('a lost concurrent claim never patches settings or records a success', async () => {
  const h = orchestration({ rpc: async action => action === 'claim' ? { data: { state: 'used' }, error: null } : undefined });
  const preview = await h.mod.previewCallbackSetup();
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'unavailable');
  assert.equal(claims(h).length, 1); assert.equal(patches(h).length, 0); assert.deepEqual(h.outcomes, []);
});

test('simultaneous application calls share the atomic ledger and permit at most one provider mutation', async () => {
  const h = orchestration(), preview = await h.mod.previewCallbackSetup();
  const results = await Promise.all([h.mod.executeCallbackSetup(preview.ticket, true), h.mod.executeCallbackSetup(preview.ticket, true)]);
  assert.equal(patches(h).length, 1); assert.equal(results.filter(result => result.state === 'verified').length, 1);
  assert.deepEqual(h.outcomes, ['verified']); results.forEach(safeOutput);
});

test('fresh Admin revocation after claim fails closed and consumes the one-use operation', async () => {
  const h = orchestration({ admin: call => call >= 3 ? null : ACTOR }), preview = await h.mod.previewCallbackSetup();
  const result = safeOutput(await h.mod.executeCallbackSetup(preview.ticket, true));
  assert.equal(result.state, 'consumed_review_required'); assert.equal(patches(h).length, 0);
  assert.equal(h.consumed, true); assert.deepEqual(h.outcomes, ['preflight_failed']);
});

test('expiry while waiting for the atomic claim prevents the provider PATCH', async () => {
  const h = orchestration({ onClaim: () => { Date.now = () => NOW + 120001; } }), preview = await h.mod.previewCallbackSetup();
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'consumed_review_required');
  assert.equal(patches(h).length, 0); assert.deepEqual(h.outcomes, ['preflight_failed']);
});

test('uncertain PATCH delivery never retries and never leaks credentials from the thrown error', async () => {
  const h = orchestration({ fetch: async (_url, init) => {
    if (init.method === 'PATCH') throw Error(`synthetic transport error ${TOKEN} ${SECRET}`);
  } }), preview = await h.mod.previewCallbackSetup();
  const result = safeOutput(await h.mod.executeCallbackSetup(preview.ticket, true));
  assert.equal(result.state, 'consumed_review_required'); assert.equal(patches(h).length, 1);
  assert.deepEqual(h.outcomes, ['uncertain']);
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'unavailable');
  assert.equal(patches(h).length, 1);
});

test('provider HTTP failure containing sensitive body text is sanitized and consumes uncertain attempt', async () => {
  const h = orchestration({ fetch: async (_url, init) => init.method === 'PATCH'
    ? new Response(`${TOKEN} ${SECRET} ${REPORT_SECRET}`, { status: 500 }) : undefined });
  const preview = await h.mod.previewCallbackSetup(), result = safeOutput(await h.mod.executeCallbackSetup(preview.ticket, true));
  assert.equal(result.state, 'consumed_review_required'); assert.equal(patches(h).length, 1); assert.deepEqual(h.outcomes, ['uncertain']);
});

test('provider response drift is not auto-overwritten, reverted or retried', async () => {
  const h = orchestration({ afterPatch: current => ({ ...current, locale: 'unexpected-change' }) });
  const preview = await h.mod.previewCallbackSetup(), result = safeOutput(await h.mod.executeCallbackSetup(preview.ticket, true));
  assert.equal(result.state, 'consumed_review_required'); assert.equal(patches(h).length, 1); assert.deepEqual(h.outcomes, ['uncertain']);
});

test('already-configured callback records verification without repeating a provider mutation', async () => {
  const mod = moduleUnderTest(), installed = mod.planCallbackSetup(settings(), config(mod)).after;
  const h = orchestration({ settings: installed }), preview = await h.mod.previewCallbackSetup();
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'verified');
  assert.equal(patches(h).length, 0); assert.equal(claims(h).length, 1); assert.deepEqual(h.outcomes, ['verified']);
});

test('disabled configuration cannot call a provider or ledger even for a signed preview', async () => {
  const h = orchestration(), preview = await h.mod.previewCallbackSetup(), count = h.calls.length, dbCount = h.rpcs.length;
  process.env.DEKEZ_COLLECTION_SETUP_ENABLED = 'false';
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'unavailable');
  assert.equal(h.calls.length, count); assert.equal(h.rpcs.length, dbCount);
});

test('preview tickets are bound to their approved actor, operation and deployment', async () => {
  for (const change of [
    { DEKEZ_COLLECTION_SETUP_OPERATION: '33333333-3333-4333-8333-333333333333' },
    { VERCEL_DEPLOYMENT_ID: 'dpl_AnotherSynthetic123' },
  ]) {
    const h = orchestration(), preview = await h.mod.previewCallbackSetup(), count = h.calls.length, dbCount = h.rpcs.length;
    Object.assign(process.env, change);
    assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'review_required');
    assert.equal(h.calls.length, count); assert.equal(h.rpcs.length, dbCount);
  }
  const h = orchestration({ admin: call => call === 1 ? ACTOR : '44444444-4444-4444-8444-444444444444' });
  const preview = await h.mod.previewCallbackSetup(), count = h.calls.length, dbCount = h.rpcs.length;
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'review_required');
  assert.equal(h.calls.length, count); assert.equal(h.rpcs.length, dbCount);
});

test('oversized provider bodies stop the preflight without consuming an authorization', async () => {
  for (const withLength of [true, false]) {
    const h = orchestration({ fetch: async url => url.endsWith('/settings') ? new Response('x'.repeat(131073), {
      status: 200, headers: withLength ? { 'content-length': '131073' } : {},
    }) : undefined });
    const result = safeOutput(await h.mod.previewCallbackSetup());
    assert.equal(result.state, 'review_required'); assert.equal(claims(h).length, 0); assert.equal(patches(h).length, 0);
  }
});

test('a provider snapshot missing a required preservation field cannot reach claim or PATCH', async () => {
  const incomplete = settings(); delete incomplete.outgoing_calls_enabled;
  const h = orchestration({ settings: incomplete }), result = safeOutput(await h.mod.previewCallbackSetup());
  assert.equal(result.state, 'review_required'); assert.equal(claims(h).length, 0); assert.equal(patches(h).length, 0);
});

test('unrecorded finish cannot claim successful setup even when the provider settings match', async () => {
  const h = orchestration({ rpc: async action => action === 'finish' ? { data: { state: 'missing' }, error: null } : undefined });
  const preview = await h.mod.previewCallbackSetup(), result = safeOutput(await h.mod.executeCallbackSetup(preview.ticket, true));
  assert.equal(result.state, 'consumed_review_required'); assert.equal(patches(h).length, 1);
});

test('malformed reservation expiry cannot permit a provider mutation', async () => {
  for (const expires_at of [undefined, '', 'not-a-date']) {
    const h = orchestration({ rpc: async action => action === 'claim'
      ? { data: { state: 'claimed', expires_at }, error: null } : undefined });
    const preview = await h.mod.previewCallbackSetup(), result = safeOutput(await h.mod.executeCallbackSetup(preview.ticket, true));
    assert.equal(result.state, 'consumed_review_required'); assert.equal(patches(h).length, 0);
    assert.deepEqual(h.outcomes, ['preflight_failed']);
  }
});

test('revocation detected immediately after claim prevents PATCH and preserves consumed status', async () => {
  const h = orchestration({ rpc: async (action, _args, { consumed }) => action === 'check' && consumed
    ? { data: { state: 'revoked', consumed: true }, error: null } : undefined });
  const preview = await h.mod.previewCallbackSetup();
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket, true)).state, 'consumed_review_required');
  assert.equal(patches(h).length, 0); assert.deepEqual(h.outcomes, ['preflight_failed']);
});

test('read-only recovery confirms saved reserved settings without another PATCH or audit rewrite', async () => {
  const h = orchestration(), preview = await h.mod.previewCallbackSetup();
  await h.mod.executeCallbackSetup(preview.ticket, true);
  const dbCount = h.rpcs.length, callCount = h.calls.length, beforeOutcomes = [...h.outcomes];
  const result = safeOutput(await h.mod.inspectCallbackSetup());
  assert.equal(result.state, 'readback_verified'); assert.equal(patches(h).length, 1);
  assert.deepEqual(h.calls.slice(callCount).map(call => call.method), ['GET', 'GET']);
  assert.deepEqual(h.rpcs.slice(dbCount).map(call => call.name), ['dekez_collection_setup_check']);
  assert.deepEqual(h.outcomes, beforeOutcomes);
});

test('read-only recovery cannot create or consume an authorization', async () => {
  const h = orchestration(), result = safeOutput(await h.mod.inspectCallbackSetup());
  assert.equal(result.state, 'unavailable'); assert.equal(h.calls.length, 0);
  assert.equal(claims(h).length, 0); assert.deepEqual(h.outcomes, []);
});

test('read-only recovery reports drift but never repairs, retries or reopens the permit', async () => {
  const h = orchestration(), preview = await h.mod.previewCallbackSetup();
  await h.mod.executeCallbackSetup(preview.ticket, true);
  h.setSettings({ ...h.current, locale: 'other-change' });
  const outcomeCount = h.outcomes.length, result = safeOutput(await h.mod.inspectCallbackSetup());
  assert.equal(result.state, 'readback_mismatch'); assert.equal(patches(h).length, 1);
  assert.equal(claims(h).length, 1); assert.equal(h.outcomes.length, outcomeCount);
});

test('read-only recovery sanitizes unavailable provider settings without issuing a write', async () => {
  let unavailable = false;
  const h = orchestration({ fetch: async () => { if (unavailable) throw Error(`${TOKEN} ${REPORT_SECRET}`); } });
  const preview = await h.mod.previewCallbackSetup(); await h.mod.executeCallbackSetup(preview.ticket, true);
  unavailable = true;
  const result = safeOutput(await h.mod.inspectCallbackSetup());
  assert.equal(result.state, 'readback_unavailable'); assert.equal(patches(h).length, 1); assert.equal(claims(h).length, 1);
});

function actionHarness(requestHeaders) {
  const calls = [];
  const invoke = name => async (...args) => { calls.push({ name, args }); return { state: name, message: 'synthetic' }; };
  const { callbackSetupAction } = makeLoader({
    'next/headers': { headers: async () => new Headers(requestHeaders) },
    '@/lib/rental-collection/callback-setup': { previewCallbackSetup: invoke('preview'),
      executeCallbackSetup: invoke('execute'), inspectCallbackSetup: invoke('verify') },
  })('app/admin-setup/rental-reminders/callback-setup/actions.ts');
  return { callbackSetupAction, calls };
}
function form(operation, values = {}) {
  const data = new FormData(); data.set('operation', operation);
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const PREVIOUS = { state: 'idle', message: '' };

test('server actions reject missing or cross-site origins before reaching setup code', async () => {
  for (const headers of [{}, { origin: 'https://dekez.vercel.app' },
    { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
    { origin: 'https://dekez.vercel.app', 'sec-fetch-site': 'cross-site' },
    { origin: 'https://preview.vercel.app', 'sec-fetch-site': 'same-origin' },
    { origin: 'https://dekez.vercel.app.evil.example', 'sec-fetch-site': 'same-origin' },
    { origin: 'http://dekez.vercel.app', 'sec-fetch-site': 'same-origin' },
  ]) {
    const h = actionHarness(headers);
    for (const operation of ['preview', 'verify', 'execute']) {
      assert.equal((await h.callbackSetupAction(PREVIOUS, form(operation, { ticket: 'synthetic', confirmed: 'yes' }))).state, 'denied');
    }
    assert.equal(h.calls.length, 0);
  }
});

test('canonical same-origin actions keep preview, execution and read-only inspection distinct', async () => {
  const h = actionHarness({ origin: 'https://dekez.vercel.app', 'sec-fetch-site': 'same-origin' });
  for (const operation of ['preview', 'verify']) assert.equal((await h.callbackSetupAction(PREVIOUS, form(operation))).state, operation);
  await h.callbackSetupAction(PREVIOUS, form('execute', { ticket: 'synthetic-ticket' }));
  assert.deepEqual(h.calls[2], { name: 'execute', args: ['synthetic-ticket', false] });
  await h.callbackSetupAction(PREVIOUS, form('execute', { ticket: 'synthetic-ticket', confirmed: 'yes' }));
  assert.deepEqual(h.calls[3], { name: 'execute', args: ['synthetic-ticket', true] });
  const count = h.calls.length;
  for (const data of [form('unknown'), form('execute'), form('execute', { ticket: 'x'.repeat(2049) })]) {
    assert.equal((await h.callbackSetupAction(PREVIOUS, data)).state, 'denied');
  }
  assert.equal(h.calls.length, count);
});

function renderControl(state, pending = false) {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { CallbackSetupControl } = makeLoader({
    react: { ...React, useActionState: () => [state, () => {}, pending], useId: () => 'synthetic-confirmation' },
    './actions': { callbackSetupAction: async () => {} },
  })('app/admin-setup/rental-reminders/callback-setup/setup-control.tsx');
  return renderToStaticMarkup(React.createElement(CallbackSetupControl));
}

test('setup UI initially exposes only preview and read-only recovery, never a credential input', () => {
  const html = renderControl(PREVIOUS);
  assert.match(html, /Read channel settings and prepare preview/); assert.match(html, /Inspect consumed setup/);
  assert.doesNotMatch(html, /name="ticket"|name="confirmed"|value="execute"|type="password"/);
  assert.match(html, /cannot send messages/); safeOutput(html);
});

test('setup UI requires an explicit confirmation checkbox for a short-lived signed preview', () => {
  const html = renderControl({ state: 'preview', message: 'Ready', ticket: 'synthetic-signed-ticket', existingWebhookCount: 1 });
  const confirmation = html.match(/<input[^>]*name="confirmed"[^>]*>/)?.[0];
  assert.ok(confirmation); assert.match(confirmation, /type="checkbox"/); assert.match(confirmation, /required=""/); assert.match(confirmation, /value="yes"/);
  assert.match(html, /name="ticket"[^>]*value="synthetic-signed-ticket"/); assert.match(html, /expires within two minutes/);
  assert.match(html, /No other operator will change Whapi settings/); assert.match(html, /sending must remain disabled/);
});

test('consumed or verified UI cannot present a retry execution control', () => {
  for (const state of ['verified', 'consumed_review_required']) {
    const html = renderControl({ state, message: 'Done' });
    assert.doesNotMatch(html, /value="execute"|name="confirmed"/); assert.match(html, /button disabled=""/);
    assert.match(html, /Inspect consumed setup/); assert.match(html, /Remove this installer/);
  }
});

test('setup page is absent for unauthorized users or a disabled installation', async () => {
  for (const [actor, enabled] of [[null, true], [ACTOR, false]]) {
    const page = makeLoader({
      'next/navigation': { notFound: () => { throw Error('NOT_FOUND'); } },
      '@/lib/management-report/authorization': { reportAdministrator: async () => actor },
      '@/lib/rental-collection/callback-setup': { setupConfig: () => enabled ? {} : null },
      './setup-control': { CallbackSetupControl: () => null },
    })('app/admin-setup/rental-reminders/callback-setup/page.tsx');
    await assert.rejects(page.default(), /NOT_FOUND/);
  }
});

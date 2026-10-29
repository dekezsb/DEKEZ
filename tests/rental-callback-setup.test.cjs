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
    DEKEZ_COLLECTION_DIAGNOSTICS_ENABLED: 'false',
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
  for (const key of ['pdo_sync', 'offline_mode', 'full_history', 'auto_read_messages', 'media', 'webhooks']) {
    const incomplete = settings(); delete incomplete[key];
    assert.throws(() => mod.planCallbackSetup(incomplete, cfg), key);
  }
  for (const key of ['auto_download', 'init_avatars']) {
    const incomplete = settings(); delete incomplete.media[key];
    assert.throws(() => mod.planCallbackSetup(incomplete, cfg), `media.${key}`);
  }
  assert.throws(() => mod.planCallbackSetup({ webhooks: settings().webhooks }, cfg));
});

function productionShapeSettings() {
  // Synthetic values with the independently observed field-presence pattern;
  // never a recorded production provider payload or credential.
  const current=settings();current.proxy_trust_filters=false;
  for(const key of ['outgoing_calls_enabled','callback_backoff_delay_ms','max_callback_backoff_delay_ms',
    'ignored_presences','data_mode','mobile_proxy','mock_pairing_code'])delete current[key];
  return current;
}

test('documented sparse provider shape preserves omitted non-reset settings without synthesizing defaults',()=>{
  const mod=moduleUnderTest(),cfg=config(mod),current=productionShapeSettings(),before=clone(current);
  const plan=mod.planCallbackSetup(current,cfg);
  const {webhooks:_beforeHooks,...beforeRest}=before,{webhooks:_afterHooks,...afterRest}=plan.after;
  assert.deepEqual(current,before);assert.deepEqual(plan.before,before);assert.deepEqual(afterRest,beforeRest);
  for(const key of ['outgoing_calls_enabled','callback_backoff_delay_ms','max_callback_backoff_delay_ms','ignored_presences','data_mode']){
    assert.equal(Object.hasOwn(plan.after,key),false,key);
  }
  assert.deepEqual(plan.after.webhooks[0],before.webhooks[0]);assert.equal(plan.after.webhooks.length,2);
  const onlyResetFields={pdo_sync:false,offline_mode:true,full_history:true,auto_read_messages:true,
    media:before.media,webhooks:before.webhooks};
  const minimal=mod.planCallbackSetup(onlyResetFields,cfg);
  assert.equal(Object.hasOwn(minimal.after,'callback_persist'),false);
  assert.equal(Object.hasOwn(minimal.after,'outgoing_calls_enabled'),false);
});

test('non-default optional settings are passed through exactly instead of reverting, deleting or enabling them',()=>{
  const mod=moduleUnderTest(),cfg=config(mod),current={...settings(),callback_persist:true,outgoing_calls_enabled:true,
    proxy_trust_filters:true,callback_backoff_delay_ms:15000,max_callback_backoff_delay_ms:3600000,
    ignored_presences:['synthetic-review-contact'],data_mode:'original'};
  const before=clone(current),plan=mod.planCallbackSetup(current,cfg);
  for(const key of ['callback_persist','outgoing_calls_enabled','proxy_trust_filters','callback_backoff_delay_ms',
    'max_callback_backoff_delay_ms','ignored_presences','data_mode'])assert.deepEqual(plan.after[key],before[key],key);
  assert.deepEqual(current,before);
});

test('optional provider fields remain strictly typed when present and never accept null or coerced values',()=>{
  const mod=moduleUnderTest(),cfg=config(mod);
  for(const key of ['callback_persist','outgoing_calls_enabled','proxy_trust_filters']){
    for(const value of [null,undefined,'false','true',0,1,[],{}])assert.throws(()=>mod.planCallbackSetup({...settings(),[key]:value},cfg),key);
  }
  for(const key of ['callback_backoff_delay_ms','max_callback_backoff_delay_ms']){
    for(const value of [null,undefined,'6000',false,NaN,Infinity,[],{}])assert.throws(()=>mod.planCallbackSetup({...settings(),[key]:value},cfg),key);
  }
  for(const value of [null,undefined,1,['extend'],{mode:'extend'},'unreviewed'])assert.throws(()=>mod.planCallbackSetup({...settings(),data_mode:value},cfg));
  for(const value of [null,undefined,'all',{},[null],[1]])assert.throws(()=>mod.planCallbackSetup({...settings(),ignored_presences:value},cfg));
  for(const key of ['proxy','mobile_proxy','locale','mock_pairing_code']){
    for(const value of [null,undefined,false,1,[],{}])assert.throws(()=>mod.planCallbackSetup({...settings(),[key]:value},cfg),key);
  }
});

test('optional proxy and identity settings are preserved when present and are not invented when absent', () => {
  const mod = moduleUnderTest(), cfg = config(mod), current = settings();
  for (const key of ['proxy', 'mobile_proxy', 'locale', 'mock_pairing_code']) delete current[key];
  const plan = mod.planCallbackSetup(current, cfg);
  for (const key of ['proxy', 'mobile_proxy', 'locale', 'mock_pairing_code']) assert.equal(Object.hasOwn(plan.after, key), false);
});

test('documented optional proxy trust filter preserves both boolean values without enabling it by default', () => {
  const mod = moduleUnderTest(), cfg = config(mod);
  for (const enabled of [false, true]) {
    const current = { ...settings(), proxy_trust_filters: enabled }, before = clone(current);
    const plan = mod.planCallbackSetup(current, cfg);
    assert.deepEqual(current, before);
    assert.equal(plan.before.proxy_trust_filters, enabled);
    assert.equal(plan.after.proxy_trust_filters, enabled);
    assert.deepEqual(plan.after.webhooks[0], before.webhooks[0]);
  }
  const absent = mod.planCallbackSetup(settings(), cfg);
  assert.equal(Object.hasOwn(absent.before, 'proxy_trust_filters'), false);
  assert.equal(Object.hasOwn(absent.after, 'proxy_trust_filters'), false);
});

test('proxy trust compatibility rejects malformed values and still blocks all unknown settings', () => {
  const mod = moduleUnderTest(), cfg = config(mod);
  for (const value of [null, '', 'false', 'true', 0, 1, [], {}]) {
    assert.throws(() => mod.planCallbackSetup({ ...settings(), proxy_trust_filters: value }, cfg));
  }
  assert.throws(() => mod.planCallbackSetup({ ...settings(), proxy_trust_filters: false, unreviewed_new_setting: true }, cfg));
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
  const calls = [], rpcs = [], authCalls = [], outcomes = [], permissionReads = [];
  let current = clone(options.settings ?? settings()), consumed = false, reservation;
  const expiry = new Date(NOW + 10 * 60 * 1000).toISOString();
  const db = { from: table => {
    assert.equal(table,'user_module_permissions');
    const filters=[];const query={select:fields=>{assert.equal(fields,'access_level');return query;},
      eq:(field,value)=>{filters.push([field,value]);return query;},abortSignal:signal=>{assert.ok(signal instanceof AbortSignal);return query;},
      maybeSingle:async()=>{assert.deepEqual(filters,[['profile_id',ACTOR],['module_key','admin_setup']]);
        permissionReads.push(filters);return options.permission ?? {data:null,error:null};}};return query;
  }, rpc: (name, args) => ({ abortSignal: async signal => {
    assert.ok(signal instanceof AbortSignal); rpcs.push({ name, args });
    assert.equal(args.p_company, COMPANY); assert.equal(args.p_actor, ACTOR);
    if(name==='dekez_collection_assert_admin'){assert.equal(args.p_operation,undefined);return options.companyAuthorization ?? {data:null,error:null};}
    assert.equal(args.p_operation, OPERATION);
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
  return { mod, calls, rpcs, outcomes, authCalls, permissionReads, get current() { return current; },
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

test('sparse provider contract follows the same authorized single-use path without adding absent channel settings',async()=>{
  const current=productionShapeSettings(),before=clone(current),h=orchestration({settings:current});
  const preview=safeOutput(await h.mod.previewCallbackSetup());assert.equal(preview.state,'preview');
  const result=safeOutput(await h.mod.executeCallbackSetup(preview.ticket,true));
  assert.equal(result.state,'verified');assert.equal(claims(h).length,1);assert.equal(patches(h).length,1);
  assert.equal(h.consumed,true);assert.deepEqual(h.outcomes,['verified']);assert.equal(h.authCalls.length,3);
  const {webhooks:_beforeHooks,...beforeRest}=before,{webhooks:_afterHooks,...afterRest}=patches(h)[0].body;
  assert.deepEqual(afterRest,beforeRest);assert.deepEqual(h.current.webhooks[0],before.webhooks[0]);
  assert.equal(h.current.webhooks.length,2);assert.equal(Object.hasOwn(h.current,'outgoing_calls_enabled'),false);
  assert.equal(process.env.DEKEZ_COLLECTION_SEND_ENABLED,'false');assert.equal(process.env.DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED,'false');
  assert.equal((await h.mod.executeCallbackSetup(preview.ticket,true)).state,'unavailable');assert.equal(patches(h).length,1);
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
  const incomplete = settings(); delete incomplete.pdo_sync;
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
      executeCallbackSetup: invoke('execute'), inspectCallbackSetup: invoke('verify'),
      diagnoseCallbackSetup: async()=>{calls.push({name:'diagnose',args:[]});return {state:'blocked',stage:'settings_validation',code:'required_boolean',field:'pdo_sync'};} },
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
    for (const operation of ['preview', 'verify', 'execute', 'diagnose']) {
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

function renderControl(state, pending = false, controls = {setupEnabled:true, diagnosticsEnabled:false}) {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { CallbackSetupControl } = makeLoader({
    react: { ...React, useActionState: () => [state, () => {}, pending], useId: () => 'synthetic-confirmation' },
    './actions': { callbackSetupAction: async () => {} },
  })('app/admin-setup/rental-reminders/callback-setup/setup-control.tsx');
  return renderToStaticMarkup(React.createElement(CallbackSetupControl,controls));
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
      '@/lib/rental-collection/callback-setup': { setupConfig: () => enabled ? {} : null, callbackDiagnosticsEnabled:()=>false },
      './setup-control': { CallbackSetupControl: () => null },
    })('app/admin-setup/rental-reminders/callback-setup/page.tsx');
    await assert.rejects(page.default(), /NOT_FOUND/);
  }
});

function diagnosticHarness(options={}) {
  const h=orchestration(options);
  process.env.DEKEZ_COLLECTION_SETUP_ENABLED='false';
  process.env.DEKEZ_COLLECTION_DIAGNOSTICS_ENABLED='true';
  delete process.env.DEKEZ_COLLECTION_SETUP_OPERATION;
  return h;
}
function diagnosticCore(result) {
  const { settingsShape, ...core } = safeOutput(result);
  return core;
}
test('read-only diagnostic is disabled by default and requires fresh Super Admin before configuration disclosure',async()=>{
  const h=orchestration();
  assert.deepEqual(await h.mod.diagnoseCallbackSetup(),{state:'blocked',stage:'configuration',code:'diagnostics_disabled'});
  assert.equal(h.calls.length,0);assert.equal(h.rpcs.length,0);
  const denied=diagnosticHarness({admin:()=>null});
  assert.deepEqual(await denied.mod.diagnoseCallbackSetup(),{state:'blocked',stage:'authorization',code:'administrator_required'});
  assert.equal(denied.calls.length,0);assert.equal(denied.rpcs.length,0);
});
test('retired installer diagnosis uses GET only and existing read-only authorization, never setup grants or a permit',async()=>{
  const h=diagnosticHarness(),before=ENV_KEYS.map(key=>process.env[key]);
  assert.deepEqual(diagnosticCore(await h.mod.diagnoseCallbackSetup()),{state:'compatible',stage:'complete',code:'read_only_checks_passed',callbackPresent:false});
  assert.deepEqual(h.calls.map(call=>call.method),['GET','GET']);
  assert.deepEqual(h.rpcs.map(call=>call.name),['dekez_collection_assert_admin','dekez_collection_assert_admin']);
  assert.equal(h.permissionReads.length,2);assert.equal(h.consumed,false);assert.deepEqual(h.outcomes,[]);
  assert.deepEqual(ENV_KEYS.map(key=>process.env[key]),before);
});
test('diagnostic cannot enable setup or ignore disabled-send, deployment and company requirements',async()=>{
  for(const [changes,code] of [
    [{DEKEZ_COLLECTION_SETUP_ENABLED:'true'},'installer_not_disabled'],
    [{VERCEL_ENV:'preview'},'production_project'],[{VERCEL_PROJECT_ID:'other'},'production_project'],
    [{DEKEZ_REPORT_COMPANY_ID:OPERATION},'company_scope'],[{VERCEL_DEPLOYMENT_ID:''},'deployment_identity'],
    [{DEKEZ_COLLECTION_SEND_ENABLED:'true'},'sending_not_disabled'],
    [{DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED:'true'},'sending_not_disabled'],
    [{WHAPI_TOKEN:''},'provider_credential'],[{WHAPI_REPORT_WEBHOOK_SECRET:''},'report_credential'],
    [{CRON_SECRET:''},'cron_credential'],[{WHAPI_COLLECTION_WEBHOOK_SECRET:TOKEN},'dedicated_callback_credential'],
  ]){
    const h=diagnosticHarness();Object.assign(process.env,changes);
    assert.deepEqual(safeOutput(await h.mod.diagnoseCallbackSetup()),{state:'blocked',stage:'configuration',code});
    assert.equal(h.calls.length,0);assert.equal(h.rpcs.length,0);
  }
});
test('diagnostic fresh company and explicit module authorization failures cannot read provider settings',async()=>{
  for(const [options,code] of [[{companyAuthorization:{error:{message:TOKEN}}},'company_authorization'],
    [{permission:{data:{access_level:'view'},error:null}},'module_authorization'],
    [{permission:{data:null,error:{message:SECRET}}},'module_authorization']]){
    const h=diagnosticHarness(options);
    assert.deepEqual(safeOutput(await h.mod.diagnoseCallbackSetup()),{state:'blocked',stage:'authorization',code});
    assert.equal(h.calls.length,0);assert.equal(claims(h).length,0);
  }
});
test('diagnostic distinguishes health channel, session and sender validation without exposing actual identities',async()=>{
  const healthy={channel_id:'FALCON-D9NS9',status:{text:'AUTH'},user:{id:'60168173911'}};
  for(const [change,code] of [[{channel_id:SECRET},'channel_identity'],[{status:{text:'QR'}},'channel_not_authenticated'],
    [{user:{id:TOKEN}},'sender_identity']]){
    const h=diagnosticHarness({fetch:async()=>Response.json({...healthy,...change})});
    assert.deepEqual(safeOutput(await h.mod.diagnoseCallbackSetup()),{state:'blocked',stage:'health_validation',code});
    assert.equal(h.calls.length,1);assert.equal(patches(h).length,0);
  }
});
test('diagnostic identifies missing reset-prone defaults and required preservation snapshots',async()=>{
  for(const [field,code] of [['pdo_sync','required_boolean'],['offline_mode','required_boolean'],
    ['full_history','required_boolean'],['auto_read_messages','required_boolean'],
    ['media','required_object'],['webhooks','required_bounded_array']]){
    const current=settings();delete current[field];const h=diagnosticHarness({settings:current});
    assert.deepEqual(diagnosticCore(await h.mod.diagnoseCallbackSetup()),{state:'blocked',stage:'settings_validation',code,field});
    assert.equal(patches(h).length,0);assert.equal(claims(h).length,0);
  }
});

test('documented sparse settings pass read-only diagnosis while absent optional fields remain visibly absent',async()=>{
  const h=diagnosticHarness({settings:productionShapeSettings()}),result=safeOutput(await h.mod.diagnoseCallbackSetup());
  assert.equal(result.state,'compatible');assert.equal(result.code,'read_only_checks_passed');
  for(const field of ['outgoing_calls_enabled','callback_backoff_delay_ms','max_callback_backoff_delay_ms','ignored_presences','data_mode']){
    assert.deepEqual(result.settingsShape.fields.find(item=>item.field===field),{field,type:'absent'});
  }
  assert.equal(h.permissionReads.length,2);assert.equal(patches(h).length,0);assert.equal(claims(h).length,0);
});

test('diagnostic returns one fixed-name shape inventory without exposing setting or credential values',async()=>{
  const current=settings();
  current.proxy=`socks5://${TOKEN}:${SECRET}@private.example.invalid:1080`;
  current.locale='private-language-value';current.mock_pairing_code='private-pairing-value';
  current.proxy_trust_filters=true;
  const h=diagnosticHarness({settings:current}),result=safeOutput(await h.mod.diagnoseCallbackSetup());
  assert.equal(result.state,'compatible');
  assert.deepEqual(result.settingsShape.fields.map(item=>item.field),[
    'pdo_sync','callback_persist','offline_mode','full_history','auto_read_messages','outgoing_calls_enabled',
    'callback_backoff_delay_ms','max_callback_backoff_delay_ms','media','media.auto_download','media.init_avatars','webhooks',
    'proxy','proxy_trust_filters','mobile_proxy','locale','mock_pairing_code','ignored_presences','data_mode',
  ]);
  assert.equal(result.settingsShape.rootType,'object');
  assert.equal(result.settingsShape.unknownFieldsPresent,false);assert.equal(result.settingsShape.unknownMediaFieldsPresent,false);
  const shape=Object.fromEntries(result.settingsShape.fields.map(item=>[item.field,item]));
  assert.deepEqual(shape.callback_backoff_delay_ms,{field:'callback_backoff_delay_ms',type:'number',finite:true,inRange:true});
  assert.equal(shape.webhooks.type,'array');assert.equal(shape['media.init_avatars'].type,'boolean');
  assert.equal(shape.proxy_trust_filters.type,'boolean');
  for(const item of result.settingsShape.fields){
    assert.ok(['absent','null','boolean','string','number','array','object','invalid'].includes(item.type));
    assert.ok(Object.keys(item).every(key=>['field','type','finite','inRange'].includes(key)));
  }
  const serialized=JSON.stringify(result);
  for(const value of ['private.example.invalid','private-language-value','private-pairing-value',REPORT_CALLBACK,CALLBACK,'Authorization','6000','1200000']){
    assert.equal(serialized.includes(value),false);
  }
  assert.deepEqual(h.calls.map(call=>call.method),['GET','GET']);assert.equal(h.permissionReads.length,2);
  assert.equal(patches(h).length,0);assert.equal(claims(h).length,0);
});

test('diagnostic distinguishes absent, null and wrong types across all settings without loosening validation',async()=>{
  const current=settings();delete current.outgoing_calls_enabled;delete current.proxy;
  current.callback_persist='false';current.full_history=null;current.media.init_avatars=0;
  current.callback_backoff_delay_ms=2999;current.max_callback_backoff_delay_ms='1200000';
  current.ignored_presences={};current.webhooks=null;
  const h=diagnosticHarness({settings:current}),result=safeOutput(await h.mod.diagnoseCallbackSetup());
  assert.equal(result.state,'blocked');assert.equal(result.stage,'settings_validation');
  const shape=Object.fromEntries(result.settingsShape.fields.map(item=>[item.field,item]));
  assert.equal(shape.outgoing_calls_enabled.type,'absent');assert.equal(shape.proxy.type,'absent');
  assert.equal(shape.callback_persist.type,'string');assert.equal(shape.full_history.type,'null');
  assert.equal(shape['media.init_avatars'].type,'number');assert.equal(shape.ignored_presences.type,'object');
  assert.equal(shape.webhooks.type,'null');
  assert.deepEqual(shape.callback_backoff_delay_ms,{field:'callback_backoff_delay_ms',type:'number',finite:true,inRange:false});
  assert.deepEqual(shape.max_callback_backoff_delay_ms,{field:'max_callback_backoff_delay_ms',type:'string',finite:false,inRange:false});
  assert.equal(patches(h).length,0);assert.equal(claims(h).length,0);assert.equal(h.permissionReads.length,2);
});

test('diagnostic numeric metadata rejects non-finite provider numbers without reflecting their representation',async()=>{
  const h=diagnosticHarness({fetch:async url=>url.endsWith('/settings')
    ?new Response(JSON.stringify(settings()).replace('"callback_backoff_delay_ms":6000','"callback_backoff_delay_ms":1e999')):undefined});
  const result=safeOutput(await h.mod.diagnoseCallbackSetup());
  assert.equal(result.code,'optional_bounded_number');
  assert.deepEqual(result.settingsShape.fields.find(item=>item.field==='callback_backoff_delay_ms'),
    {field:'callback_backoff_delay_ms',type:'number',finite:false,inRange:false});
  assert.equal(JSON.stringify(result).includes('1e999'),false);assert.equal(patches(h).length,0);
});

test('diagnostic reports unknown-key presence only and never enumerates provider-controlled names',async()=>{
  const current=settings();current[SECRET]=TOKEN;current.media[TOKEN]=SECRET;
  current['media.auto_download']='provider-root-alias';
  const h=diagnosticHarness({settings:current}),result=safeOutput(await h.mod.diagnoseCallbackSetup());
  assert.equal(result.code,'unknown_setting');assert.equal(result.settingsShape.unknownFieldsPresent,true);
  assert.equal(result.settingsShape.unknownMediaFieldsPresent,true);
  assert.equal(result.settingsShape.fields.length,19);
  assert.equal(JSON.stringify(result).includes('provider-root-alias'),false);
  assert.equal(patches(h).length,0);assert.equal(claims(h).length,0);
});

test('diagnostic metadata is withheld after identity, company or module revocation even on validation failure',async()=>{
  for(const revoked of ['identity','company','module']){
    const current=settings();delete current.pdo_sync;
    const companyAuthorization={data:null,error:null},permission={data:null,error:null};
    const h=diagnosticHarness({settings:current,companyAuthorization,permission,
      admin:call=>revoked==='identity'&&call>1?null:ACTOR,
      fetch:async url=>{if(url.endsWith('/settings')){
        if(revoked==='company')companyAuthorization.error={message:TOKEN};
        if(revoked==='module')permission.data={access_level:'view'};
      }},
    });
    const result=safeOutput(await h.mod.diagnoseCallbackSetup());
    assert.deepEqual(result,{state:'blocked',stage:'authorization',code:
      revoked==='identity'?'administrator_required':revoked==='company'?'company_authorization':'module_authorization'});
    assert.equal(Object.hasOwn(result,'settingsShape'),false);assert.equal(patches(h).length,0);assert.equal(claims(h).length,0);
  }
});
test('diagnostic never reflects unknown keys, masked values, arbitrary URLs or header content',async()=>{
  for(const [mutate,code] of [
    [s=>{s[SECRET]=TOKEN;},'unknown_setting'],
    [s=>{s.proxy='********';},'optional_string_unavailable'],
    [s=>{s.webhooks[0].url='https://'+SECRET+'.invalid/?credential='+TOKEN;},'webhook_url'],
    [s=>{s.webhooks[0].headers.Authorization='Bearer ********';},'webhook_headers'],
  ]){
    const current=settings();mutate(current);const h=diagnosticHarness({settings:current});
    const result=safeOutput(await h.mod.diagnoseCallbackSetup());assert.equal(result.stage,'settings_validation');assert.equal(result.code,code);
    assert.equal(patches(h).length,0);
  }
});
test('diagnostic distinguishes existing report callback authentication from schema validation',async()=>{
  for(const [mutate,code] of [
    [s=>{s.webhooks=[];},'report_callback_count'],[s=>{s.webhooks[0].mode='path';},'report_callback_mode'],
    [s=>{s.webhooks[0].headers.Authorization='Bearer wrong';},'report_callback_authentication'],
    [s=>{s.webhooks[0].events=[];},'report_callback_events'],
  ]){
    const current=settings();mutate(current);const h=diagnosticHarness({settings:current});
    assert.deepEqual(diagnosticCore(await h.mod.diagnoseCallbackSetup()),{state:'blocked',stage:'callback_preservation',code});
    assert.equal(patches(h).length,0);
  }
});
test('diagnostic describes installed/conflicting callback without repairing it or consuming authorization',async()=>{
  const mod=moduleUnderTest(),installed=mod.planCallbackSetup(settings(),config(mod)).after;
  const ready=diagnosticHarness({settings:installed});
  assert.equal(safeOutput(await ready.mod.diagnoseCallbackSetup()).callbackPresent,true);assert.equal(patches(ready).length,0);
  installed.webhooks[1].headers.Authorization='Bearer wrong';
  const h=diagnosticHarness({settings:installed});
  assert.deepEqual(diagnosticCore(await h.mod.diagnoseCallbackSetup()),{state:'blocked',stage:'callback_preservation',code:'rental_callback_conflict'});
  assert.equal(h.consumed,false);assert.equal(patches(h).length,0);
});
test('diagnostic reports safe HTTP, JSON and transport failure categories, never response body or error text',async()=>{
  for(const [response,expected] of [
    [()=>new Response(TOKEN+SECRET,{status:401}),{code:'provider_http',httpStatus:401}],
    [()=>new Response(TOKEN+SECRET),{code:'provider_json'}],
    [()=>{throw Error(TOKEN+SECRET);},{code:'request_failed'}],
  ]){
    const h=diagnosticHarness({fetch:async()=>response()});
    assert.deepEqual(safeOutput(await h.mod.diagnoseCallbackSetup()),{state:'blocked',stage:'health_request',...expected});
    assert.equal(patches(h).length,0);
  }
});
test('diagnostic rechecks administrator after provider reads and never reports success after revocation',async()=>{
  const h=diagnosticHarness({admin:call=>call===1?ACTOR:null});
  assert.deepEqual(safeOutput(await h.mod.diagnoseCallbackSetup()),{state:'blocked',stage:'authorization',code:'administrator_required'});
  assert.equal(patches(h).length,0);assert.equal(h.consumed,false);
});

test('same-origin diagnostic action ignores form credentials/permit data and calls only the read-only export',async()=>{
  const h=actionHarness({origin:'https://dekez.vercel.app','sec-fetch-site':'same-origin'});
  const result=safeOutput(await h.callbackSetupAction(PREVIOUS,form('diagnose',{ticket:TOKEN,confirmed:'yes',recipient:SECRET})));
  assert.equal(result.state,'diagnostic');assert.match(result.message,/settings_validation \/ required_boolean/);
  assert.match(result.message,/Field: pdo_sync/);assert.match(result.message,/No settings, messages or setup permits were changed/);
  assert.deepEqual(h.calls,[{name:'diagnose',args:[]}]);
});
test('diagnostic action cannot bypass fresh Admin authorization even from the canonical page',async()=>{
  const h=diagnosticHarness({admin:()=>null});
  const action=makeLoader({
    'next/headers':{headers:async()=>new Headers({origin:'https://dekez.vercel.app','sec-fetch-site':'same-origin'})},
    '@/lib/rental-collection/callback-setup':h.mod,
  })('app/admin-setup/rental-reminders/callback-setup/actions.ts');
  const result=safeOutput(await action.callbackSetupAction(PREVIOUS,form('diagnose')));
  assert.match(result.message,/administrator_required/);assert.equal(h.rpcs.length,0);assert.equal(h.calls.length,0);
});

test('same-origin diagnostic action displays bounded fixed-name types and ranges, never raw settings',async()=>{
  const current=settings();delete current.outgoing_calls_enabled;current.proxy=TOKEN;current[SECRET]=REPORT_SECRET;
  const h=diagnosticHarness({settings:current});
  const action=makeLoader({
    'next/headers':{headers:async()=>new Headers({origin:'https://dekez.vercel.app','sec-fetch-site':'same-origin'})},
    '@/lib/rental-collection/callback-setup':h.mod,
  })('app/admin-setup/rental-reminders/callback-setup/actions.ts');
  const result=safeOutput(await action.callbackSetupAction(PREVIOUS,form('diagnose')));
  assert.match(result.message,/Settings shape \(types only\): root=object/);
  assert.match(result.message,/outgoing_calls_enabled=absent/);assert.match(result.message,/proxy=string/);
  assert.match(result.message,/callback_backoff_delay_ms=number \(finite=true, in-range=true\)/);
  assert.match(result.message,/unknown-root-fields=true/);
  assert.doesNotMatch(result.message,/Authorization|socks5|6000|1200000/);
  assert.ok(result.message.length<2500);assert.equal(patches(h).length,0);assert.equal(claims(h).length,0);
});
test('read-only diagnostic UI never exposes setup/inspection/execution or credential controls, including stale preview state',()=>{
  for(const state of [PREVIOUS,{state:'preview',message:'stale',ticket:'synthetic-old-ticket'}]){
    const html=renderControl(state,false,{setupEnabled:false,diagnosticsEnabled:true});
    assert.match(html,/Run read-only callback checks/);assert.match(html,/value="diagnose"/);
    assert.doesNotMatch(html,/value="preview"|value="verify"|value="execute"|name="ticket"|name="confirmed"|type="password"/);
    assert.match(html,/installer stays disabled/);assert.match(html,/separate approval/);safeOutput(html);
  }
  assert.match(renderControl(PREVIOUS,true,{setupEnabled:false,diagnosticsEnabled:true}),/button disabled=""/);
});
test('existing Admin page exposes diagnostic-only view only with fresh Super Admin and separate diagnostic flag',async()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  for(const [actor,diagnostic] of [[null,true],[ACTOR,false],[ACTOR,true]]){
    const page=makeLoader({
      'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},
      '@/lib/management-report/authorization':{reportAdministrator:async()=>actor},
      '@/lib/rental-collection/callback-setup':{setupConfig:()=>null,callbackDiagnosticsEnabled:()=>diagnostic},
      './setup-control':{CallbackSetupControl:props=>React.createElement('div',{'data-setup':props.setupEnabled,'data-diagnostic':props.diagnosticsEnabled})},
    })('app/admin-setup/rental-reminders/callback-setup/page.tsx');
    if(!actor||!diagnostic){await assert.rejects(page.default(),/NOT_FOUND/);continue;}
    const html=renderToStaticMarkup(await page.default());
    assert.match(html,/Rental callback diagnostics/);assert.match(html,/Read-only checks/);
    assert.match(html,/data-setup="false"/);assert.match(html,/data-diagnostic="true"/);
  }
});
test('diagnostic page availability never re-enables an active installer or defaults to enabled',()=>{
  const h=orchestration();assert.equal(h.mod.callbackDiagnosticsEnabled(),false);
  process.env.DEKEZ_COLLECTION_DIAGNOSTICS_ENABLED='true';assert.equal(h.mod.callbackDiagnosticsEnabled(),false);
  process.env.DEKEZ_COLLECTION_SETUP_ENABLED='false';assert.equal(h.mod.callbackDiagnosticsEnabled(),true);
  delete process.env.DEKEZ_COLLECTION_DIAGNOSTICS_ENABLED;assert.equal(h.mod.callbackDiagnosticsEnabled(),false);
});

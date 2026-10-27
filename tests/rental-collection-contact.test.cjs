// Synthetic provider envelopes only. No real Supabase client, provider token or network.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const makeLoader = require('./marketplace-component-loader.cjs');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const SECRET = 'synthetic_collection_callback_secret_123456789';
const PHONE = '60191111111';
const NOW = new Date('2026-10-27T01:00:00.000Z');
const SECONDS = NOW.getTime() / 1000;
const { collectionEvents, contactCommand } = makeLoader()('lib/rental-collection/contact-events.ts');
const envKeys = ['WHAPI_COLLECTION_WEBHOOK_SECRET', 'WHAPI_REPORT_WEBHOOK_SECRET', 'DEKEZ_COLLECTION_INTAKE_ENABLED', 'DEKEZ_REPORT_COMPANY_ID', 'DEKEZ_COLLECTION_POLICY_ENABLED', 'DEKEZ_COLLECTION_SEND_ENABLED'];
let priorEnv, priorFetch, fetches;
beforeEach(() => {
  priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  priorFetch = global.fetch; fetches = 0;
  global.fetch = async () => { fetches++; throw new Error('Network forbidden in callback tests'); };
});
afterEach(() => {
  for (const key of envKeys) {
    if (priorEnv[key] === undefined) delete process.env[key]; else process.env[key] = priorEnv[key];
  }
  global.fetch = priorFetch;
  assert.equal(fetches, 0, 'Incoming callback must never send or fetch provider data');
});

const message = (change = {}) => ({ id: 'synthetic-stop-1', from_me: false, type: 'text', from: PHONE,
  chat_id: `${PHONE}@s.whatsapp.net`, timestamp: SECONDS, text: { body: 'STOP' }, ...change });
const messages = (...items) => ({ channel_id: 'FALCON-D9NS9', event: { type: 'messages', event: 'post' }, messages: items.length ? items : [message()] });
const status = (change = {}) => ({ id: 'synthetic-provider-message-1', status: 'delivered', code: 3,
  recipient_id: `${PHONE}@s.whatsapp.net`, timestamp: String(SECONDS), ...change });
const statuses = (...items) => ({ channel_id: 'FALCON-D9NS9', event: { type: 'statuses', event: 'post' }, statuses: items.length ? items : [status()] });
const parse = payload => collectionEvents(payload, NOW);
function readyEnv() {
  process.env.WHAPI_COLLECTION_WEBHOOK_SECRET = SECRET;
  process.env.DEKEZ_COLLECTION_INTAKE_ENABLED = 'true';
  process.env.DEKEZ_REPORT_COMPANY_ID = COMPANY;
}
function serviceHarness(rpcResult = { error: null }) {
  const calls = [];
  const service = makeLoader({ 'server-only': {}, '@/lib/supabase/admin': {
    createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return typeof rpcResult === 'function' ? rpcResult(name, args) : rpcResult; } }),
  } })('lib/rental-collection/contact-service.ts');
  return { service, calls };
}
function routeHarness({ ready = true, record } = {}) {
  const events = [];
  const route = makeLoader({ '@/lib/rental-collection/contact-service': {
    collectionIntakeConfig: () => ({ companyId: COMPANY, secret: SECRET, ready }),
    recordCollectionEvent: async event => { events.push(event); if (record) await record(event); },
  } })('app/api/webhooks/whapi-rental-reminders/route.ts');
  return { ...route, events };
}
function request(body = messages(), headers = {}) {
  return new Request('https://example.invalid/api/webhooks/whapi-rental-reminders', { method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
}
async function expectReply(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(await response.text(), expectedStatus === 200 ? 'OK' : 'Request rejected');
}

test('English and Bahasa opt-out commands are exact and normalized, not arbitrary message intent', () => {
  for (const text of ['STOP', '  please   stop! ', 'unsubscribe', 'opt out', 'stop messages', 'please stop messaging me', 'BERHENTI.', 'hentikan', 'jangan hantar mesej', 'jangan mesej saya']) assert.equal(contactCommand(text), 'stop', text);
  for (const text of ['start', 'SUBSCRIBE!', ' mula ']) assert.equal(contactCommand(text), 'start', text);
  for (const text of [null, {}, 1, '', 'please start', 'do not stop', 'STOP for 60190000000', 'SQL: update consent', 'x'.repeat(201)]) assert.equal(contactCommand(text), null);
});

test('STOP identity comes exclusively from direct sender metadata; quoted names and body do not set identity', () => {
  const event = parse(messages(message({ from_name: 'Admin', quoted: { from: '60190000000' }, company_id: 'spoofed' })))[0];
  assert.equal(event.recipient, PHONE);
  assert.equal(event.id, 'message:synthetic-stop-1');
  assert.equal(event.kind, 'stop');
  assert.equal(Object.hasOwn(event, 'company_id'), false);
  assert.deepEqual(parse(messages(message({ text: { body: `STOP ${PHONE}` } }))), []);
});

test('groups, LID peers, sender/chat mismatch, outgoing echoes and non-text inputs are ignored', () => {
  for (const change of [
    { chat_id: '120363194020948049@g.us' }, { chat_id: `${PHONE}@lid` },
    { chat_id: '60192222222@s.whatsapp.net' }, { from: `${PHONE}@s.whatsapp.net` },
    { from: '+60191111111' }, { from: '0191111111' }, { from: 60191111111 },
    { from_me: true }, { from_me: undefined }, { type: 'image' }, { text: 'STOP' },
    { id: '../private' }, { id: '' }, { id: 'a'.repeat(201) },
  ]) assert.deepEqual(parse(messages(message(change))), [], JSON.stringify(change));
});

test('only the configured channel and POST message/status envelopes are parsed', () => {
  for (const payload of [null, [], {}, { ...messages(), channel_id: 'OTHER' },
    { ...messages(), event: { type: 'messages', event: 'put' } },
    { ...messages(), event: { type: 'calls', event: 'post' } },
    { ...messages(), event: 'messages.post' }, { ...messages(), messages: {} },
    { ...statuses(), event: { type: 'statuses', event: 'put' } }]) assert.deepEqual(parse(payload), []);
});

test('timestamp checks accept documented integer/string seconds and delayed STOP, but reject future or malformed time', () => {
  for (const timestamp of [SECONDS, String(SECONDS), 946684800, SECONDS + 60]) assert.equal(parse(messages(message({ timestamp }))).length, 1);
  for (const timestamp of [SECONDS + 61, SECONDS * 1000, 1, -1, 1.5, '2026-10-27', null, '9999999999999999999']) assert.deepEqual(parse(messages(message({ timestamp }))), []);
});

test('a batch is bounded at 50 events and duplicate message IDs are collapsed', () => {
  assert.equal(parse(messages(...Array.from({ length: 50 }, (_, index) => message({ id: `message-${index}` })))).length, 50);
  assert.deepEqual(parse(messages(...Array.from({ length: 51 }, (_, index) => message({ id: `message-${index}` })))), []);
  assert.equal(parse(messages(message(), message())).length, 1);
  assert.equal(parse(messages(null, message({ from_me: true }), message())).length, 1);
});

test('receipt codes preserve pending/accepted versus actual delivery and read evidence', () => {
  const expected = [['failed', 0, 'failed'], ['pending', 1, 'unknown'], ['sent', 2, 'sent'], ['delivered', 3, 'delivered'], ['read', 4, 'read']];
  for (const [providerStatus, code, result] of expected) {
    const event = parse(statuses(status({ status: providerStatus, code })))[0];
    assert.equal(event.status, result);
    assert.equal(event.recipient, PHONE);
    assert.equal(event.messageId, 'synthetic-provider-message-1');
    assert.match(event.id, /^[a-f0-9]{64}$/);
  }
});

test('mismatched, coerced or unsupported receipt codes and unknown peer formats cannot confirm delivery', () => {
  for (const change of [{ code: 2 }, { code: '3' }, { code: null }, { status: 'failed', code: 3 },
    { status: 'played', code: 5 }, { status: 'deleted', code: 6 }, { status: 'constructor', code: 0 },
    { recipient_id: '120363194020948049@g.us' }, { recipient_id: `${PHONE}@lid` },
    { recipient_id: PHONE }, { id: '../wrong-id' }, { id: '' }, { timestamp: SECONDS + 61 }]) assert.deepEqual(parse(statuses(status(change))), [], JSON.stringify(change));
});

test('receipt retry keys are deterministic, while message/recipient/status/time differences stay independent', () => {
  const baseline = parse(statuses())[0];
  assert.deepEqual(parse(statuses(status(), status())), [baseline]);
  for (const change of [{ id: 'another-provider-message' }, { recipient_id: '60192222222@s.whatsapp.net' }, { status: 'read', code: 4 }, { timestamp: String(SECONDS - 1) }]) assert.notEqual(parse(statuses(status(change)))[0].id, baseline.id);
  assert.equal(parse(statuses(...Array.from({ length: 50 }, (_, index) => status({ id: `receipt-${index}` })))).length, 50);
  assert.deepEqual(parse(statuses(...Array.from({ length: 51 }, (_, index) => status({ id: `receipt-${index}` })))), []);
});

test('callback configuration fails closed unless company, dedicated secret and explicit intake flag are valid', () => {
  const { service, calls } = serviceHarness();
  assert.equal(service.collectionIntakeConfig().ready, false);
  readyEnv(); assert.equal(service.collectionIntakeConfig().ready, true);
  for (const [key, values] of [
    ['DEKEZ_COLLECTION_INTAKE_ENABLED', ['false', '', 'TRUE', '1']],
    ['DEKEZ_REPORT_COMPANY_ID', ['', 'not-a-company']],
    ['WHAPI_COLLECTION_WEBHOOK_SECRET', ['', 'short', 'a'.repeat(257), 'x'.repeat(32) + '!', 'contains a space' + 'x'.repeat(32)]],
  ]) {
    const original = process.env[key];
    for (const value of values) { process.env[key] = value; assert.equal(service.collectionIntakeConfig().ready, false, key); }
    process.env[key] = original;
  }
  assert.equal(calls.length, 0);
});

test('disabled intake cannot call a database RPC', async () => {
  const { service, calls } = serviceHarness();
  await assert.rejects(service.recordCollectionEvent(parse(messages())[0]), /^Error: Payment reminder intake is unavailable\.$/);
  assert.equal(calls.length, 0);
});

test('dedicated intake secret is mandatory; STOP remains receivable while outbound policy switches are off', () => {
  const { service } = serviceHarness();
  readyEnv();
  delete process.env.WHAPI_COLLECTION_WEBHOOK_SECRET;
  process.env.WHAPI_REPORT_WEBHOOK_SECRET = SECRET;
  assert.equal(service.collectionIntakeConfig().ready, false);
  process.env.WHAPI_COLLECTION_WEBHOOK_SECRET = SECRET;
  process.env.DEKEZ_COLLECTION_POLICY_ENABLED = 'false';
  process.env.DEKEZ_COLLECTION_SEND_ENABLED = 'false';
  assert.equal(service.collectionIntakeConfig().ready, true);
});

test('STOP and START use only the scoped contact RPC; START is a request, never automatic opt-in', async () => {
  readyEnv(); const { service, calls } = serviceHarness();
  for (const body of ['STOP', 'START']) await service.recordCollectionEvent(parse(messages(message({ text: { body } })))[0]);
  assert.equal(calls.length, 2);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.name, 'dekez_collection_ingest_contact_event');
    assert.deepEqual(Object.keys(call.args).sort(), ['p_company', 'p_channel', 'p_event_id', 'p_provider_message_id', 'p_recipient', 'p_occurred_at', 'p_kind'].sort());
    assert.equal(call.args.p_company, COMPANY);
    assert.equal(call.args.p_channel, 'FALCON-D9NS9');
    assert.equal(call.args.p_recipient, PHONE);
    assert.equal(call.args.p_kind, index ? 'start' : 'stop');
    assert.equal(Object.hasOwn(call.args, 'consent'), false);
  }
});

test('receipt RPC preserves exact provider message and recipient correlation instead of guessing identity', async () => {
  readyEnv(); const { service, calls } = serviceHarness();
  await service.recordCollectionEvent(parse(statuses(status({ id: 'different-provider-message', recipient_id: '60193333333@s.whatsapp.net' })))[0]);
  assert.deepEqual(calls[0], { name: 'dekez_collection_ingest_receipt', args: {
    p_company: COMPANY, p_channel: 'FALCON-D9NS9', p_event_id: parse(statuses(status({ id: 'different-provider-message', recipient_id: '60193333333@s.whatsapp.net' })))[0].id,
    p_provider_message_id: 'different-provider-message', p_recipient: '60193333333', p_occurred_at: NOW.toISOString(), p_status: 'delivered',
  } });
});

test('database details and sensitive diagnostics are hidden by the service', async () => {
  readyEnv(); const { service } = serviceHarness({ error: { message: `SQL secret ${SECRET} tenant ${PHONE}`, details: 'private record' } });
  await assert.rejects(service.recordCollectionEvent(parse(messages())[0]), /^Error: Payment reminder event could not be recorded\.$/);
});

test('disabled callback returns 503 before body or authorization processing', async () => {
  const route = routeHarness({ ready: false });
  await expectReply(await route.POST({ get headers() { throw new Error('Must not inspect request'); }, get body() { throw new Error('Must not read payload'); } }), 503);
  assert.equal(route.events.length, 0);
});

test('missing, wrong and incorrectly formatted dedicated authentication are rejected before body access', async () => {
  for (const authorization of ['', `Bearer ${'x'.repeat(SECRET.length)}`, `bearer ${SECRET}`, SECRET, `Bearer ${SECRET}extra`]) {
    const route = routeHarness();
    await expectReply(await route.POST({ headers: new Headers({ authorization }), get body() { throw new Error('Unauthenticated body read'); } }), 401);
    assert.equal(route.events.length, 0);
  }
});

test('unsupported content types and compressed request bodies are rejected', async () => {
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': '' }, { 'content-encoding': 'gzip' }, { 'content-encoding': 'identity' }]) {
    const route = routeHarness(); await expectReply(await route.POST(request(messages(), headers)), 415);
    assert.equal(route.events.length, 0);
  }
  const route = routeHarness();
  await expectReply(await route.POST(request(messages(), { 'content-type': 'Application/JSON; charset=utf-8' })), 200);
  assert.equal(route.events.length, 1);
});

test('declared oversized or absent request body is rejected without reading it', async () => {
  const route = routeHarness();
  await expectReply(await route.POST({ headers: new Headers({ authorization: `Bearer ${SECRET}`, 'content-type': 'application/json', 'content-length': '65537' }), body: { getReader() { throw new Error('Oversized body must not be read'); } } }), 413);
  await expectReply(await route.POST(new Request('https://example.invalid', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' } })), 413);
  assert.equal(route.events.length, 0);
});

test('actual streamed byte limit cannot be bypassed by an absent or false Content-Length', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    const route = routeHarness();
    await expectReply(await route.POST(request(' '.repeat(65537), headers)), 413);
    assert.equal(route.events.length, 0);
  }
  const route = routeHarness();
  await expectReply(await route.POST(request('{}' + ' '.repeat(65534))), 200);
});

test('malformed JSON and stream failures never reach the database', async () => {
  const route = routeHarness();
  for (const body of ['', '{', 'null trailing']) await expectReply(await route.POST(request(body)), 400);
  await expectReply(await route.POST({ headers: new Headers({ authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }), body: {
    getReader: () => ({ read: async () => { throw new Error(`private ${PHONE}`); }, releaseLock() {} }),
  } }), 400);
  assert.equal(route.events.length, 0);
});

test('valid callback processes STOP and START without sending any response message', async () => {
  const route = routeHarness();
  await expectReply(await route.POST(request(messages(message(), message({ id: 'synthetic-start-2', text: { body: 'START' } })))), 200);
  assert.deepEqual(route.events.map(event => event.kind), ['stop', 'start']);
  assert.equal(Object.hasOwn(route, 'GET'), false);
});

test('authenticated callback traverses real parser and service to the scoped RPC without outbound access', async () => {
  readyEnv(); const calls = [];
  const route = makeLoader({ 'server-only': {}, '@/lib/supabase/admin': {
    createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } }),
  } })('app/api/webhooks/whapi-rental-reminders/route.ts');
  await expectReply(await route.POST(request({ ...messages(message({ text: { body: 'START' } })), company_id: 'untrusted-payload-company' })), 200);
  await expectReply(await route.POST(request(statuses(status({ status: 'pending', code: 1 })))), 200);
  assert.equal(calls[0].name, 'dekez_collection_ingest_contact_event');
  assert.equal(calls[0].args.p_kind, 'start');
  assert.equal(calls[0].args.p_company, COMPANY);
  assert.equal(Object.hasOwn(calls[0].args, 'consent'), false);
  assert.equal(calls[1].name, 'dekez_collection_ingest_receipt');
  assert.equal(calls[1].args.p_status, 'unknown');
  assert.equal(calls[1].args.p_company, COMPANY);
});

test('irrelevant, wrong-channel and loop envelopes are safely acknowledged without database access', async () => {
  for (const payload of [{ ...messages(), channel_id: 'OTHER' }, messages(message({ from_me: true })), messages(message({ chat_id: '1234567890@g.us' })), { arbitrary: 'data' }]) {
    const route = routeHarness(); await expectReply(await route.POST(request(payload)), 200); assert.equal(route.events.length, 0);
  }
});

test('oversized event batches are rejected, never acknowledged as successfully recorded', async () => {
  for (const payload of [messages(...Array.from({ length: 51 }, (_, index) => message({ id: `m-${index}` }))), statuses(...Array.from({ length: 51 }, (_, index) => status({ id: `s-${index}` })))]) {
    const route = routeHarness(); await expectReply(await route.POST(request(payload)), 413); assert.equal(route.events.length, 0);
  }
});

test('database rejection of unmatched receipt IDs is opaque and must not update an unrelated recipient', async () => {
  const logs = [], originalError = console.error;
  console.error = (...parts) => logs.push(parts.join(' '));
  try {
    const route = routeHarness({ record: async event => { assert.equal(event.messageId, 'unmatched-provider-message'); throw new Error(`private SQL ${SECRET} ${PHONE}`); } });
    await expectReply(await route.POST(request(statuses(status({ id: 'unmatched-provider-message' })))), 503);
    assert.deepEqual(logs, ['DEKEZ payment reminder intake unavailable']);
    assert.equal(route.events.length, 1);
  } finally { console.error = originalError; }
});

test('retrying an authenticated callback produces the same deduplication keys, not random new events', async () => {
  const route = routeHarness();
  await expectReply(await route.POST(request(statuses())), 200);
  await expectReply(await route.POST(request(statuses())), 200);
  assert.equal(route.events.length, 2);
  assert.deepEqual(route.events[0], route.events[1]);
  // Database atomic/idempotency behavior is tested separately with PostgreSQL,
  // not claimed by this mocked callback test.
});

test('callback source contains no outbound provider calls, token access or account mutations', () => {
  const root = path.resolve(__dirname, '..');
  const source = ['lib/rental-collection/contact-events.ts', 'lib/rental-collection/contact-service.ts', 'app/api/webhooks/whapi-rental-reminders/route.ts']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /WHAPI_TOKEN|gate\.whapi\.cloud|fetch\(|sendWhapi|\.from\(["']|\.insert\(|\.delete\(/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /dekez_collection_ingest_contact_event/);
  assert.match(source, /dekez_collection_ingest_receipt/);
});

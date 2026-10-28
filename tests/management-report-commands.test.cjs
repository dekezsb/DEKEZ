// Synthetic-only tests: real command services + disposable PostgreSQL/PGlite.
// Every HTTP request is replaced below. No provider token or live database is used.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const loader = require('./marketplace-component-loader.cjs');
const model = loader({})('lib/management-report/commands/model.ts');
const config = loader({ 'server-only': {} })('lib/management-report/commands/config.ts');
const keys = ['WHAPI_TOKEN', 'WHAPI_REPORT_TO', 'DEKEZ_REPORT_COMPANY_ID', 'DEKEZ_REPORT_SEND_ENABLED',
 'DEKEZ_REPORT_TEST_ENABLED', 'DEKEZ_REPORT_SCHEDULE_ENABLED', 'DEKEZ_REPORT_COMMANDS_ENABLED', 'WHAPI_REPORT_WEBHOOK_SECRET'];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalFetch = global.fetch, originalError = console.error;
const secret = 'synthetic_webhook_secret_for_fixture_only';
const fixedNow = new Date('2026-10-31T16:00:00.000Z');
let db, id, calls, rpcCalls, response, rpcFault, logs;

function envelope(message = {}, payload = {}, now = fixedNow) {
 return { channel_id: model.REPORT_CHANNEL, event: { type: 'messages', event: 'post' }, messages: [{
  id: 'incoming-fixture-1', from_me: false, type: 'text', from: '60198894911', chat_id: model.REPORT_CHAT,
  timestamp: Math.floor(now.getTime() / 1000), text: { body: "Send me today's due and overdue" }, ...message,
 }], ...payload };
}
function configure() {
 Object.assign(process.env, { WHAPI_TOKEN: 'synthetic-provider-token', WHAPI_REPORT_TO: '60198894911',
  DEKEZ_REPORT_COMPANY_ID: id(1), DEKEZ_REPORT_SEND_ENABLED: 'true', DEKEZ_REPORT_TEST_ENABLED: 'false',
  DEKEZ_REPORT_SCHEDULE_ENABLED: 'true', DEKEZ_REPORT_COMMANDS_ENABLED: 'true', WHAPI_REPORT_WEBHOOK_SECRET: secret });
}
const client = { rpc: async (name, args) => {
 rpcCalls.push(name);
 if (rpcFault) { const fault = await rpcFault(name, args); if (fault) return fault; }
 try {
  const values = Object.values(args), params = values.map((_, index) => '$' + (index + 1)).join(',');
  return { data: (await db.rpcQuery(`select public.${name}(${params}) result`, values)).rows[0].result, error: null };
 } catch (error) { return { data: null, error }; }
} };
const service = loader({ 'server-only': {}, '@/lib/supabase/admin': { createAdminClient: () => client } })('lib/management-report/commands/service.ts');
async function input(command = 'due_overdue', messageId = 'service-fixture-1') {
 const now = new Date((await db.query('select clock_timestamp() now')).rows[0].now);
 return { now, message: { id: messageId, sender: '60198894911', chat: model.REPORT_CHAT,
  channel: model.REPORT_CHANNEL, command, receivedAt: now.toISOString() } };
}
function routeWith(execute) {
 return loader({ 'server-only': {}, '@/lib/management-report/commands/service': { executeReportCommand: execute } })('app/api/webhooks/whapi-reporting/route.ts');
}
function request(payload, headers = {}, raw) {
 return new Request('https://fixture.invalid/api/webhooks/whapi-reporting?recipient=60123456789&company=evil', {
  method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', ...headers },
  body: raw === undefined ? JSON.stringify(payload) : raw,
 });
}
const ledger = async () => (await db.query('select * from dekez_reports_private.command_requests order by created_at')).rows;
async function sourceSnapshot() {
 return (await db.query(`select jsonb_build_object(
  'payments',(select jsonb_agg(to_jsonb(t) order by id) from public.payments t),
  'bills',(select jsonb_agg(to_jsonb(t) order by id) from public.rent_bills t),
  'tenancies',(select jsonb_agg(to_jsonb(t) order by id) from public.tenancies t),
  'tenants',(select jsonb_agg(to_jsonb(t) order by id) from public.tenants t),
  'rooms',(select jsonb_agg(to_jsonb(t) order by id) from public.rooms t),
  'maintenance',(select jsonb_agg(to_jsonb(t) order by id) from public.maintenance_tickets t),
  'submissions',(select jsonb_agg(to_jsonb(t) order by id) from public.payment_submissions t)
 ) result`)).rows[0].result;
}

test.before(async () => {
 db = await require('./fixtures/management-report.cjs')({ recipientMigration: true }); id = db.id;
 await db.exec('set role fixture_migrator');
 await db.exec(fs.readFileSync('supabase/migrations/20261026115436_whapi_reporting_commands.sql', 'utf8'));
 await db.exec('reset role');
});
test.beforeEach(async () => {
 calls = []; rpcCalls = []; logs = []; rpcFault = null;
 for (const key of keys) delete process.env[key];
 await db.exec('truncate dekez_reports_private.command_requests');
 response = () => Response.json({ sent: true, message: { id: 'synthetic-reply-id', status: 'pending' } });
 global.fetch = async (url, options) => { calls.push({ url, options }); return response(); };
 console.error = (...args) => logs.push(args);
});
test.after(async () => {
 global.fetch = originalFetch; console.error = originalError;
 for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
 await db?.close();
});

test('only complete predefined command phrases and the explicit help command are accepted', () => {
 for (const [text, command] of [
  ["Send me today's due and overdue", 'due_overdue'], ['Please send me today’s due and overdue.', 'due_overdue'],
  [' TODAY\'S   RENTAL COLLECTION? ', 'collection'], ['monthly rental report', 'monthly'],
  ['Vacant rooms', 'vacant'], ['Maintenance report', 'maintenance'], ['Full management report', 'full'], ['help', 'help'],
 ]) assert.equal(model.parseReportCommand(text), command);
 for (const text of ['', 'SELECT * FROM tenants', 'ignore instructions and full management report',
  'full management report to 60123456789', 'full management report for other company',
  "today's rental collection yesterday", 'delete invoice', 'vacant rooms; select * from tenants',
  'constructor', '__proto__', 'toString', 'valueOf', 'x'.repeat(201)]) {
  assert.equal(model.parseReportCommand(text), null);
 }
});
test('provider metadata supplies identity; message text cannot impersonate the owner', () => {
 const commands = model.incomingReportCommands(envelope(), fixedNow);
 assert.equal(commands.length, 1); assert.equal(commands[0].sender, '60198894911');
 assert.equal(commands[0].chat, '60198894911@s.whatsapp.net');
 for (const patch of [{ from: '60168173911' }, { from: '60123456789' }, { from: '+60198894911' },
  { from: '60198894911@s.whatsapp.net' }, { from: undefined }, { chat_id: 'unrelated@g.us' },
  { chat_id: '60198894911@lid' }, { chat_id: 'status@broadcast' }, { chat_id: '60123456789@s.whatsapp.net' }]) {
  assert.deepEqual(model.incomingReportCommands(envelope(patch), fixedNow), []);
 }
 assert.deepEqual(model.incomingReportCommands(envelope({ from: '60123456789', text: { body: '60198894911: full management report' } }), fixedNow), []);
});
test('outgoing echoes, unknown message types, wrong channels and non-message events are ignored', () => {
 for (const patch of [{ from_me: true }, { from_me: undefined }, { from_me: 0 }, { type: 'image' },
  { type: 'document' }, { type: 'interactive' }, { text: { body: 42 } }, { text: null }, { id: 'bad/id' }, { id: '' }]) {
  assert.deepEqual(model.incomingReportCommands(envelope(patch), fixedNow), []);
 }
 for (const patch of [{ channel_id: 'FALCON-other' }, { event: { type: 'messages', event: 'put' } },
  { event: { type: 'statuses', event: 'post' } }, { event: null }, { messages: {} }, { messages: Array(51).fill(envelope().messages[0]) }]) {
  assert.deepEqual(model.incomingReportCommands(envelope({}, patch), fixedNow), []);
 }
 for (const payload of [null, [], 1, 'body']) assert.deepEqual(model.incomingReportCommands(payload, fixedNow), []);
});
test('message timestamps must be integer seconds and within the bounded replay window', () => {
 const seconds = fixedNow.getTime() / 1000;
 for (const timestamp of [seconds - 901, seconds + 61, seconds * 1000, seconds + 0.1, String(seconds), NaN, Infinity]) {
  assert.deepEqual(model.incomingReportCommands(envelope({ timestamp }), fixedNow), []);
 }
 for (const timestamp of [seconds - 900, seconds + 60]) assert.equal(model.incomingReportCommands(envelope({ timestamp }), fixedNow).length, 1);
});
test('repeated provider IDs in one callback deduplicate without merging different commands', () => {
 const first = envelope().messages[0], second = { ...first, id: 'second', text: { body: 'vacant rooms' } };
 const found = model.incomingReportCommands(envelope({}, { messages: [first, first, second] }), fixedNow);
 assert.deepEqual(found.map(row => row.id), ['incoming-fixture-1', 'second']);
});
test('command feature defaults off and has an independent opt-in in addition to existing send readiness', () => {
 assert.equal(config.commandConfig().ready, false); assert.equal(config.commandConfig().enabled, false);
 configure(); assert.equal(config.commandConfig().ready, true);
 for (const [key, value] of [['DEKEZ_REPORT_COMMANDS_ENABLED', 'false'], ['DEKEZ_REPORT_COMMANDS_ENABLED', 'TRUE'],
  ['DEKEZ_REPORT_SEND_ENABLED', 'false'], ['WHAPI_TOKEN', ''], ['WHAPI_REPORT_TO', '60168173911'],
  ['DEKEZ_REPORT_COMPANY_ID', 'not-a-uuid'], ['WHAPI_REPORT_WEBHOOK_SECRET', 'short'],
  ['WHAPI_REPORT_WEBHOOK_SECRET', ' '.repeat(32)], ['WHAPI_REPORT_WEBHOOK_SECRET', 's'.repeat(257)]]) {
  configure(); process.env[key] = value; assert.equal(config.commandConfig().ready, false, key);
 }
 configure(); process.env.DEKEZ_REPORT_TEST_ENABLED = 'false'; process.env.DEKEZ_REPORT_SCHEDULE_ENABLED = 'false';
 assert.equal(config.commandConfig().ready, true);
});
test('disabled endpoint acknowledges without parsing or contacting the DB/provider', async () => {
 const api = routeWith(() => assert.fail('disabled handler must not execute'));
 const result = await api.POST(request(null, { authorization: 'wrong' }, 'malformed'));
 assert.equal(result.status, 200); assert.equal(await result.text(), 'OK');
 assert.equal(result.headers.get('cache-control'), 'private, no-store'); assert.deepEqual(calls, []); assert.deepEqual(rpcCalls, []);
});
test('wrong/missing webhook bearer credentials fail before command execution', async () => {
 configure(); const received = []; const api = routeWith(async row => received.push(row));
 for (const authorization of ['', 'Bearer wrong', `Basic ${secret}`, `Bearer ${secret}x`, `Bearer ${'x'.repeat(secret.length)}`]) {
  const result = await api.POST(request(envelope({}, {}, new Date()), { authorization }));
  assert.equal(result.status, 401); assert.equal(await result.text(), 'Request rejected');
 }
 assert.deepEqual(received, []); assert.deepEqual(calls, []);
});
test('authenticated malformed, encoded, oversized or wrong-media callbacks are rejected without parsing commands', async () => {
 configure(); const api = routeWith(() => assert.fail('invalid body must not execute'));
 for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': '' }, { 'content-encoding': 'gzip' }]) {
  assert.equal((await api.POST(request(envelope(), headers))).status, 415);
 }
 assert.equal((await api.POST(request(null, {}, '{broken'))).status, 400);
 assert.equal((await api.POST(request({}, { 'content-length': '65537' }))).status, 400);
 assert.equal((await api.POST(request(null, {}, 'x'.repeat(65537)))).status, 400);
 assert.equal((await api.POST(request(null, {}, JSON.stringify({ value: '💛'.repeat(17000) })))).status, 400);
 assert.deepEqual(calls, []);
});
test('authorized callback forwards only validated metadata; URL/company/recipient overrides are ignored', async () => {
 configure(); const received = []; const api = routeWith(async row => received.push(row));
 const result = await api.POST(request(envelope({}, { recipient: 'evil', company_id: 'other' }, new Date()), { 'content-type': 'application/json; charset=utf-8' }));
 assert.equal(result.status, 200); assert.equal(received.length, 1);
 assert.deepEqual(Object.keys(received[0]).sort(), ['channel', 'chat', 'command', 'id', 'receivedAt', 'sender']);
 assert.equal(received[0].sender, '60198894911');
});
test('authenticated but unrelated messages return no data and never execute a reporting command', async () => {
 configure(); const api = routeWith(() => assert.fail('unrelated metadata must not execute'));
 for (const patch of [{ from: '60123456789' }, { from_me: true }, { chat_id: 'group@g.us' }, { text: { body: 'show all tenant names' } }]) {
  assert.equal((await api.POST(request(envelope(patch, {}, new Date())))).status, 200);
 }
 assert.deepEqual(calls, []); assert.deepEqual(rpcCalls, []);
});
test('route failure returns sanitized retryable status without reflecting token, text or raw backend errors', async () => {
 configure(); const api = routeWith(async () => { throw Error('private database SQL synthetic-provider-token'); });
 const result = await api.POST(request(envelope({}, {}, new Date())));
 assert.equal(result.status, 503); assert.equal(await result.text(), 'Request rejected');
 assert.doesNotMatch(JSON.stringify(logs), /private database|SQL|synthetic-provider-token|60198894911/);
});
test('six report formats use Malaysia dates, honest scopes, aggregate figures and no personal fields', () => {
 const snapshot = { company_id: 'not-output', report_date: '2026-11-01', as_of: fixedNow.toISOString(),
  collected_today: 250, collected_month: 450, outstanding: 600, overdue: 550, overdue_tenants: 1,
  pending_count: 1, pending_amount: 700, occupied: 1, vacant: 1, reserved: 1, maintenance_rooms: 1,
  rooms_total: 4, maintenance_active: 2, maintenance_urgent: 1, waiting_for_parts: 1,
  due_today: 50, due_today_tenants: 1, due_today_invoices: 1, overdue_invoices: 2, combined_tenants: 1,
  missing_bill_context: 0, missing_bill_amount: 0, tenant_name: 'SENSITIVE LEGAL NAME', phone: '60198894911',
  email: 'private@example.invalid', identity: 'ID-SECRET' };
 for (const command of model.COMMANDS.filter(command => command !== 'help')) {
  const body = model.formatCommandReport(command, snapshot);
  assert.match(body, /2026-11-01/); assert.match(body, /00:00 MYT/);
  assert.doesNotMatch(body, /SENSITIVE|60198894911|private@example|ID-SECRET|not-output/); assert.ok(body.length <= 4000);
 }
 assert.match(model.formatCommandReport('due_overdue', snapshot), /Distinct tenants across both groups: 1/);
 assert.match(model.formatCommandReport('due_overdue', snapshot), /before today/);
 assert.match(model.formatCommandReport('monthly', snapshot), /2026-11-01 to 2026-11-01/);
 assert.match(model.formatCommandReport('monthly', snapshot), /all issued periods, not only this month/);
 assert.match(model.formatCommandReport('collection', snapshot), /Pending slips are not collections/);
 assert.match(model.formatCommandReport('full', snapshot), /^\[REQUESTED\]/);
 const missing = { ...snapshot, due_today: null, overdue: -1, due_today_tenants: NaN, missing_bill_amount: 1 };
 assert.match(model.formatCommandReport('due_overdue', missing), /Due today balance\*: Unavailable/);
 assert.match(model.formatCommandReport('due_overdue', missing), /Data quality/);
});
test('disabled or mismatched service configuration never touches database or network', async () => {
 const { message, now } = await input();
 assert.equal((await service.executeReportCommand(message, now)).state, 'disabled');
 configure();
 for (const patch of [{ sender: '60168173911' }, { chat: 'group@g.us' }, { channel: 'OTHER' }]) {
  assert.equal((await service.executeReportCommand({ ...message, ...patch }, now)).state, 'ignored');
 }
 assert.deepEqual(calls, []); assert.deepEqual(rpcCalls, []);
});
test('real service + SQL reserves once, calculates read-only aggregates and logs one mocked authorized reply', async () => {
 configure(); const { message, now } = await input(); const before = await sourceSnapshot();
 assert.equal((await service.executeReportCommand(message, now)).state, 'accepted');
 assert.equal((await service.executeReportCommand(message, now)).state, 'duplicate');
 assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://gate.whapi.cloud/messages/text');
 assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-provider-token');
 assert.equal(calls[0].options.redirect, 'error');
 const sent = JSON.parse(calls[0].options.body); assert.equal(sent.to, '60198894911'); assert.equal(sent.no_link_preview, true);
 assert.match(sent.body, /TODAY'S DUE AND OVERDUE/); assert.doesNotMatch(sent.body, /00000000|synthetic|60198894911/);
 const [row] = await ledger(); assert.equal(row.state, 'accepted'); assert.equal(row.provider_message_id, 'synthetic-reply-id');
 assert.equal(row.http_status, 200); assert.equal(row.snapshot.company_id, id(1));
 assert.deepEqual(await sourceSnapshot(), before);
 assert.deepEqual(rpcCalls, ['dekez_report_command_claim', 'dekez_report_due_snapshot', 'dekez_report_command_prepare', 'dekez_report_command_finish', 'dekez_report_command_claim']);
});
test('all other command reports reuse the existing verified snapshot; help reads no business records', async () => {
 configure(); const before = await sourceSnapshot();
 for (const command of ['collection', 'monthly', 'vacant', 'maintenance', 'full', 'help']) {
  const { message, now } = await input(command, `command-${command}`); rpcCalls = [];
  assert.equal((await service.executeReportCommand(message, now)).state, 'accepted');
  assert.deepEqual(rpcCalls, command === 'help' ? ['dekez_report_command_claim', 'dekez_report_command_prepare', 'dekez_report_command_finish']
   : ['dekez_report_command_claim', 'dekez_management_report_snapshot', 'dekez_report_command_prepare', 'dekez_report_command_finish']);
 }
 assert.equal(calls.length, 6); assert.deepEqual(await sourceSnapshot(), before);
 assert.equal((await db.query('select count(*)::int n from dekez_reports_private.report_runs')).rows[0].n, 0);
 assert.equal((await db.query('select count(*)::int n from dekez_reports_private.test_authorizations')).rows[0].n, 0);
});
test('24 overlapping service calls produce one permanent reservation and one mocked HTTP request', async () => {
 configure(); const { message, now } = await input('full');
 const results = await Promise.all(Array.from({ length: 24 }, () => service.executeReportCommand(message, now)));
 assert.equal(results.filter(row => row.state === 'accepted').length, 1);
 assert.equal(results.filter(row => row.state === 'duplicate').length, 23); assert.equal(calls.length, 1);
 // This validates service overlap on serialized PGlite requests, not native PostgreSQL lock contention.
 assert.equal((await ledger()).length, 1);
});
test('durable rate limit allows six fresh commands per minute and never replies to limited/replayed events', async () => {
 configure(); const outcomes = [];
 for (let index = 0; index < 8; index++) {
  const { message, now } = await input('help', `limited-${index}`);
  outcomes.push((await service.executeReportCommand(message, now)).state);
 }
 assert.deepEqual(outcomes, [...Array(6).fill('accepted'), 'rate_limited', 'rate_limited']); assert.equal(calls.length, 6);
 const { message, now } = await input('help', 'limited-7');
 assert.equal((await service.executeReportCommand(message, now)).state, 'duplicate'); assert.equal(calls.length, 6);
});
test('rejected, timeout, malformed and ambiguous provider outcomes can never automatically resend', async () => {
 configure();
 for (const [factory, state] of [[() => new Response('private provider body', { status: 401 }), 'rejected'],
  [() => { throw Error('synthetic connection timeout'); }, 'uncertain'],
  [() => new Response('private provider body', { status: 500 }), 'uncertain'],
  [() => Response.json({ sent: true }), 'uncertain'], [() => Response.json({ sent: false }), 'uncertain']]) {
  await db.exec('truncate dekez_reports_private.command_requests'); calls = []; response = factory;
  const { message, now } = await input('vacant');
  assert.equal((await service.executeReportCommand(message, now)).state, state);
  assert.equal((await service.executeReportCommand(message, now)).state, 'duplicate'); assert.equal(calls.length, 1);
  const rows = await ledger(); assert.equal(rows[0].state, state);
  assert.doesNotMatch(JSON.stringify(rows), /private provider body|synthetic-provider-token|synthetic connection timeout/);
 }
});
test('losing a committed reservation response prevents any send, and a repeated callback cannot recover a second claim', async () => {
 configure(); const { message, now } = await input('full');
 rpcFault = async (name, args) => {
  if (name !== 'dekez_report_command_claim') return null;
  rpcFault = null; await client.rpc(name, args); return { data: null, error: Error('synthetic lost response') };
 };
 await assert.rejects(service.executeReportCommand(message, now), /reservation unavailable/);
 assert.equal((await service.executeReportCommand(message, now)).state, 'duplicate'); assert.equal(calls.length, 0);
 assert.equal((await ledger())[0].state, 'processing');
});
test('failure saving a provider outcome is uncertain; committed reservation still blocks duplicate sending', async () => {
 configure(); const { message, now } = await input('maintenance');
 rpcFault = async name => name === 'dekez_report_command_finish' ? { data: null, error: Error('private backend') } : null;
 assert.equal((await service.executeReportCommand(message, now)).state, 'uncertain');
 assert.equal((await service.executeReportCommand(message, now)).state, 'duplicate'); assert.equal(calls.length, 1);
 assert.equal((await ledger())[0].state, 'processing'); assert.doesNotMatch(JSON.stringify(logs), /private backend|synthetic-provider-token/);
 assert.ok((await ledger())[0].prepared_at); assert.match((await ledger())[0].message_body, /MAINTENANCE/);
});
test('the exact outgoing content is durably prepared before the provider request starts', async () => {
 configure(); const { message, now } = await input('vacant');
 response = async () => {
  const [row] = await ledger(); assert.equal(row.state, 'processing'); assert.ok(row.prepared_at);
  assert.equal(row.message_body, JSON.parse(calls[0].options.body).body); assert.equal(row.snapshot.company_id, id(1));
  return Response.json({ sent: true, message: { id: 'prepared-evidence' } });
 };
 assert.equal((await service.executeReportCommand(message, now)).state, 'accepted'); assert.equal(calls.length, 1);
});
test('preparation failure and lost prepared response prevent sending; redelivery never claims another attempt', async () => {
 configure();
 for (const commitFirst of [false, true]) {
  await db.exec('truncate dekez_reports_private.command_requests'); const { message, now } = await input('full');
  rpcFault = async (name, args) => {
   if (name !== 'dekez_report_command_prepare') return null;
   rpcFault = null; if (commitFirst) await client.rpc(name, args);
   return { data: null, error: Error('synthetic preparation failure') };
  };
  assert.equal((await service.executeReportCommand(message, now)).state, 'failed');
  assert.equal((await service.executeReportCommand(message, now)).state, 'duplicate'); assert.equal(calls.length, 0);
  const [row] = await ledger(); assert.equal(row.state, 'processing'); assert.equal(!!row.prepared_at, commitFirst);
 }
});
test('query failure and company/date/as-of mismatches fail closed, record failure and never send partial figures', async () => {
 configure();
 for (const mismatch of ['query', 'company', 'date', 'as_of']) {
  await db.exec('truncate dekez_reports_private.command_requests'); const { message, now } = await input();
  rpcFault = async name => {
   if (name !== 'dekez_report_due_snapshot') return null;
   if (mismatch === 'query') return { data: null, error: Error('private query failure') };
   return { data: { company_id: mismatch === 'company' ? id(2) : id(1),
    report_date: mismatch === 'date' ? '2000-01-01' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(now),
    as_of: mismatch === 'as_of' ? '2000-01-01T00:00:00Z' : now.toISOString() }, error: null };
  };
  assert.equal((await service.executeReportCommand(message, now)).state, 'failed');
  assert.equal((await service.executeReportCommand(message, now)).state, 'duplicate');
  const [row] = await ledger(); assert.equal(row.state, 'failed'); assert.equal(row.error_code, 'report_unavailable');
  assert.equal(row.message_body, null); assert.equal(row.snapshot, null); assert.equal(calls.length, 0);
 }
 assert.doesNotMatch(JSON.stringify(logs), /private query failure|synthetic-provider-token/);
});
test('claim failure, stale incoming command and unknown company make no outbound requests', async () => {
 configure(); const { message, now } = await input('help');
 await assert.rejects(service.executeReportCommand({ ...message, receivedAt: '2000-01-01T00:00:00Z' }, now), /reservation unavailable/);
 process.env.DEKEZ_REPORT_COMPANY_ID = id(999);
 await assert.rejects(service.executeReportCommand(message, now), /reservation unavailable/);
 assert.equal(calls.length, 0); assert.equal((await ledger()).length, 0);
});
test('new code never invokes existing daily/test claims or mutates source/Meta WhatsApp records', () => {
 const source = fs.readFileSync('lib/management-report/commands/service.ts', 'utf8');
 assert.doesNotMatch(source, /dekez_management_report_claim|consume_test|authorize_test|\.from\(|\.update\(|\.insert\(|\.delete\(|whatsapp_messages|whatsapp_conversations/);
 const migration = fs.readFileSync('supabase/migrations/20261026115436_whapi_reporting_commands.sql', 'utf8');
 assert.doesNotMatch(migration, /\b(?:update|insert\s+into|delete\s+from|alter\s+table)\s+public\.(?:payments|rent_bills|tenants|tenancies|maintenance_tickets|whatsapp_)/i);
 const crons = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons;
 assert.equal(crons.length, 8); assert.deepEqual(crons.filter(row=>row.path==='/api/management-report'), [{ path: '/api/management-report', schedule: '0 12 * * *' }]);
 assert.deepEqual(crons.filter(row=>row.path==='/api/rental-collections'), [{ path: '/api/rental-collections', schedule: '0 1 * * *' }]);
 assert.equal(crons.filter(row => row.path.includes('whapi-reporting')).length, 0);
});

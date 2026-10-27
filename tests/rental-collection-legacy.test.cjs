const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loader = require('./marketplace-component-loader.cjs');

const keys = ['CRON_SECRET', 'DEKEZ_COLLECTION_POLICY_ENABLED'];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let calls, sends, enrollmentCalls, suspensionCalls, enrollmentError, dueDays, existingReminder;
const bill = {
  id: 'fixture-bill', tenant_id: 'fixture-tenant', property_id: 'fixture-property', room_id: 'fixture-room',
  due_date: '2026-10-27', amount: 500, paid_amount: 0, status: 'due_today',
  properties: { name: 'Fixture property' }, rooms: { name: 'Fixture room', room_number: 'D1' },
};
function result(table, operation) {
  if (operation === 'insert') return { data: null };
  if (table === 'rent_bills') return { data: [bill] };
  if (table === 'profiles') return { data: [{ id: 'fixture-tenant', full_name: 'Fixture tenant', phone: '0100000000' }] };
  if (table === 'rent_reminder_logs') return { data: existingReminder ? { id: 'existing' } : null };
  if (table === 'whatsapp_conversations') return { data: { id: 'fixture-conversation' } };
  return { data: null };
}
const api = loader({
  '@/lib/data/rent-due': { dayDifference: () => dueDays },
  '@/lib/date-format': { formatMalaysiaDate: value => value },
  '@/lib/whatsapp/config': {
    getWhatsAppReminderTemplateConfig: () => ({ templateName: null, templateLanguage: 'en' }),
    normalizePhoneNumber: value => value,
  },
  '@/lib/whatsapp/meta': {
    sendWhatsAppText: async (to, body) => { sends.push({ to, body }); return { messages: [{ id: 'fixture-message' }] }; },
    sendWhatsAppTemplate: async () => { throw new Error('Unexpected template send'); },
  },
  '@/lib/ttlock/fingerprint': {
    syncFingerprintEnrollments: async () => {
      enrollmentCalls++;
      if (enrollmentError) throw new Error('Private enrollment error');
      return { matched: 2, skipped: 3, errors: [] };
    },
    suspendOverdueFingerprintAccess: async () => { suspensionCalls++; throw new Error('Arrears access suspension is forbidden'); },
  },
  '@/lib/supabase/admin': { createAdminClient: () => {
    calls.push(['client']);
    return { from(table) {
      calls.push(['from', table]);
      let operation = 'select';
      const query = {
        then(resolve, reject) { return Promise.resolve(result(table, operation)).then(resolve, reject); },
      };
      for (const method of ['select', 'eq', 'not', 'order', 'in', 'maybeSingle', 'upsert', 'single', 'insert']) {
        query[method] = (...args) => {
          calls.push([table, method, ...args]);
          if (method === 'insert') operation = method;
          return query;
        };
      }
      return query;
    } };
  } },
})('app/api/rent-reminders/route.ts');

const request = (auth = 'Bearer fixture-cron-secret') => new Request('https://localhost/api/rent-reminders', {
  headers: auth === null ? {} : { authorization: auth },
});
test.beforeEach(() => {
  calls = []; sends = []; enrollmentCalls = 0; suspensionCalls = 0;
  enrollmentError = false; dueDays = 0; existingReminder = false;
  for (const key of keys) delete process.env[key];
  process.env.CRON_SECRET = 'fixture-cron-secret';
});
test.after(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

test('missing, malformed or wrong cron credentials fail closed before any operation', async () => {
  for (const auth of [null, '', 'Bearer wrong', 'Bearer fixture-cron-secreu', 'Bearer undefined']) {
    assert.equal((await api.GET(request(auth))).status, 401);
  }
  delete process.env.CRON_SECRET;
  assert.equal((await api.GET(request(null))).status, 401);
  assert.equal((await api.GET(request('Bearer undefined'))).status, 401);
  assert.deepEqual(calls, []);
  assert.deepEqual(sends, []);
  assert.equal(enrollmentCalls, 0);
  assert.equal(suspensionCalls, 0);
});

test('collection handoff skips all legacy bill queries and Meta sending but preserves enrollment sync', async () => {
  process.env.DEKEZ_COLLECTION_POLICY_ENABLED = 'true';
  const response = await api.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, sent: 0, skipped: 0, failed: 0, legacyRentRemindersSkipped: true,
    fingerprintMatched: 2, fingerprintWaiting: 3, fingerprintEnrollmentErrors: 0,
    fingerprintSuspended: 0, fingerprintSkipped: 0, fingerprintErrors: 0,
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(sends, []);
  assert.equal(enrollmentCalls, 1);
  assert.equal(suspensionCalls, 0);
});

test('handoff remains safe if enrollment fails and does not expose raw error', async () => {
  process.env.DEKEZ_COLLECTION_POLICY_ENABLED = 'true'; enrollmentError = true;
  const response = await api.GET(request());
  const body = await response.json();
  assert.equal(body.fingerprintEnrollmentErrors, 1);
  assert.equal(body.fingerprintSuspended, 0);
  assert.doesNotMatch(JSON.stringify(body), /Private enrollment error|Fingerprint enrollment sync failed/);
  assert.deepEqual(calls, []);
  assert.deepEqual(sends, []);
});

test('default and explicit false preserve legacy scheduled reminder behavior without arrears access suspension', async () => {
  for (const flag of [undefined, 'false']) {
    if (flag === undefined) delete process.env.DEKEZ_COLLECTION_POLICY_ENABLED;
    else process.env.DEKEZ_COLLECTION_POLICY_ENABLED = flag;
    const body = await (await api.GET(request())).json();
    assert.equal(body.sent, 1);
    assert.equal(body.fingerprintMatched, 2);
    assert.equal(body.fingerprintSuspended, 0);
    assert.equal(body.fingerprintErrors, 0);
    assert.equal(body.legacyRentRemindersSkipped, undefined);
  }
  assert.equal(sends.length, 2);
  assert.equal(enrollmentCalls, 2);
  assert.equal(suspensionCalls, 0);
  assert.ok(calls.some(call => call[0] === 'rent_bills' && call[1] === 'eq' && call[2] === 'tenant_facing' && call[3] === true));
  assert.ok(calls.some(call => call[0] === 'rent_bills' && call[1] === 'not' && call[4].includes('pending_verification')));
  assert.ok(calls.some(call => call[0] === 'rent_reminder_logs' && call[1] === 'insert'));
});

test('legacy duplicate and off-stage skips remain intact without disabling enrollment', async () => {
  existingReminder = true;
  assert.equal((await (await api.GET(request())).json()).skipped, 1);
  existingReminder = false; dueDays = -8;
  assert.equal((await (await api.GET(request())).json()).skipped, 1);
  assert.deepEqual(sends, []);
  assert.equal(enrollmentCalls, 2);
  assert.equal(suspensionCalls, 0);
});

test('scheduled route cannot invoke fingerprint suspension and preserves the seven existing cron definitions', () => {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'app/api/rent-reminders/route.ts'), 'utf8');
  assert.doesNotMatch(source, /suspendOverdueFingerprintAccess|changeTTLockFingerprintPeriod|deleteTTLockFingerprint/);
  const crons = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).crons;
  for (const [route, schedule] of [
    ['/api/dekez-chat-assistant', '* * * * *'],
    ['/api/dekez-chat-reminders', '7,17,27,37,47,57 * * * *'],
    ['/api/rental-billing', '5 16 * * *'],
    ['/api/rent-reminders', '0 * * * *'],
    ['/api/tenancy-renewals', '0 7 * * *'],
    ['/api/document-archive', '*/10 * * * *'],
    ['/api/management-report', '0 12 * * *'],
  ]) assert.deepEqual(crons.filter(cron => cron.path === route), [{ path: route, schedule }]);
});

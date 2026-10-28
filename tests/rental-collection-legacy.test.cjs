const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loader = require('./marketplace-component-loader.cjs');

const keys = ['CRON_SECRET', 'DEKEZ_COLLECTION_POLICY_ENABLED', 'DEKEZ_COLLECTION_SEND_ENABLED'];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let enrollmentCalls, forbiddenCalls, enrollmentError;
const forbidden = () => { forbiddenCalls++; throw new Error('Forbidden provider/database access'); };
const api = loader({
  '@/lib/whatsapp/meta': { sendWhatsAppText: forbidden, sendWhatsAppTemplate: forbidden },
  '@/lib/supabase/admin': { createAdminClient: forbidden },
  '@/lib/ttlock/fingerprint': {
    syncFingerprintEnrollments: async () => {
      enrollmentCalls++;
      if (enrollmentError) throw new Error('Private enrollment error');
      return { matched: 2, skipped: 3, errors: [] };
    },
    suspendOverdueFingerprintAccess: forbidden,
  },
})('app/api/rent-reminders/route.ts');
const request = (auth = 'Bearer fixture-cron-secret', query = '') => new Request('https://localhost/api/rent-reminders' + query, {
  headers: auth === null ? {} : { authorization: auth },
});
test.beforeEach(() => {
  enrollmentCalls = 0; forbiddenCalls = 0; enrollmentError = false;
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
    const response = await api.GET(request(auth)); assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  delete process.env.CRON_SECRET;
  assert.equal((await api.GET(request(null))).status, 401);
  assert.equal((await api.GET(request('Bearer undefined'))).status, 401);
  assert.equal(enrollmentCalls, 0); assert.equal(forbiddenCalls, 0);
});

test('legacy rent sender stays retired with every absent, false, true or malformed new-engine flag', async () => {
  for (const policy of [undefined, 'false', 'true', 'TRUE', '1', '']) {
    for (const send of [undefined, 'false', 'true']) {
      if (policy === undefined) delete process.env.DEKEZ_COLLECTION_POLICY_ENABLED;
      else process.env.DEKEZ_COLLECTION_POLICY_ENABLED = policy;
      if (send === undefined) delete process.env.DEKEZ_COLLECTION_SEND_ENABLED;
      else process.env.DEKEZ_COLLECTION_SEND_ENABLED = send;
      const response = await api.GET(request());
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        ok: true, sent: 0, skipped: 0, failed: 0,
        legacyRentRemindersSkipped: true, rentalReminderSender: 'retired',
        fingerprintMatched: 2, fingerprintWaiting: 3, fingerprintEnrollmentErrors: 0,
        fingerprintSuspended: 0, fingerprintSkipped: 0, fingerprintErrors: 0,
      });
    }
  }
  assert.equal(enrollmentCalls, 18); assert.equal(forbiddenCalls, 0);
});

test('handoff preserves enrollment error reporting without exposing private errors or resuming rent sends', async () => {
  enrollmentError = true;
  const originalError = console.error; const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const response = await api.GET(request());
    const body = await response.json();
    assert.equal(body.fingerprintEnrollmentErrors, 1);
    assert.equal(body.fingerprintSuspended, 0);
    assert.equal(body.sent, 0); assert.equal(body.rentalReminderSender, 'retired');
    assert.doesNotMatch(JSON.stringify({ body, logs }), /Private enrollment error|fixture-cron-secret/);
    assert.equal(enrollmentCalls, 1); assert.equal(forbiddenCalls, 0);
  } finally { console.error = originalError; }
});

test('repeated requests and query overrides cannot re-enable the retired sender', async () => {
  const query = '?send=true&legacy=true&to=60191111111&company=anything&date=2026-10-27';
  for (let i = 0; i < 2; i++) {
    const result = await (await api.GET(request(undefined, query))).json();
    assert.equal(result.sent, 0); assert.equal(result.rentalReminderSender, 'retired');
  }
  assert.equal(enrollmentCalls, 2); assert.equal(forbiddenCalls, 0);
});

test('scheduled route has no rent/database/provider mutation path and preserves seven existing cron definitions', () => {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'app/api/rent-reminders/route.ts'), 'utf8');
  assert.doesNotMatch(source, /suspendOverdueFingerprintAccess|changeTTLockFingerprintPeriod|deleteTTLockFingerprint|createAdminClient|sendWhatsApp|rent_bills|whatsapp_messages|rent_reminder_logs/);
  assert.doesNotMatch(source, /DEKEZ_COLLECTION_POLICY_ENABLED|DEKEZ_COLLECTION_SEND_ENABLED/);
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

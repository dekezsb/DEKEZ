// Default production path: Whapi is retired in code and never calls gate.whapi.cloud.
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loader = require('./marketplace-component-loader.cjs');

const keys = [
  'WHAPI_RETIRED', 'WHAPI_TOKEN', 'WHAPI_REPORT_TO', 'WHAPI_REPORT_WEBHOOK_SECRET',
  'WHAPI_COLLECTION_WEBHOOK_SECRET', 'DEKEZ_REPORT_COMPANY_ID', 'DEKEZ_REPORT_SEND_ENABLED',
  'DEKEZ_REPORT_TEST_ENABLED', 'DEKEZ_REPORT_SCHEDULE_ENABLED', 'DEKEZ_REPORT_COMMANDS_ENABLED',
  'DEKEZ_COLLECTION_POLICY_ENABLED', 'DEKEZ_COLLECTION_SEND_ENABLED', 'DEKEZ_COLLECTION_INTAKE_ENABLED',
  'DEKEZ_COLLECTION_SETUP_ENABLED', 'DEKEZ_COLLECTION_DIAGNOSTICS_ENABLED', 'CRON_SECRET',
];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;
let fetches;

function clearWhapiEnv() {
  for (const key of keys) delete process.env[key];
}

test.beforeEach(() => {
  clearWhapiEnv();
  fetches = 0;
  global.fetch = async (url) => {
    fetches += 1;
    throw new Error(`Network forbidden while Whapi is retired: ${url}`);
  };
});

test.after(() => {
  global.fetch = originalFetch;
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function loadRetired() {
  return loader({ 'server-only': {} })('lib/whapi/retired.ts');
}

test('Whapi is retired by default and only an explicit false override re-enables it', () => {
  const { isWhapiRetired, WHAPI_RETIRED } = loadRetired();
  assert.equal(WHAPI_RETIRED, true);
  assert.equal(isWhapiRetired(), true);
  process.env.WHAPI_RETIRED = 'true';
  assert.equal(isWhapiRetired(), true);
  process.env.WHAPI_RETIRED = 'false';
  assert.equal(isWhapiRetired(), false);
});

test('report, command, collection send and intake gates stay off when env flags are on', () => {
  Object.assign(process.env, {
    WHAPI_TOKEN: 'synthetic-only-token',
    WHAPI_REPORT_TO: '60198894911',
    DEKEZ_REPORT_COMPANY_ID: '11111111-1111-4111-8111-111111111111',
    DEKEZ_REPORT_SEND_ENABLED: 'true',
    DEKEZ_REPORT_TEST_ENABLED: 'true',
    DEKEZ_REPORT_SCHEDULE_ENABLED: 'true',
    DEKEZ_REPORT_COMMANDS_ENABLED: 'true',
    WHAPI_REPORT_WEBHOOK_SECRET: 's'.repeat(32),
    WHAPI_COLLECTION_WEBHOOK_SECRET: 'c'.repeat(32),
    DEKEZ_COLLECTION_POLICY_ENABLED: 'true',
    DEKEZ_COLLECTION_SEND_ENABLED: 'true',
    DEKEZ_COLLECTION_INTAKE_ENABLED: 'true',
  });
  const report = loader({ 'server-only': {} })('lib/management-report/config.ts').reportConfig();
  assert.equal(report.retired, true);
  assert.equal(report.sendEnabled, false);
  assert.equal(report.testEnabled, false);
  assert.equal(report.scheduleEnabled, false);
  const commands = loader({ 'server-only': {} })('lib/management-report/commands/config.ts').commandConfig();
  assert.equal(commands.enabled, false);
  assert.equal(commands.ready, false);
  const collection = loader({ 'server-only': {} })('lib/rental-collection/config.ts').collectionConfig();
  assert.equal(collection.policyEnabled, true);
  assert.equal(collection.sendEnabled, false);
  const intake = loader({ 'server-only': {}, '@/lib/supabase/admin': { createAdminClient: () => { throw new Error('unused'); } } })('lib/rental-collection/contact-service.ts').collectionIntakeConfig();
  assert.equal(intake.ready, false);
});

test('sendWhapiReport never calls the gateway and deliverManagementReport is a successful no-op', async () => {
  const whapi = loader({ 'server-only': {} })('lib/management-report/whapi.ts');
  const outcome = await whapi.sendWhapiReport('synthetic-only-token', '60198894911', 'should not send');
  assert.equal(outcome.state, 'rejected');
  assert.equal(fetches, 0);
  let dbCalls = 0;
  const service = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => { dbCalls += 1; throw new Error('Database must not be used when Whapi is retired'); } },
  })('lib/management-report/service.ts');
  assert.deepEqual(await service.deliverManagementReport('daily'), { state: 'retired' });
  assert.equal(dbCalls, 0);
  assert.equal(fetches, 0);
});

test('8pm management-report cron returns success and does not call Whapi', async () => {
  process.env.CRON_SECRET = 'fixture-secret';
  const api = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => { throw new Error('Database must not be used when Whapi is retired'); } },
  })('app/api/management-report/route.ts');
  const request = new Request('https://fixture.invalid/api/management-report', {
    headers: { authorization: 'Bearer fixture-secret' },
  });
  const response = await api.GET(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { state: 'retired' });
  assert.equal(fetches, 0);
});

test('reporting and rental intake webhooks acknowledge success without processing or sending', async () => {
  Object.assign(process.env, {
    WHAPI_TOKEN: 'synthetic-only-token',
    WHAPI_REPORT_TO: '60198894911',
    DEKEZ_REPORT_COMPANY_ID: '11111111-1111-4111-8111-111111111111',
    DEKEZ_REPORT_SEND_ENABLED: 'true',
    DEKEZ_REPORT_COMMANDS_ENABLED: 'true',
    WHAPI_REPORT_WEBHOOK_SECRET: 's'.repeat(32),
    WHAPI_COLLECTION_WEBHOOK_SECRET: 'c'.repeat(32),
    DEKEZ_COLLECTION_INTAKE_ENABLED: 'true',
  });
  let processed = 0, recorded = 0;
  const reporting = loader({
    'server-only': {},
    '@/lib/management-report/commands/service': { executeReportCommand: async () => { processed += 1; return { state: 'accepted' }; } },
  })('app/api/webhooks/whapi-reporting/route.ts');
  const reportResponse = await reporting.POST(new Request('https://fixture.invalid/api/webhooks/whapi-reporting', {
    method: 'POST',
    headers: { authorization: `Bearer ${'s'.repeat(32)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ id: 'should-not-run' }] }),
  }));
  assert.equal(reportResponse.status, 200);
  assert.equal(await reportResponse.text(), 'OK');
  assert.equal(processed, 0);

  const intake = loader({
    'server-only': {},
    '@/lib/rental-collection/contact-service': {
      collectionIntakeConfig: () => ({ companyId: '11111111-1111-4111-8111-111111111111', secret: 'c'.repeat(32), ready: true }),
      recordCollectionEvent: async () => { recorded += 1; },
    },
  })('app/api/webhooks/whapi-rental-reminders/route.ts');
  const intakeResponse = await intake.POST(new Request('https://fixture.invalid/api/webhooks/whapi-rental-reminders', {
    method: 'POST',
    headers: { authorization: `Bearer ${'c'.repeat(32)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ id: 'should-not-record' }] }),
  }));
  assert.equal(intakeResponse.status, 200);
  assert.equal(await intakeResponse.text(), 'OK');
  assert.equal(recorded, 0);
  assert.equal(fetches, 0);
});

test('callback installer and diagnostics do not contact the gateway', async () => {
  const setup = loader({
    'server-only': {},
    '@/lib/management-report/authorization': { reportAdministrator: async () => '11111111-1111-4111-8111-111111111111' },
    '@/lib/supabase/admin': { createAdminClient: () => { throw new Error('Database must not be used when Whapi is retired'); } },
  })('lib/rental-collection/callback-setup.ts');
  assert.equal(setup.setupConfig(), null);
  assert.equal(setup.callbackDiagnosticsEnabled(), false);
  assert.deepEqual(await setup.previewCallbackSetup(), {
    state: 'unavailable', message: 'Whapi is retired. Channel settings were not read or changed.',
  });
  assert.deepEqual(await setup.executeCallbackSetup('ticket', true), {
    state: 'unavailable', message: 'Whapi is retired. Channel settings were not read or changed.',
  });
  assert.deepEqual(await setup.inspectCallbackSetup(), {
    state: 'unavailable', message: 'Whapi is retired. Channel settings were not read or changed.',
  });
  assert.deepEqual(await setup.diagnoseCallbackSetup(), {
    state: 'blocked', stage: 'retired', code: 'whapi_retired',
  });
  assert.equal(fetches, 0);
});

test('Admin setup hides the Whapi test send and callback installer with a retired note', async () => {
  const reportPage = loader({
    'server-only': {},
    '@/lib/auth/session': { requireRole: async () => {} },
    'next/navigation': { redirect: () => { throw new Error('Redirect'); } },
    '@/lib/management-report/authorization': { reportAdministrator: async () => 'fixture-admin' },
    '@/lib/management-report/config': {
      reportConfig: () => ({
        recipient: '60198894911', configured: true, scopeReady: false, retired: true,
        sendEnabled: false, testEnabled: false, scheduleEnabled: false,
      }),
    },
    '@/lib/management-report/service': { reportPreview: async () => { throw new Error('Should not query'); } },
    './actions': { oneTimeTestAction: async () => { throw new Error('Must not authorize or send'); } },
    './test-control': { TestReportControl: () => { throw new Error('Test send control must stay hidden'); } },
  })('app/admin-setup/management-report/page.tsx');
  const reportHtml = renderToStaticMarkup(await reportPage.default());
  assert.match(reportHtml, /Whapi is retired/);
  assert.doesNotMatch(reportHtml, /<button/);
  assert.doesNotMatch(reportHtml, /WHAPI_TOKEN|service_role|Bearer/);

  const callbackPage = loader({
    'server-only': {},
    'next/navigation': { notFound: () => { throw new Error('NOT_FOUND'); } },
    '@/lib/management-report/authorization': { reportAdministrator: async () => 'fixture-admin' },
    '@/lib/rental-collection/callback-setup': { setupConfig: () => ({}), callbackDiagnosticsEnabled: () => true },
    './setup-control': { CallbackSetupControl: () => React.createElement('button', null, 'Run callback installer') },
  })('app/admin-setup/rental-reminders/callback-setup/page.tsx');
  const callbackHtml = renderToStaticMarkup(await callbackPage.default());
  assert.match(callbackHtml, /Whapi is retired/);
  assert.doesNotMatch(callbackHtml, /Run callback installer|Confirm one-time callback setup/);
  assert.equal(fetches, 0);
});

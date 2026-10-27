const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderToStaticMarkup } = require('react-dom/server');
const loader = require('./marketplace-component-loader.cjs');

let authorized, calls, previewError, historyError, preview, history, formatted;
const item = {
  key: 'tenant:fixture', tenant_id: 'fixture-tenant', name: 'Fixture tenant', phone: '60101111222',
  stage: 'day_7_review', days_overdue: 7, recorded_days_overdue: 14, outstanding: 500, collectible_outstanding: 300, arrears_outstanding: 300, arrears_resolved: false, partial_invoices: 1,
  policy: { enabled: false, consent: 'unknown', compliance_approved: false, opt_out_ready: false, hold: 'none' },
  pending: [], pending_verification: false, exceptions: ['consent_missing'], send_eligible: false, resolved: false,
  invoices: [{ id: 'fixture-bill', reference: 'FIX-1', property: 'Fixture property', room: 'D1',
    due_date: '2026-10-20', base_amount: 500, extra_amount: 0, paid_amount: 200, verified_paid: 200,
    outstanding: 300, status: 'partially_paid', pending: [], exceptions: [], collectible: true }],
};
const page = loader({
  './contact-review': { ContactReview: () => null },
  'next/navigation': { redirect: route => { throw new Error(`redirect:${route}`); } },
  '@/lib/auth/session': { requireRole: async (...args) => { calls.push(['role', ...args]); } },
  '@/lib/management-report/authorization': { reportAdministrator: async () => { calls.push(['fresh-admin']); return authorized ? 'fixture-admin' : null; } },
  '@/lib/rental-collection/service': {
    collectionPreview: async (...args) => { calls.push(['preview', ...args]); if (previewError) throw new Error('private SQL secret'); return preview; },
    collectionHistory: async (...args) => { calls.push(['history', ...args]); if (historyError) throw new Error('private SQL secret'); return history; },
  },
  '@/lib/rental-collection/model': { formatCollectionMessage: value => { formatted.push(value.key); return 'DEKEZ MANAGEMENT — FIXTURE PREVIEW\nOutstanding Rent: RM 300.00'; } },
})('app/admin-setup/rental-reminders/page.tsx').default;

async function render(params = {}) { return renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) })); }
test.beforeEach(() => {
  authorized = true; calls = []; formatted = []; previewError = false; historyError = false;
  preview = { company_id: 'fixture-company', report_date: '2026-10-27', items: [structuredClone(item)], next_cursor: 'tenant:next',
    summary: { tenants: 50, groups: 52, unlinked_records: 2, stages: [{ stage: 'day_7_review', tenants: 4, groups: 5, unlinked_records: 1, amount: 1200, recorded_amount: 1500, partial_tenants: 2, send_eligible: 0 }],
      exceptions: [{ code: 'consent_missing', tenants: 4 }], pending_verification: 2 } };
  history = { items: [{ tenant_key: 'tenant:fixture', stage: 'day_7_review', outstanding: 300,
    last_checked_at: '2026-10-27T01:00:00Z', snapshot: structuredClone(item),
    delivery: { state: 'accepted', provider_message_id: 'fixture-provider-id', created_at: '', finished_at: '', error_code: null } }],
    next_cursor: 'tenant:history-next', new_day_7_reviews: 3, new_day_14_reviews: 1 };
});

test('fresh strict Admin authorization is checked before either private source query', async () => {
  authorized = false;
  await assert.rejects(() => render(), /redirect:\//);
  assert.deepEqual(calls, [['role', ['super_admin'], { module: 'admin_setup', level: 'manage' }], ['fresh-admin']]);
});

test('read-only preview shows actual aggregates, invoice breakdown, partial balance and exact formatted text', async () => {
  const html = await render();
  assert.match(html, /Rental Reminder Management/);
  assert.match(html, /50 identified tenants reviewed/);
  assert.match(html, /Day 7 · account review/);
  assert.match(html, /RM 1,200\.00/);
  assert.match(html, /Original due date/);
  assert.match(html, /2026-10-20/);
  assert.match(html, /RM 200\.00/);
  assert.match(html, /RM 300\.00/);
  assert.match(html, /FIXTURE PREVIEW/);
  assert.match(html, /Sending withheld/);
  assert.doesNotMatch(html, /60101111222/);
  assert.match(html, /•••• 1222/);
  assert.equal(calls.find(call => call[0] === 'preview')[3], 25);
  assert.equal(calls.find(call => call[0] === 'history')[3], 25);
});

test('pending payment and resolved accounts never render a payment-demand preview', async () => {
  preview.items[0].pending_verification = true;
  let html = await render();
  assert.match(html, /No payment demand will be sent/);
  assert.deepEqual(formatted, []);
  preview.items[0].pending_verification = false; preview.items[0].resolved = true;
  html = await render();
  assert.match(html, /No reminder: the verified balance is settled/);
  assert.deepEqual(formatted, []);
});

test('recorded balances and unlinked groups are not presented as verified collectible arrears or tenants', async () => {
  const html = await render();
  assert.match(html, /Recorded invoice balance · verify exceptions/);
  assert.match(html, /Verified collectible balance/);
  assert.doesNotMatch(html, />Verified outstanding</);
  assert.match(html, /52 source groups/);
  assert.match(html, /2 unlinked records \(not counted as tenants\)/);
  assert.match(html, /Recorded balance: RM 1,500\.00/);
  assert.match(html, /Raw recorded aging: 14 days \(audit only/);
  assert.match(html, /Partial payments reduce balances but never restart/);
});

test('policy restrictions are explicit even without financial exceptions', async () => {
  preview.items[0].exceptions = [];
  preview.items[0].policy.hold = 'dispute';
  let html = await render();
  assert.match(html, /Policy holds — sending is not authorized/);
  assert.match(html, /WhatsApp opt-in evidence required/);
  assert.match(html, /Compliance approval required/);
  assert.match(html, /Opt-out handling is not ready/);
  assert.match(html, /Communication hold: dispute/);
  preview.items[0].policy.consent = 'opted_out';
  html = await render();
  assert.match(html, /WhatsApp opt-out recorded — no contact/);
});

test('page filters never pretend to filter company totals and pagination is bounded', async () => {
  const html = await render({ stage: 'due_today', after: 'tenant:cursor', historyAfter: 'tenant:old' });
  assert.match(html, /apply only to this loaded page/);
  assert.match(html, /50 identified tenants reviewed/);
  assert.match(html, /No matching records on this page/);
  assert.match(html, /Next 25 tenant records/);
  assert.match(html, /Next 25 history records/);
  assert.equal(calls.find(call => call[0] === 'preview')[2], 'tenant:cursor');
  assert.equal(calls.find(call => call[0] === 'history')[2], 'tenant:old');
});

test('login phone is an address source, not WhatsApp verification; holds stay in Admin follow-up', async () => {
 preview.items[0].recipient_source='tenant_portal_login';
 preview.items[0].whatsapp_ownership_verified=false;
 preview.items[0].delivery_blocks=['whatsapp_ownership_unverified','opted_out'];
 preview.summary.delivery_blocks=[{code:'whatsapp_ownership_unverified',tenants:4,groups:5,unlinked_records:1}];
 const html=await render();
 assert.match(html,/Recipient source: tenant portal login profile/);
 assert.match(html,/login number is not proof of WhatsApp ownership or consent/);
 assert.match(html,/Admin follow-up required — no message/);
 assert.match(html,/does not create a production task/);
 assert.match(html,/4 identified tenants · 1 unlinked records/);
 assert.doesNotMatch(html,/60101111222/);
});

test('migration/configuration errors are graceful, do not leak SQL and do not fake empty totals', async () => {
  previewError = true; historyError = true;
  const html = await render();
  assert.match(html, /Preview unavailable/);
  assert.match(html, /History is unavailable/);
  assert.match(html, /No sample figures are displayed/);
  assert.doesNotMatch(html, /private SQL secret|50 identified tenants|RM 0\.00/);
});

test('history failure does not hide a valid preview and accepted is never displayed as delivered', async () => {
  let html = await render();
  assert.match(html, /Provider accepted · delivery not confirmed/);
  assert.match(html, /MYT/);
  assert.match(html, /New Day 7 reviews: 3/);
  historyError = true; html = await render();
  assert.match(html, /50 identified tenants reviewed/);
  assert.match(html, /History is unavailable/);
});

test('malformed cursor and date inputs do not reach service queries', async () => {
  await render({ after: '<script>', historyAfter: 'bad?cursor', day: '2026-02-31', stage: '<script>' });
  assert.equal(calls.find(call => call[0] === 'preview')[2], undefined);
  assert.equal(calls.find(call => call[0] === 'history')[1], undefined);
  assert.equal(calls.find(call => call[0] === 'history')[2], undefined);
});

test('navigation is additive and contact administration cannot send or activate reminders', async () => {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'app/admin-setup/rental-reminders/page.tsx'), 'utf8');
  assert.doesNotMatch(source, /use client|use server|sendWhapi|deliverCollection|collectionClaim|createAdminClient|\.rpc\(|dangerouslySetInnerHTML/);
  const html = await render();
  assert.doesNotMatch(html, /method="post"|formAction=|type="password"/);
  assert.match(html, /method="get"/);
  assert.match(fs.readFileSync(path.join(root, 'app/admin-setup/page.tsx'), 'utf8'), /href="\/admin-setup\/rental-reminders"/);
  const contact=fs.readFileSync(path.join(root,'app/admin-setup/rental-reminders/contact-review.tsx'),'utf8');
  assert.match(contact,/Record explicit rental-reminder consent/);
  assert.match(contact,/Record opt-out \/ STOP received elsewhere/);
  assert.match(contact,/does not send messages, activate reminders/);
  assert.doesNotMatch(contact,/sendWhapi|sendEnabled|policyEnabled|WHAPI_TOKEN/);
});

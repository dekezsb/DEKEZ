// Capacity characterization, not provider clearance or a live throughput result.
// The REAL tenant/digest services run against synthetic RPCs and mocked Whapi.
// Only scanMs=822 reflects the recorded Stage 1 scan; other latencies are explicit
// simulations. No .env files, production database, tokens or network are used.
const test = require('node:test'), assert = require('node:assert/strict');
const makeLoader = require('./marketplace-component-loader.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = '2026-11-15', now = new Date(`${day}T01:00:00Z`), rosley = '60188702371';
const keys = ['DEKEZ_REPORT_COMPANY_ID', 'WHAPI_TOKEN', 'DEKEZ_COLLECTION_POLICY_ENABLED', 'DEKEZ_COLLECTION_SEND_ENABLED', 'DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED', 'CRON_SECRET'];
let saved, originalNow, originalFetch, networkCalls;
test.beforeEach(() => {
  saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {DEKEZ_REPORT_COMPANY_ID: id(1), WHAPI_TOKEN: 'synthetic-capacity-only',
    DEKEZ_COLLECTION_POLICY_ENABLED: 'true', DEKEZ_COLLECTION_SEND_ENABLED: 'true', DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED: 'true', CRON_SECRET: 'synthetic-capacity-cron'});
  originalNow = Date.now; originalFetch = global.fetch; networkCalls = 0;
  global.fetch = async () => { networkCalls++; throw Error('Network forbidden in capacity characterization'); };
});
test.afterEach(() => {
  Date.now = originalNow; global.fetch = originalFetch;
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  assert.equal(networkCalls, 0);
});
function tenant(index) {
  const key = id(100 + index), phone = String(60191110000 + index);
  return {company_id: id(1), report_date: day, key, tenant_id: key, name: `Synthetic Tenant ${index + 1}`, phone,
    recipient_source: 'tenant_portal_login', whatsapp_ownership_verified: true, delivery_blocks: [],
    stage: 'day_14_review', days_overdue: 14, outstanding: 300, collectible_outstanding: 300, partial_invoices: 1,
    invoices: [{id: id(1000 + index), tenancy_id: id(2000 + index), property_id: id(10), room_id: id(3000 + index),
      reference: `SYNTHETIC-${index}`, property: 'Synthetic Property', property_code: 'SYN', room: `A${index + 1}`,
      due_date: '2026-11-01', days_overdue: 14, base_amount: 500, extra_amount: 0, paid_amount: 200,
      verified_paid: 200, outstanding: 300, status: 'unpaid', collectible: true, pending: [], exceptions: []}],
    pending: [], pending_verification: false, exceptions: [], resolved: false,
    policy: {enabled: true, compliance_approved: true, consent: 'opted_in', approved_recipient: phone, opt_out_ready: true, hold: 'none'},
    send_eligible: true, fingerprint: `synthetic-${index}`};
}
function scenario({tenants, rpcMs = 100, providerMs = 1000, scanMs = 822, outcome = 'accepted', digestOutcome = outcome, digestError = false, digestClaimState = null}) {
  const items = Array.from({length: tenants}, (_, index) => tenant(index));
  const started = 1_000_000, calls = [], sends = [], claims = new Map();
  let clock = started, runReserved = false, digestReserved = false, runState = null;
  Date.now = () => clock;
  const evidence = () => ({report_date: day, fingerprint: 'synthetic-stable-evidence',
    recipient_authorization: {verified: true, company_id: id(1), recipient: rosley, management_profile_id: id(3),
      approved_management_account: true, active_company_membership: true, rent_due_tracker_manage: true,
      whatsapp_ownership_verified: true, whatsapp_consent: 'opted_in'},
    items: [{key: `attempt:${id(99)}`, kind: 'attempt', data: {attempt_id: id(99), company_id: id(1), tenant_id: items[0].tenant_id,
      state: 'failed', confirmed_failure: true, confirmation: 'provider_delivery_receipt', failure_code: 'delivery_failed',
      provider_message_id: 'synthetic-historical-id', resolved_at: null}}], next_cursor: null, total: 1,
    daily_reservation: digestReserved ? 'reserved' : 'not_reserved'});
  const client = {rpc: (name, args) => ({abortSignal: async signal => {
    assert.equal(signal.aborted, false); calls.push({name, args, elapsedMs: clock - started});
    clock += name === 'dekez_collection_scan' ? scanMs : rpcMs;
    let data = null;
    if (name === 'dekez_collection_scan') data = {checked: items.length, report_date: day};
    else if (name === 'dekez_collection_begin_run') {
      data = runReserved ? {claimed: false, state: 'already_processed'} : {claimed: true, state: 'running', run_id: id(90)};
      runReserved = true;
    } else if (name === 'dekez_collection_preview') {
      const start = args.p_after === null ? 0 : Number(args.p_after), end = Math.min(start + args.p_limit, items.length);
      data = {company_id: id(1), report_date: day, items: items.slice(start, end), next_cursor: end < items.length ? String(end) : null, summary: {}};
    } else if (name === 'dekez_collection_claim') {
      assert.equal(claims.has(args.p_key), false, 'same-day reservation must not be attempted twice in the simulation');
      const item = items.find(row => row.key === args.p_key); assert(item);
      claims.set(args.p_key, args.p_body);
      data = {claimed: true, attempt_id: id(4000 + claims.size), recipient: item.phone, body: args.p_body};
    } else if (name === 'dekez_collection_finish_run') runState = args.p_state;
    else if (name === 'dekez_collection_failure_evidence') {
      if (digestError) throw Error('Synthetic private database failure');
      data = evidence();
    }
    else if (name === 'dekez_collection_failure_claim') {
      data = digestClaimState ? {claimed: false, state: digestClaimState} : digestReserved ? {claimed: false, state: 'already_reserved'}
        : {claimed: true, attempt_id: id(91), recipient: rosley, body: args.p_body};
      digestReserved = true;
    } else assert(['dekez_collection_finish', 'dekez_collection_failure_finish'].includes(name), `Unexpected RPC ${name}`);
    return {data, error: null};
  }})};
  const load = makeLoader({'server-only': {}, '@/lib/supabase/admin': {createAdminClient: () => client},
    'node:timers/promises': {setTimeout: async ms => { clock += ms; }},
    '@/lib/management-report/whapi': {sendWhapiReport: async (_token, recipient, body) => {
      sends.push({recipient, elapsedMs: clock - started, bodyLength: body.length}); clock += providerMs;
      const transport = recipient === rosley ? digestOutcome : outcome;
      return {state: transport, providerId: transport === 'accepted' ? `synthetic-provider-${sends.length}` : null,
        httpStatus: transport === 'accepted' ? 200 : null, errorCode: transport === 'accepted' ? null : 'delivery_uncertain'};
    }}});
  const service = load('lib/rental-collection/service.ts');
  const route = makeLoader({'@/lib/rental-collection/service': {runRentalCollections: () => service.runRentalCollections(now)}})('app/api/rental-collections/route.ts');
  return {calls, sends, run: () => service.runRentalCollections(now),
    runRoute: () => route.GET(new Request('https://example.invalid/api/rental-collections', {headers: {authorization: 'Bearer synthetic-capacity-cron'}})),
    summary: () => ({
    simulated: true, providerClearance: false, tenantCount: tenants, scanMs, rpcMs, providerMs,
    elapsedMs: clock - started, tenantSends: sends.filter(row => row.recipient !== rosley).length,
    digestSends: sends.filter(row => row.recipient === rosley).length, runState,
  })};
}

// Counts supplied by the read-only 28 October coverage reviews: 8 financially
// clear accounts at 15:40 MYT (9 at 12:13); 32 reminder-stage identified accounts.
// NONE are currently consented/cleared for actual sends. These synthetic opted-in
// fixtures only characterize a future cleared cohort, not activation clearance.
for (const tenants of [8, 9, 32]) test(`simulated ${tenants}-account cohort completes tenant and digest services with assumed 1s transport`, async t => {
  const model = scenario({tenants}); const result = await model.run(), stats = model.summary();
  assert.equal(result.state, 'complete'); assert.equal(result.followUpReport.state, 'accepted');
  assert.equal(stats.tenantSends, tenants); assert.equal(stats.digestSends, 1); assert.equal(stats.runState, 'complete');
  assert(stats.elapsedMs < 280000); assert.equal(model.calls[0].name, 'dekez_collection_scan');
  t.diagnostic(JSON.stringify(stats));
});

test('a completed tenant batch with a budget-withheld digest is an explicit incomplete HTTP503, not successful cron', async t => {
  const model = scenario({tenants: 32, providerMs: 2500});
  const response = await model.runRoute(), result = await response.json(), stats = model.summary();
  assert.equal(response.status, 503); assert.equal(result.state, 'incomplete'); assert.equal(stats.tenantSends, 32);
  assert.equal(result.tenantState, 'complete'); assert.equal(stats.runState, 'complete');
  assert.equal(result.reason, 'followup_review_required'); assert.equal(result.followUpNeedsReview, true);
  assert.equal(result.followUpReport.state, 'budget_review_required'); assert.equal(stats.digestSends, 0);
  assert.equal(model.calls.some(row => row.name === 'dekez_collection_failure_claim'), false);
  assert(stats.elapsedMs > 110000 && stats.elapsedMs < 280000);
  t.diagnostic(JSON.stringify(stats));
});

test('digest transport failure or database failure is visible without altering completed tenant results or retrying', async () => {
  for (const [setting, expected] of [[{digestOutcome: 'uncertain'}, 'uncertain'], [{digestOutcome: 'rejected'}, 'rejected'], [{digestError: true}, 'review_required']]) {
    const model = scenario({tenants: 9, ...setting}); const response = await model.runRoute(), result = await response.json();
    assert.equal(response.status, 503); assert.equal(result.state, 'incomplete'); assert.equal(result.tenantState, 'complete');
    assert.equal(result.reason, 'followup_review_required'); assert.equal(result.followUpReport.state, expected);
    assert.equal(result.followUpNeedsReview, true); assert.equal(model.summary().tenantSends, 9);
    assert.equal(model.summary().digestSends, setting.digestError ? 0 : 1); assert.equal(model.summary().runState, 'complete');
  }
});

test('recipient and source review holds cannot be mistaken for successful combined completion', async () => {
  for (const digestClaimState of ['withheld', 'source_changed', 'daily_review_incomplete']) {
    const model = scenario({tenants: 9, digestClaimState}); const response = await model.runRoute(), result = await response.json();
    assert.equal(response.status, 503); assert.equal(result.tenantState, 'complete'); assert.equal(result.state, 'incomplete');
    assert.equal(result.followUpReport.state, digestClaimState); assert.equal(model.summary().digestSends, 0);
  }
});

test('a settled duplicate management reservation does not reopen sending or mark the combined run incomplete', async () => {
  const model = scenario({tenants: 9}); const first = await model.runRoute(); assert.equal(first.status, 200);
  const response = await model.runRoute(), result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.state, 'already_processed');
  assert.equal(result.followUpReport.state, 'already_reserved'); assert.equal(result.followUpNeedsReview, false);
  assert.equal(model.summary().tenantSends, 9); assert.equal(model.summary().digestSends, 1);
});

test('oversized simulated volume fails closed and a repeated invocation cannot resend reserved tenants', async t => {
  const model = scenario({tenants: 200}); const result = await model.run(), before = model.summary();
  assert.equal(result.state, 'incomplete'); assert.equal(result.reason, 'budget_review_required');
  assert.equal(result.followUpReport.state, 'budget_review_required'); assert.equal(before.runState, 'incomplete');
  assert(before.tenantSends > 0 && before.tenantSends < before.tenantCount); assert.equal(before.digestSends, 0);
  assert(before.elapsedMs < 280000); assert.equal(new Set(model.sends.map(row => row.recipient)).size, before.tenantSends);
  const replay = await model.run(); assert.equal(replay.state, 'already_processed');
  assert.equal(model.summary().tenantSends, before.tenantSends); assert(model.summary().digestSends <= 1);
  t.diagnostic(JSON.stringify({...before, replayTenantSends: model.summary().tenantSends,
    note: 'Repeat protection here is the mocked ledger contract; independent PostgreSQL tests prove atomic storage.'}));
});

test('simulated uncertain provider response stops the tenant batch and is not retried automatically', async t => {
  const model = scenario({tenants: 30, providerMs: 15000, outcome: 'uncertain'}); const result = await model.run(), stats = model.summary();
  assert.equal(result.state, 'uncertain'); assert.equal(stats.tenantSends, 1); assert.equal(stats.runState, 'incomplete');
  assert.equal(model.calls.filter(row => row.name === 'dekez_collection_claim').length, 1);
  assert.equal(model.calls.filter(row => row.name === 'dekez_collection_finish').length, 1);
  t.diagnostic(JSON.stringify(stats));
});

// JV rule (24 Nov 2026): once a tenant is checked out they can no longer log
// in; moving in again restores access; staff are never affected. No live services.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, fakeAdmin, loader } = require('./ttlock-test-helpers.cjs');

const rules = require('../lib/auth/tenant-login-rules.ts');

test('decision: current tenancy keeps access, checkout history without one is refused', () => {
  const ended = { status: 'ended', checkout_date: '2026-11-20' };
  const active = { status: 'active', checkout_date: null };
  const draft = { status: 'draft', checkout_date: null };
  assert.equal(rules.decideTenantLoginAccess({ role: 'tenant', tenancies: [ended] }), 'tenancy_ended');
  assert.equal(rules.decideTenantLoginAccess({ role: 'tenant', tenancies: [ended, active] }), 'allowed');
  assert.equal(rules.decideTenantLoginAccess({ role: 'tenant', tenancies: [ended, draft] }), 'allowed');
  // Checked out but status left active is still not current.
  assert.equal(rules.decideTenantLoginAccess({ role: 'tenant', tenancies: [{ status: 'active', checkout_date: '2026-11-01' }] }), 'tenancy_ended');
  // Applicants who never had a tenancy keep the registration flow.
  assert.equal(rules.decideTenantLoginAccess({ role: 'tenant', tenancies: [] }), 'allowed');
  assert.equal(rules.decideTenantLoginAccess({ role: 'tenant', tenancies: [{ status: 'cancelled', checkout_date: null }] }), 'allowed');
  // Revoke marker with no current tenancy is refused.
  assert.equal(rules.decideTenantLoginAccess({ role: 'tenant', tenancies: [], revokedMarker: true }), 'tenancy_ended');
});

test('staff, admin and owner accounts are never affected', () => {
  for (const role of ['super_admin', 'admin', 'owner', 'client_owner', 'technician', null]) {
    assert.equal(rules.decideTenantLoginAccess({ role, tenancies: [{ status: 'ended', checkout_date: '2026-01-01' }], revokedMarker: true }), 'allowed');
  }
});

test('early checkout and contract end helpers', () => {
  assert.equal(rules.isEarlyCheckout('2026-11-24', '2027-05-31'), true);
  assert.equal(rules.isEarlyCheckout('2026-11-24', '2026-11-24'), false);
  assert.equal(rules.isEarlyCheckout('2026-11-24', null), false);
  assert.equal(rules.contractEndOf({ tenancy_end_date: null, contract_end: '2027-01-31', end_date: '2026-12-31' }), '2027-01-31');
  assert.equal(rules.isBannedNow('2126-01-01T00:00:00Z'), true);
  assert.equal(rules.isBannedNow(null), false);
  assert.equal(rules.isBannedNow('2020-01-01T00:00:00Z'), false);
  assert.equal(rules.TENANCY_ENDED_MESSAGE, 'Your tenancy has ended. Please contact Dekez.');
  assert.equal(rules.isMissingCheckoutLoginSchema({ code: '42703', message: 'column tenancies.checked_out_at does not exist' }), true);
  assert.equal(rules.isMissingCheckoutLoginSchema({ code: '23505', message: 'duplicate' }), false);
});

function authFake({ role = 'tenant', profileRole = 'tenant', tenancies = [], bannedUntil = null }) {
  const { client, writes } = fakeAdmin({
    profiles: [{ role: profileRole }],
    tenants: [{ id: 'tenant-1' }],
    tenancies,
  });
  const authUpdates = [];
  const rpcCalls = [];
  client.rpc = async (name, args) => { rpcCalls.push({ name, args }); return { data: 1, error: null }; };
  client.auth = {
    admin: {
      getUserById: async (id) => ({ data: { user: { id, app_metadata: { role }, user_metadata: { full_name: 'X' }, banned_until: bannedUntil } }, error: null }),
      updateUserById: async (id, attrs) => { authUpdates.push({ id, attrs }); return { data: {}, error: null }; },
      deleteUser: async () => { throw new Error('must never hard-delete a tenant'); },
    },
  };
  return { client, writes, authUpdates, rpcCalls };
}

function loadAccess(client) {
  return loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => client },
  })('lib/auth/tenant-login-access.ts');
}

test('checkout revoke bans the tenant login and signs out its sessions (no delete)', async () => {
  const fake = authFake({ tenancies: [{ status: 'ended', checkout_date: '2026-11-24' }] });
  const access = loadAccess(fake.client);
  const status = await access.revokeTenantLogin({ profileId: 'p1', tenancyId: 't1', reason: 'checkout' });
  assert.equal(status, 'revoked');
  assert.equal(fake.authUpdates.length, 1);
  assert.equal(fake.authUpdates[0].attrs.ban_duration, '876000h');
  assert.ok(fake.authUpdates[0].attrs.user_metadata.checkout_login_revoked_at);
  assert.deepEqual(fake.rpcCalls.map((c) => c.name), ['revoke_tenant_auth_sessions']);
  assert.equal(fake.writes.length, 0, 'no tenant, tenancy, bill or payment row is written');
});

test('revoke keeps a tenant who still has an active or upcoming tenancy', async () => {
  for (const current of [{ status: 'active', checkout_date: null }, { status: 'draft', checkout_date: null }]) {
    const fake = authFake({ tenancies: [{ status: 'ended', checkout_date: '2026-10-01' }, current] });
    const access = loadAccess(fake.client);
    assert.equal(await access.revokeTenantLogin({ profileId: 'p1', reason: 'checkout' }), 'kept_for_current_tenancy');
    assert.equal(fake.authUpdates.length, 0);
  }
});

test('revoke never touches staff or admin accounts', async () => {
  for (const [role, profileRole] of [['admin', 'admin'], ['super_admin', 'super_admin'], ['tenant', 'admin']]) {
    const fake = authFake({ role, profileRole, tenancies: [{ status: 'ended', checkout_date: '2026-10-01' }] });
    const access = loadAccess(fake.client);
    assert.equal(await access.revokeTenantLogin({ profileId: 'p1', reason: 'checkout' }), 'not_tenant');
    assert.equal(fake.authUpdates.length, 0);
  }
});

test('moving in again lifts the checkout ban automatically', async () => {
  const fake = authFake({ bannedUntil: '2126-01-01T00:00:00Z', tenancies: [{ status: 'ended', checkout_date: '2026-08-01' }, { status: 'active', checkout_date: null }] });
  const access = loadAccess(fake.client);
  assert.equal(await access.restoreTenantLoginIfCurrent('p1'), 'restored');
  assert.equal(fake.authUpdates[0].attrs.ban_duration, 'none');
  assert.equal(fake.authUpdates[0].attrs.user_metadata.checkout_login_revoked_at, null);

  const stillOut = authFake({ bannedUntil: '2126-01-01T00:00:00Z', tenancies: [{ status: 'ended', checkout_date: '2026-08-01' }] });
  assert.equal(await loadAccess(stillOut.client).restoreTenantLoginIfCurrent('p1'), 'no_current_tenancy');
  assert.equal(stillOut.authUpdates.length, 0);

  const notBanned = authFake({ tenancies: [{ status: 'active', checkout_date: null }] });
  assert.equal(await loadAccess(notBanned.client).restoreTenantLoginIfCurrent('p1'), 'not_banned');
});

test('guard decision reads the tenant tenancies and fails open on lookup error', async () => {
  const fake = authFake({ tenancies: [{ status: 'ended', checkout_date: '2026-11-24' }] });
  const lookup = require('../lib/auth/tenant-login-lookup.ts');
  assert.equal(await lookup.getTenantLoginDecision({ profileId: 'p1', role: 'tenant', admin: fake.client }), 'tenancy_ended');
  assert.equal(await lookup.getTenantLoginDecision({ profileId: 'p1', role: 'admin', admin: fake.client }), 'allowed');
  const broken = fakeAdmin({ tenants: () => ({ data: null, error: { message: 'down' } }) }).client;
  const originalError = console.error; console.error = () => {};
  try {
    assert.equal(await lookup.getTenantLoginDecision({ profileId: 'p1', role: 'tenant', admin: broken }), 'allowed');
  } finally { console.error = originalError; }
});

test('checkout ends the tenancy at once, records the date, keeps the contract end and revokes login', () => {
  const src = read('lib/tenancy/checkout.ts');
  assert.match(src, /status: "ended",\n\s+checkout_date: checkoutDate/);
  assert.match(src, /checked_out_at: new Date\(\)\.toISOString\(\)/);
  assert.match(src, /contract_end_before_checkout: contractEndBeforeCheckout/);
  assert.match(src, /tenancy_end_date,contract_end,end_date/);
  assert.match(src, /checkedOutTenancy\.status !== "ended"/);
  // TTLock: passcodes, fingerprints and eKeys before the tenancy ends; meter off after.
  const lock = src.indexOf('revokeEKeyAccessForTenancy(tenancy.id');
  const end = src.indexOf('status: "ended"');
  const meter = src.indexOf('cutRoomMeterPowerAfterCheckout(');
  const login = src.indexOf('revokeTenantLogin({');
  assert.ok(lock > 0 && lock < end && end < meter && meter < login);
  assert.match(src, /revokeTenantSessions\(tenant\?\.profile_id/);
  assert.match(src, /login_revoke: loginRevoke/);
  assert.match(src, /early_checkout: earlyCheckout/);
});

test('every tenant page, action and API is guarded server-side', () => {
  const session = read('lib/auth/session.ts');
  assert.match(session, /role === "tenant"[\s\S]*getTenantLoginDecision/);
  assert.match(session, /redirect\("\/tenancy-ended"\)/);
  const middleware = read('lib/supabase/middleware.ts');
  assert.match(middleware, /isProtectedRoute \|\| path\.startsWith\("\/api\/"\)/);
  assert.match(middleware, /TENANCY_ENDED_MESSAGE \}, \{ status: 403 \}/);
  const signIn = read('app/auth/sign-in/route.ts');
  assert.match(signIn, /restoreTenantLoginIfCurrent\(profileLookup\.id\)/);
  assert.match(signIn, /import\("@\/lib\/auth\/tenant-login-access"\)/);
  assert.match(signIn, /await supabase\.auth\.signOut\(\);\n\s+return responseWithCookies\(\{ error: TENANCY_ENDED_MESSAGE \}/);
  const page = read('app/tenancy-ended/page.tsx');
  assert.doesNotMatch(page, /getOptionalUserAccess|requireRole|getCurrentUser/);
  assert.match(read('lib/tenancy/convert-application.ts'), /restoreTenantLoginIfCurrent\(application\.tenant_id/);
});

test('migration is additive and the session RPC is service-role only', () => {
  const sql = read('supabase/migrations/20261124120000_checkout_revokes_tenant_login.sql');
  assert.match(sql, /add column if not exists checked_out_at timestamptz/);
  assert.match(sql, /add column if not exists contract_end_before_checkout date/);
  assert.match(sql, /profile\.role::text = 'tenant'/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
  assert.doesNotMatch(sql, /delete from public\.|drop table|update public\./i);
});

test('staff views show the actual checkout date and an early checkout label', () => {
  assert.match(read('components/dashboard/tenant-checkout-history.tsx'), /Early checkout/);
  const room = read('app/properties/[id]/rooms/[roomId]/page.tsx');
  assert.match(room, /Previous Tenancies/);
  assert.match(room, /Early checkout/);
});

test('middleware refuses a checked-out tenant on portal pages and APIs, not staff', async () => {
  const { NextRequest } = require('next/server');
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key-only';
  function middleware(role, decision) {
    const profile = { role, registration_status: 'approved' };
    const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: profile }), then(ok) { return Promise.resolve({ data: [] }).then(ok); } };
    const checks = [];
    return {
      checks,
      fn: loader({
        '@supabase/ssr': { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'id', app_metadata: { role }, user_metadata: {} } } }) }, from: () => query }) },
        '@/lib/supabase/config': { normalizeSupabaseUrl: (x) => x },
        '@/lib/auth/tenant-login-lookup': { getTenantLoginDecision: async (input) => { checks.push(input); return decision; } },
      })('lib/supabase/middleware.ts').updateSession,
    };
  }
  const ended = middleware('tenant', 'tenancy_ended');
  const page = await ended.fn(new NextRequest('https://dekez.test/payments'));
  assert.match(page.headers.get('location'), /\/tenancy-ended$/);
  const api = await ended.fn(new NextRequest('https://dekez.test/api/dekez-chat', { method: 'POST' }));
  assert.equal(api.status, 403);
  assert.equal((await api.json()).error, 'Your tenancy has ended. Please contact Dekez.');

  const current = middleware('tenant', 'allowed');
  const ok = await current.fn(new NextRequest('https://dekez.test/payments'));
  assert.equal(ok.headers.get('location'), null);

  const staff = middleware('admin', 'tenancy_ended');
  await staff.fn(new NextRequest('https://dekez.test/dashboard'));
  assert.equal(staff.checks.length, 0, 'staff sessions never run the tenant check');
});

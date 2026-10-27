const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const loader = require('./marketplace-component-loader.cjs');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const source = read('lib/ttlock/fingerprint.ts');
function section(start, end) {
  const first = source.indexOf(start), last = end ? source.indexOf(end, first) : source.length;
  assert(first >= 0 && last > first, 'Expected reviewed source boundaries');
  return source.slice(first, last).trim();
}

test('retained arrears-suspension entrypoint performs no database, lock or messaging operation', async () => {
  const calls = [];
  const forbidden = name => () => { calls.push(name); throw Error('Unexpected external operation'); };
  const module = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: forbidden('database') },
    '@/lib/ttlock/client': {
      changeTTLockFingerprintPeriod: forbidden('change period'),
      deleteTTLockFingerprint: forbidden('delete fingerprint'),
      listTTLockFingerprints: forbidden('list fingerprints'),
    },
    '@/lib/whatsapp/config': { normalizePhoneNumber: forbidden('phone processing') },
    '@/lib/whatsapp/meta': { sendWhatsAppText: forbidden('message') },
  })('lib/ttlock/fingerprint.ts');
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await module.suspendOverdueFingerprintAccess(), {
      created: 0, matched: 0, extended: 0, suspended: 0, revoked: 0, skipped: 0, errors: [],
    });
  }
  assert.deepEqual(calls, []);
});

test('dormant arrears helper cannot shorten access even if a caller is accidentally restored', () => {
  const helper = section('export async function suspendOverdueFingerprintAccess(', 'export async function revokeFingerprintAccessForTenancy(');
  assert.doesNotMatch(helper, /createAdminClient|changeTTLock|deleteTTLock|sendWhatsApp|\.from\(|Date\.now|rent_bills/);
  assert.match(helper, /management-review matter/);
});

test('enrollment and Admin copy no longer promise rent-based physical lockout', () => {
  assert.doesNotMatch(source, /entry access may be suspended until payment|suspended because rent|suspended_for_overdue_rent/);
  assert.match(source, /Rental reminders do not authorize automatic door-access suspension/);
  const page = read('app/smart-devices/page.tsx');
  assert.doesNotMatch(page, /Seven days overdue with no pending slip suspends entry/);
  assert.match(page, /Existing credential expiry still needs separate access-policy review/);
});

// These regression guards deliberately require an explicit, separately reviewed
// access-policy change before the payment/expiry or legitimate checkout code can
// be altered. This reminder-only change must not modify those behaviors.
test('existing fingerprint periods, payment extensions and checkout revocation are unchanged', () => {
  assert.equal(hash(section('function accessPeriod(', 'function tenantAccessName(')), 'a6b8d5a5210103b7c827b793cfc26a3a3a9fd33630e9bc2bb27f99bb904b7bbe');
  assert.equal(hash(section('export async function extendFingerprintAccessAfterPayment(', 'export async function suspendOverdueFingerprintAccess(')), 'abc6ee190028c7dfe7c4ee0f5f68eb02d4dcd44f771308eba51d5a6d04fe1bcd');
  assert.equal(hash(section('export async function revokeFingerprintAccessForTenancy(', null)), 'a56f33597c795cdf7a7974b0e06e9a514da8501cde19b24487a98ca6aa75306c');
});

test('passcode provisioning and legitimate tenancy checkout paths are unchanged', () => {
  assert.equal(hash(read('lib/ttlock/access.ts')), '6f3a7c7dae3e4088fe345870d7040a22ae3b934c57dbcf86bd508ccc35da1f39');
  assert.equal(hash(read('lib/tenancy/checkout.ts')), 'efa6d3228271f0a0cc3c5056557a06cad8db9dfdba15a3f459f15f7cf172db6d');
});

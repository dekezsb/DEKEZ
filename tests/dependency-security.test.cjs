// Dependency-upgrade regressions only: real image/PDF libraries and Next
// request/response handling, synthetic sessions, no network or live records.
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { PDFDocument, PDFName } = require('pdf-lib');
const { NextRequest } = require('next/server');
const loader = require('./marketplace-component-loader.cjs');
const { validateChatFile } = loader()('lib/chat/files.ts');
const { createArchivePdf } = loader()('lib/archive/pdf.ts');

for (const format of ['jpeg', 'png', 'webp']) {
  test(`patched image dependencies preserve ${format} decoding, resize and metadata removal`, async () => {
    const input = await sharp({ create: { width: 2500, height: 125, channels: 3, background: '#b78a31' } })
      .withMetadata({ orientation: 1 }).toFormat(format).toBuffer();
    assert.ok((await sharp(input).metadata()).exif, 'fixture must contain metadata before stripping');
    const result = await validateChatFile(input, `fixture.${format}`);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(result.mime, 'image/webp');
    assert.equal(result.name, 'fixture.webp');
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 2400);
    assert.equal(metadata.height, 120);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.match(result.digest, /^[0-9a-f]{64}$/);
  });
}

test('image orientation is applied and small chat images are not enlarged', async () => {
  const input = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#87621e' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.equal((await sharp(input).metadata()).orientation, 6);
  const result = await validateChatFile(input, 'rotated.jpg');
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.width, 16);
  assert.equal(metadata.height, 32);
  assert.equal(metadata.orientation, undefined);
});

test('chat image decoder continues rejecting SVG and malformed raster signatures', async () => {
  const malformed = [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
    Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from('RIFF0000WEBPbad'),
  ];
  for (const bytes of malformed) await assert.rejects(validateChatFile(bytes, 'pretend.jpg'));
});

test('archive PDF still embeds benign WebP through its real sharp fallback', async () => {
  const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#ae893e' } })
    .webp().toBuffer();
  const result = await createArchivePdf({
    title: 'TEST ARCHIVE',
    sections: [{ heading: 'Synthetic fixture', rows: [['Reference', 'LOCAL-ONLY']] }],
    attachments: [{ label: 'Benign image', fileName: 'fixture.webp', contentType: 'image/webp', bytes }],
  });
  const document = await PDFDocument.load(result);
  assert.equal(document.getPageCount(), 3, 'cover, attachment separator and image page');
  const resources = document.getPage(2).node.Resources();
  const objects = resources.lookup(PDFName.of('XObject'));
  assert.ok(objects.keys().length > 0, 'archive contains an embedded image, not just a fallback error');
});

const environmentKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'DEKEZ_CHAT_ENABLED'];
const originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
test.before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://dependency-fixture.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-only';
  process.env.DEKEZ_CHAT_ENABLED = 'false';
});
test.after(() => {
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

function session(role, { status = 'approved', permissions = [], claimRole = role, expired = false } = {}) {
  const supabase = {
    auth: { getClaims: async () => {
      if (expired) throw Error('Synthetic expired session');
      return { data: { claims: role ? { sub: 'fixture-user', app_metadata: { role: claimRole } } : null } };
    } },
    from: table => {
      assert.ok(['profiles', 'user_module_permissions'].includes(table), `Unexpected query: ${table}`);
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, registration_status: status } }) }) }) };
      return { select: () => ({ eq: async () => ({ data: permissions }) }) };
    },
  };
  return loader({
    '@supabase/ssr': { createServerClient: () => supabase },
    '@/lib/supabase/config': { normalizeSupabaseUrl: value => value },
  })('lib/supabase/middleware.ts').updateSession;
}

const contractorHome = '/admin/marketplace/contractor-preview/dashboard';
const cases = [
  ['super_admin', ['/super-admin', '/admin-setup', '/reports', '/payments'], ['/owner/home'], '/dashboard'],
  ['admin', ['/dashboard', '/claims', '/rent-due-tracker', '/reports'], ['/admin-setup', '/owner/home'], '/dashboard'],
  ['owner', ['/dashboard', '/reports', '/payments'], ['/admin-setup', '/owner/home'], '/dashboard'],
  ['client_owner', ['/owner/home', '/owner/finance'], ['/dashboard', '/reports', '/admin-setup'], '/owner/home'],
  ['tenant', ['/dashboard', '/payments', '/maintenance', '/tenant/profile'], ['/reports', '/admin-setup', '/owner/home'], '/dashboard'],
  ['technician', ['/dashboard', '/maintenance', '/expenses'], ['/reports', '/payments', '/admin-setup'], '/dashboard'],
  ['maintenance_staff', ['/dashboard', '/maintenance', '/claims'], ['/reports', '/payments', '/admin-setup'], '/dashboard'],
  ['cleaning_staff', ['/dashboard', '/maintenance', '/expenses'], ['/reports', '/payments', '/admin-setup'], '/dashboard'],
  ['contractor_preview', [contractorHome, '/admin/marketplace/contractor-preview/profile'], ['/dashboard', '/reports', '/owner/home'], contractorHome],
];

for (const [role, allowed, denied, redirect] of cases) {
  test(`Next request handling preserves existing ${role} portal boundaries`, async () => {
    const handle = session(role);
    for (const path of allowed) {
      const response = await handle(new NextRequest('https://fixture.invalid' + path));
      assert.equal(response.status, 200, `${role}: ${path}`);
      assert.equal(response.headers.get('location'), null, `${role}: ${path}`);
    }
    for (const path of denied) {
      const response = await handle(new NextRequest('https://fixture.invalid' + path));
      assert.equal(response.status, 307, `${role}: ${path}`);
      assert.equal(new URL(response.headers.get('location')).pathname, redirect, `${role}: ${path}`);
    }
    if (role === 'contractor_preview') {
      assert.equal((await handle(new NextRequest('https://fixture.invalid/payments', { method: 'POST' }))).status, 403);
    }
  });
}

test('signed-out and expired sessions cannot enter protected portal pages', async () => {
  for (const handle of [session(null), session('tenant', { expired: true })]) {
    for (const path of ['/dashboard', '/owner/home', '/admin-setup', '/reports', '/payments', '/staff/profile']) {
      const response = await handle(new NextRequest('https://fixture.invalid' + path));
      assert.equal(response.status, 307);
      const destination = new URL(response.headers.get('location'));
      assert.equal(destination.pathname, '/');
      assert.equal(destination.searchParams.get('redirectedFrom'), path);
    }
  }
});

test('pending account profiles remain blocked across all portal roles', async () => {
  for (const [role, allowed] of cases) {
    const response = await session(role, { status: 'pending' })(new NextRequest('https://fixture.invalid' + allowed[0]));
    assert.equal(response.status, 307, role);
    assert.equal(new URL(response.headers.get('location')).pathname,
      role === 'contractor_preview' ? '/login/contractor' : '/registration-status', role);
  }
});

test('tenant permission rows and stale elevated claims cannot grant accounting or Admin access', async () => {
  const handle = session('tenant', {
    claimRole: 'super_admin',
    permissions: [{ module_key: 'reports', access_level: 'manage' }, { module_key: 'admin_setup', access_level: 'manage' }],
  });
  for (const path of ['/reports', '/admin-setup']) {
    const response = await handle(new NextRequest('https://fixture.invalid' + path));
    assert.equal(response.status, 307);
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, '/dashboard');
    assert.equal(destination.searchParams.get('error'), 'access_denied');
  }
});

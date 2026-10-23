const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const makeLoader = require('./marketplace-component-loader.cjs');
const load = makeLoader();
const { ContractorPortal } = load('components/marketplace/contractor-portal.tsx');
const model = load('lib/marketplace/portal.ts');

test('all 13 foundation sections render with honest unavailable state and five mobile tabs', () => {
  for (const section of model.contractorSections) {
    const html = renderToStaticMarkup(React.createElement(ContractorPortal, { section }));
    assert.ok(html.includes(model.sectionTitles[section].replaceAll('&', '&amp;')), section);
    assert.match(html, /Foundation preview/);
    assert.match(html, /Live records, uploads and payments are not connected/);
    assert.doesNotMatch(html, /<form|<input|<button|4\.8\s*\/\s*5|RM\s*199|CS Renovation/);
    const nav = html.match(/<nav class="bottomNav"[^>]*>(.*?)<\/nav>/s)[1];
    assert.equal((nav.match(/<a /g) || []).length, 5);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
    for (const match of html.matchAll(/<a\b[^>]*href="([^"#]+)"/g)) {
      if (match[1] === '/admin/marketplace') continue;
      assert.ok(match[1].startsWith(model.contractorPreviewPath + '/'));
      assert.ok(model.contractorSection(match[1].slice(model.contractorPreviewPath.length + 1)), match[1]);
    }
  }
});

test('all marketplace route entry points authenticate server-side before rendering', async () => {
  for (const file of [
    'app/admin/marketplace/layout.tsx', 'app/admin/marketplace/page.tsx',
    'app/admin/marketplace/contractor-preview/[[...segments]]/page.tsx',
  ]) {
    const calls = [];
    const page = makeLoader({
      '@/lib/auth/session': { requireRole: async roles => { calls.push(roles); throw Error('DENIED'); } },
      'next/navigation': { notFound() { throw Error('NOT_FOUND'); }, redirect() { throw Error('REDIRECT'); } },
    })(file).default;
    await assert.rejects(() => page({ children: 'protected', params: Promise.resolve({ segments: ['dashboard'] }) }), /DENIED/);
    assert.deepEqual(calls, [file === 'app/admin/marketplace/page.tsx' ? ['super_admin'] : ['super_admin', 'contractor_preview']]);
  }
});

test('preview validates requested sections and redirects only to its own dashboard', async () => {
  const page = makeLoader({
    '@/lib/auth/session': { requireRole: async roles => { assert.deepEqual(roles, ['super_admin', 'contractor_preview']); return 'contractor_preview'; } },
    'next/navigation': { notFound() { throw Error('NOT_FOUND'); }, redirect(url) { throw Error('REDIRECT:' + url); } },
  })('app/admin/marketplace/contractor-preview/[[...segments]]/page.tsx').default;
  await assert.rejects(() => page({ params: Promise.resolve({}) }), /REDIRECT:\/admin\/marketplace\/contractor-preview\/dashboard/);
  for (const segments of [['unknown'], ['..', 'tenants'], ['profile', 'secrets']]) {
    await assert.rejects(() => page({ params: Promise.resolve({ segments }) }), /NOT_FOUND/);
  }
  const element = await page({ params: Promise.resolve({ segments: ['profile', 'services'] }) });
  assert.equal(element.props.section, 'profile/services');
  assert.equal(element.props.pilot, true);
});

test('pilot has logout on desktop/mobile and no management link or fake business records', () => {
  const html = renderToStaticMarkup(React.createElement(ContractorPortal, {section:'dashboard',pilot:true}));
  assert.match(html,/restricted test access/);
  assert.match(html,/action="\/logout" method="post"/);
  assert.doesNotMatch(html,/href="\/admin\/marketplace"|Admin preview|Back to management/);
});

test('shell uses fluid content, one primary navigation, safe areas and scoped styles', () => {
  const css = fs.readFileSync('components/marketplace/contractor-portal.module.css', 'utf8');
  assert.match(css, /\.main \{ width:100%; min-width:0; max-width:none/);
  assert.match(css, /\.sidebar \{ display:none/);
  assert.match(css, /min-width:1024px/);
  assert.match(css, /\.bottomNav \{ display:none/);
  assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-top/);
  assert.doesNotMatch(css, /zoom:|scale\(|overflow-x:hidden/);
  const shell = fs.readFileSync('components/app-shell.tsx', 'utf8');
  assert.match(shell, /pathname === "\/admin\/marketplace\/contractor-preview"/);
  assert.match(shell, /pathname\.startsWith\("\/admin\/marketplace\/contractor-preview\/"\)/);
});

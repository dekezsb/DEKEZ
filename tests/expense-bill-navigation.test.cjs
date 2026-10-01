const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), resolve = Module._resolveFilename, load = Module._load;
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
let context;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args); };
Module._load = function(request, ...args) {
  if (request === '@/lib/auth/session') return { getCurrentUserAccess: async () => context };
  if (request === '@/components/app-link') return { Link: ({ children, ...props }) => React.createElement('a', props, children) };
  return load.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: f }).outputText, f);
const { roleNavigation } = require('../lib/auth/roles.ts');
const { getRoleDefaultAccess, hasModuleAccess, moduleForPath } = require('../lib/auth/access.ts');
const { consolidateBillNavigation, navigationItemIsActive } = require('../lib/navigation/expense-bills.ts');
const { BillSections } = require('../components/expenses/bill-sections.tsx');
const navigation = (role, access) => consolidateBillNavigation(roleNavigation[role].filter(item => hasModuleAccess(access, item.module)));

test('one Expense Bills entry replaces the two sidebar entries without removing other navigation', () => {
  for (const role of ['super_admin', 'owner']) {
    const access = getRoleDefaultAccess(role), before = roleNavigation[role].filter(item => hasModuleAccess(access, item.module)), after = navigation(role, access);
    assert.equal(after.filter(item => item.label === 'Expense Bills').length, 1);
    assert.equal(after.find(item => item.label === 'Expense Bills').href, '/expenses');
    assert.ok(!after.some(item => item.label === 'Utility Bills'));
    assert.deepEqual(after.filter(item => item.label !== 'Expense Bills'), before.filter(item => !['/expenses', '/utility-bills'].includes(item.href)));
  }
});
test('utility-only and expense-only permissions retain one accessible destination, neither grants nothing', () => {
  for (const [utilities, expenses, expected] of [['view', 'none', '/utility-bills'], ['none', 'view', '/expenses'], ['none', 'none', null]]) {
    const access = { ...getRoleDefaultAccess('owner'), utility_bills: utilities, expenses };
    const bills = navigation('owner', access).filter(item => item.label === 'Expense Bills');
    assert.equal(bills.length, expected ? 1 : 0);
    if (expected) assert.equal(bills[0].href, expected);
  }
  assert.ok(!navigation('tenant', getRoleDefaultAccess('tenant')).some(item => item.label === 'Expense Bills'));
  assert.equal(moduleForPath('/utility-bills'), 'utility_bills');
  assert.equal(moduleForPath('/expenses'), 'expenses');
});
test('both existing URLs highlight the same bill entry', () => {
  const item = navigation('super_admin', getRoleDefaultAccess('super_admin')).find(item => item.label === 'Expense Bills');
  for (const url of ['/expenses', '/utility-bills']) assert.equal(navigationItemIsActive(item, url), true);
  for (const url of ['/properties', '/expenses-other']) assert.equal(navigationItemIsActive(item, url), false);
});
test('bill sections preserve property filter, highlight selection and respect permissions', async () => {
  context = { role: 'owner', access: getRoleDefaultAccess('owner') };
  let html = renderToStaticMarkup(await BillSections({ active: 'utilities', propertyId: 'property-1' }));
  assert.match(html, /href="\/expenses\?property=property-1"/);
  assert.match(html, /href="\/utility-bills\?property=property-1" aria-current="page"/);
  context.access.expenses = 'none';
  html = renderToStaticMarkup(await BillSections({ active: 'utilities' }));
  assert.doesNotMatch(html, /href="\/expenses"/);
  context = { role: 'technician', access: { ...getRoleDefaultAccess('technician'), expenses: 'view', utility_bills: 'view' } };
  html = renderToStaticMarkup(await BillSections({ active: 'expenses' }));
  assert.match(html, /href="\/expenses"/);assert.doesNotMatch(html, /href="\/utility-bills"/);
});
test('both existing bill pages retain their data and controls; shared shell handles desktop and mobile', () => {
  const expenses = fs.readFileSync(path.join(root, 'app/expenses/page.tsx'), 'utf8');
  const utilities = fs.readFileSync(path.join(root, 'app/utility-bills/page.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'components/app-shell.tsx'), 'utf8');
  assert.match(expenses, /<BillSections active="expenses"/);assert.match(expenses, /\.from\("expenses"\)/);
  assert.match(utilities, /<BillSections active="utilities"/);assert.match(utilities, /\.from\("utility_bills"\)/);assert.match(utilities, /UtilityBillActions/);
  assert.match(shell, /consolidateBillNavigation\(roleNavigation\[role\]\.filter/);
  assert.equal((shell.match(/const isActive = navigationItemIsActive\(item, pathname\)/g) || []).length, 4);
});

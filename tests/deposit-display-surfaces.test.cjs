const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
Module._resolveFilename = function(request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};

const property = { id: 'property', name: 'Test property', property_code: 'TEST' };
const room = { id: 'room', property_id: 'property', room_number: '17', name: '17', status: 'occupied' };
const record = { id: 'record', tenancy_id: 'current', tenant_id: 'tenant', property_id: 'property', room_id: 'room', full_name: 'Current tenant', deposit: 200, status: 'active', due_day: 7 };
const tenancy = { id: 'current', tenant_id: 'tenant', property_id: 'property', room_id: 'room', deposit: 200, monthly_rental: 350, due_day: 7, status: 'active' };
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).format(new Date());
const bill = { id: 'bill', tenancy_id: 'current', tenant_id: 'tenant', tenant_record_id: 'record', property_id: 'property', room_id: 'room', bill_month: `${month}-01`, due_date: `${month}-07`, amount: 350, deposit_amount: 0, paid_amount: 350, status: 'paid', removed_at: null };
let depositPayments = [];
let depositSubmissions = [];
function client() {
  return { from(table) {
    const filters = [];
    const query = {
      select() { return this; }, order() { return this; }, range() { return this; },
      eq(k,v) { filters.push(r => r[k] === v); return this; },
      in(k,v) { filters.push(r => v.includes(r[k])); return this; },
      is(k,v) { filters.push(r => (r[k] ?? null) === v); return this; },
      lt(k,v) { filters.push(r => r[k] < v); return this; },
      gte(k,v) { filters.push(r => r[k] >= v); return this; },
      then(resolve, reject) {
        const tables = { tenancies: [tenancy], tenant_records: [record], rent_bills: [bill],
          tenants: [{id:'tenant',full_name:'Current tenant'}], profiles: [],
          payments: depositPayments, payment_submissions: depositSubmissions };
        return Promise.resolve({ data: (tables[table] ?? []).filter(r => filters.every(f => f(r))), error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
}
Module._load = function(request, ...args) {
  if (request === '@/lib/supabase/admin') return { createAdminClient: client };
  if (request === '@/lib/supabase/server') return { createClient: client };
  if (request === './organization' || request === '@/lib/data/organization') return {
    getProperties: async () => [property], getRooms: async () => [room], getTenantRecords: async () => [record],
  };
  return originalLoad.call(this, request, ...args);
};
const { createTenantDepositLookup } = require('../lib/payments/current-occupant-deposit.ts');
const { getDepositOutstandingSummary } = require('../lib/data/deposit-outstanding.ts');
const { getRentDueMap } = require('../lib/data/rent-due-map.ts');
const payment = (tenancy_id, amount) => ({ tenancy_id, room_id: 'room', property_id: 'property', amount, category: 'deposit', status: 'confirmed' });
const slip = (tenancy_id, tenant_record_id, amount) => ({ tenancy_id, tenant_record_id, room_id: 'room', property_id: 'property', amount, payment_type: 'deposit', verification_status: 'verified' });

test('dashboard and tracker show RM200 deposit owing despite prior tenant deposits and paid rent', async () => {
  depositPayments = [payment('previous', 100), payment('previous', 100)];
  depositSubmissions = [slip('previous', 'old-record', 200)];
  const dashboard = await getDepositOutstandingSummary();
  assert.equal(dashboard.totalOutstanding, 200);
  assert.equal(dashboard.tenantCount, 1);
  assert.equal(dashboard.rows[0].depositReceived, 0);
  const tracker = await getRentDueMap(month);
  const collection = tracker.properties[0].collections[0];
  assert.equal(collection.depositOutstanding, 200);
  assert.equal(collection.outstanding, 0);
  assert.equal(collection.settlementStatus, 'paid');
  assert.equal(tracker.properties[0].rooms[0].depositOutstanding, 200);
  assert.equal(tracker.properties[0].rooms[0].outstanding, 200);
  assert.equal(tracker.properties[0].rooms[0].status, 'partially_paid');
  assert.equal(tracker.summary.totalOutstanding, 0, 'rent totals remain rent-only');
});

test('partial current deposit counts once even with its verified slip', async () => {
  depositPayments = [payment('previous', 200), payment('current', 50)];
  depositSubmissions = [slip('current', 'record', 50)];
  assert.equal((await getDepositOutstandingSummary()).totalOutstanding, 150);
  assert.equal((await getRentDueMap(month)).properties[0].rooms[0].depositOutstanding, 150);
});

test('fully paid current deposit clears both displays, without adding receipt plus slip', async () => {
  depositPayments = [payment('current', 200)];
  depositSubmissions = [slip('current', 'record', 200)];
  assert.equal((await getDepositOutstandingSummary()).tenantCount, 0);
  const view = (await getRentDueMap(month)).properties[0].rooms[0];
  assert.equal(view.depositOutstanding, 0);
  assert.equal(view.status, 'paid');
});

test('legacy slips need current record identity; wrong tenancy and room-only deposits cannot settle it', () => {
  const lookup = createTenantDepositLookup([payment(null,200)], [slip('previous','record',200),slip(null,null,200),slip(null,'record',50)]);
  assert.equal(lookup('current','record'),50);
  assert.equal(lookup(null,'unrelated'),0);
});

test('tenancy-linked deposits remain valid after room transfer and zero canonical total is authoritative', () => {
  assert.equal(createTenantDepositLookup([{...payment('current',100),room_id:'old-room'}],[])('current','record'),100);
  assert.equal(createTenantDepositLookup([payment('current',0)],[slip('current','record',100)])('current','record'),0);
});

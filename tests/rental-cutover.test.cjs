const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./renovation-loader.cjs');
const { generateRecurringRentBills, companyBillingStartDate } = load('lib/billing/rent-billing.ts');
const company = '660cc0c4-daee-445b-9146-ccd112e791d4';
function tenancy(patch = {}) {
  return { id:'t',company_id:company,start_date:'2025-12-15',check_in_date:'2025-12-15',
    tenancy_start_date:'2025-12-15',contract_start:'2025-12-15',contract_end:'2026-12-14',
    monthly_rental:500,deposit:1000,due_day:15,rent_due_day:15,room_id:'r',
    property_id:'p',tenant_id:'tenant',tenants:{profile_id:'profile'},tenant_records:[],
    tenancy_agreements:[],...patch };
}
function mockDb(tenancies, records = [], existing = []) {
  const written = [], reads = [];
  const sources = {tenancies,tenant_records:records,rent_bills:existing};
  return { written,reads,from(table) {
    reads.push(table);
    const filters = [];
    const q = {
      select(){return q;},eq(key,value){filters.push([key,value]);return q;},
      is(){return q;},not(){return q;},
      then(resolve,reject) {
        const rows = table==='rent_bills'
          ? sources[table].filter(r=>filters.every(([k,v])=>r[k]===v))
          : sources[table];
        return Promise.resolve({data:structuredClone(rows),error:null}).then(resolve,reject);
      },
      async insert(rows) {
        assert.equal(table,'rent_bills','No tenant/history writes permitted');
        written.push(...structuredClone(rows));
        return {error:null};
      },
      update(){throw Error('No updates permitted');},
      delete(){throw Error('No deletes permitted');},
      upsert(){throw Error('No history upserts permitted');},
    };
    return q;
  }};
}
test('cutoff is company-scoped and leaves original input date unchanged',()=>{
  const original='2025-12-15';
  assert.equal(companyBillingStartDate(original,company),'2026-03-01');
  assert.equal(original,'2025-12-15');
  assert.equal(companyBillingStartDate(original,'other-company'),original);
  assert.equal(companyBillingStartDate('2026-04-12',company),'2026-04-12');
});
test('15 December tenancy bills from March on the 15th, without a second deposit or tenancy changes',async()=>{
  const t=tenancy(), before=structuredClone(t), db=mockDb([t]);
  const result=await generateRecurringRentBills(db,{currentDate:'2026-03-02'});
  assert.deepEqual(result.errors,[]);
  assert.equal(db.written.length,1);
  assert.equal(db.written[0].bill_month,'2026-03-01');
  assert.equal(db.written[0].due_date,'2026-03-15');
  assert.equal(db.written[0].invoice_date,'2026-03-15');
  assert.equal(db.written[0].deposit_amount,0);
  assert.deepEqual(t,before);
});
test('fallback cycle uses real start day rather than the cutoff day',async()=>{
  const db=mockDb([tenancy({rent_due_day:null,due_day:null})]);
  await generateRecurringRentBills(db,{currentDate:'2026-03-02'});
  assert.equal(db.written[0].due_date,'2026-03-15');
});
test('standalone tenant record retains original contract and recurring cycle',async()=>{
  const r={id:'record',company_id:company,contract_start:'2025-12-15',contract_end:'2026-12-14',
    due_day:20,monthly_rent:500,deposit:1000,room_id:'r',property_id:'p'};
  const before=structuredClone(r),db=mockDb([],[r]);
  await generateRecurringRentBills(db,{currentDate:'2026-03-02'});
  assert.equal(db.written.length,1);
  assert.equal(db.written[0].bill_month,'2026-03-01');
  assert.equal(db.written[0].due_date,'2026-03-20');
  assert.equal(db.written[0].deposit_amount,0);
  assert.deepEqual(r,before);
});
test('a genuine March check-in still gets its original check-in date and deposit',async()=>{
  const db=mockDb([tenancy({check_in_date:'2026-03-18'})]);
  await generateRecurringRentBills(db,{currentDate:'2026-03-19'});
  const march=db.written.find(b=>b.bill_month==='2026-03-01');
  assert.equal(march.due_date,'2026-03-18');
  assert.equal(march.deposit_amount,1000);
});
test('existing March bill is never recreated or overwritten',async()=>{
  const db=mockDb([tenancy()],[],[{tenancy_id:'t',bill_month:'2026-03-01'}]);
  await generateRecurringRentBills(db,{currentDate:'2026-03-02'});
  assert.equal(db.written.length,0);
});
test('no invoices before cutover or for a tenancy ending before it',async()=>{
  for(const [t,currentDate] of [[tenancy(),'2026-02-28'],[tenancy({checkout_date:'2026-02-28'}),'2026-03-02']]){
    const db=mockDb([t]);
    await generateRecurringRentBills(db,{currentDate});
    assert.equal(db.written.length,0);
  }
});

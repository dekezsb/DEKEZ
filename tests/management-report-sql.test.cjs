const test=require('node:test'),assert=require('node:assert/strict');
let db,id;
const asOf='2026-10-25T12:00:00Z';
async function snapshot(company=id(1),date=asOf){return (await db.query('select dekez_management_report_snapshot($1,$2) result',[company,date])).rows[0].result;}
async function claim(kind='daily',company=id(1),recipient='60168173911',actor=null){const s=await snapshot(company);return (await db.query('select dekez_management_report_claim($1,$2,$3,$4,$5,$6,$7) result',[company,s.report_date,recipient,kind,JSON.stringify(s),'Fixture report',actor])).rows[0].result;}
async function finish(a,state='accepted',provider='fixture-message-id'){await db.query('select dekez_management_report_finish($1,$2,$3,$4,$5)',[a.attempt_id,state,provider,state==='accepted'?200:429,state==='accepted'?null:state==='rejected'?'provider_rejected':'delivery_uncertain']);}
test.before(async()=>{db=await require('./fixtures/management-report.cjs')();id=db.id;});
test.after(async()=>db?.close());
test.beforeEach(async()=>{await db.exec('reset role; truncate dekez_reports_private.delivery_attempts,dekez_reports_private.report_runs;');});
test('snapshot uses confirmed receipt dates and counts allocated portions once, excluding parent slip/deposit/reversal/other company/future dates',async()=>{
 const s=await snapshot();assert.equal(s.collected_today,250);assert.equal(s.collected_month,450);assert.equal(s.pending_count,1);assert.equal(s.pending_amount,700);
});
test('invoice extras count once; deposits excluded; one overdue tenant across two bills; due today not overdue',async()=>{
 const s=await snapshot();assert.equal(s.outstanding,600);assert.equal(s.overdue,550);assert.equal(s.overdue_tenants,1);
});
test('cancelled, waived, removed, draft and future invoices do not inflate balances',async()=>{
 for(const [n,status,removed,date] of [[221,'draft',null,'2026-10-01'],[222,'cancelled',null,'2026-10-01'],[223,'waived',null,'2026-10-01'],[224,'unpaid','2026-10-01','2026-10-01'],[225,'unpaid',null,'2026-11-01']]){
  await db.query(`insert into rent_bills(id,property_id,amount,paid_amount,status,removed_at,issued_at,invoice_date,bill_month,due_date) values($1,$2,10000,0,$3,$4,$5::date::timestamptz,$5::date,$5::date,$5::date)`,[id(n),id(10),status,removed,date]);
 }
 assert.equal((await snapshot()).outstanding,600);await db.exec(`delete from rent_bills where id between '${id(221)}' and '${id(225)}'`);
});
test('room statuses and real maintenance urgency remain distinct; cleaning and other-company jobs excluded',async()=>{
 const s=await snapshot();for(const k of ['occupied','vacant','reserved','maintenance_rooms'])assert.equal(s[k],1);
 assert.equal(s.rooms_total,4);assert.equal(s.maintenance_active,2);assert.equal(s.maintenance_urgent,1);assert.equal(s.waiting_for_parts,1);
});
test('Malaysia date changes at 16:00 UTC including monthly boundary',async()=>{
 assert.equal((await snapshot(id(1),'2026-10-24T16:00:00Z')).report_date,'2026-10-25');
 assert.equal((await snapshot(id(1),'2026-10-31T16:00:00Z')).collected_month,0);
 assert.equal((await snapshot(id(1),'2026-10-24T15:59:59Z')).collected_today,0);
});
test('missing invoice context/amount is unavailable rather than invented zero',async()=>{
 await db.exec(`update rent_bills set due_date=null where id='${id(202)}'`);assert.equal((await snapshot()).overdue,null);
 await db.exec(`update rent_bills set due_date='2026-10-21',amount=null where id='${id(202)}'`);assert.equal((await snapshot()).outstanding,null);
 await db.exec(`update rent_bills set amount=100 where id='${id(202)}'`);
});
test('service role can aggregate; anon/authenticated cannot call RPCs or access private tables',async()=>{
 await db.exec('set role service_role');assert.equal((await snapshot()).outstanding,600);await db.exec('reset role');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);
  await assert.rejects(snapshot(),/permission denied/);
  await assert.rejects(db.query('select * from dekez_reports_private.report_runs'),/permission denied/);
  await assert.rejects(db.query('select dekez_management_report_finish(null,null,null,null,null)'),/permission denied/);
  await assert.rejects(db.query("select dekez_management_report_claim(null,null,null,null,null,null,null)"),/permission denied/);
  await db.exec('reset role');
 }
 const r=await db.query("select relrowsecurity from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='dekez_reports_private' and c.relkind='r'");assert.ok(r.rows.every(x=>x.relrowsecurity));
});
test('concurrent claims only reserve one send and accepted date never sends again',async()=>{
 const results=await Promise.all([claim(),claim(),claim()]);assert.equal(results.filter(x=>x.claimed).length,1);
 const a=results.find(x=>x.claimed);await finish(a);assert.equal((await claim()).state,'accepted');
 assert.equal((await db.query('select count(*)::int n from dekez_reports_private.delivery_attempts')).rows[0].n,1);
});
test('crashed/ambiguous delivery cannot be reclaimed; history preserved',async()=>{
 const a=await claim();await db.exec("update dekez_reports_private.delivery_attempts set started_at=now()-interval '6 minutes'");
 assert.equal((await claim()).state,'uncertain');assert.equal((await claim()).claimed,false);
 await assert.rejects(finish(a),/already finalized/);
});
test('explicit rejection has cooldown and at most three attempts; stored body stays immutable',async()=>{
 for(let n=1;n<=3;n++){const a=await claim();assert.equal(a.claimed,true);await finish(a,'rejected',null);
  assert.equal((await claim()).claimed,false);await db.exec("update dekez_reports_private.delivery_attempts set finished_at=now()-interval '6 minutes'");
 }
 assert.equal((await claim()).claimed,false);assert.equal((await db.query('select count(*)::int n from dekez_reports_private.delivery_attempts')).rows[0].n,3);
});
test('test mode needs a real approved Admin; test/daily are separately deduplicated',async()=>{
 await assert.rejects(claim('test',id(1),'60168173911',id(4)),/Administrator required/);
 assert.equal((await claim('test',id(1),'60168173911',id(3))).claimed,true);
 assert.equal((await claim()).claimed,true);
 await db.exec(`update profiles set registration_status='rejected' where id='${id(3)}'`);
 await assert.rejects(claim('test',id(1),'60168173911',id(3)),/Administrator required/);
 await db.exec(`update profiles set registration_status='approved' where id='${id(3)}'`);
});
test('delivery writes do not mutate financial, room, tenancy or WhatsApp source records',async()=>{
 const tables=['payments','rent_bills','rental_invoice_line_items','payment_submissions','rooms','maintenance_tickets','tenancies'];
 const before=await Promise.all(tables.map(t=>db.query('select * from '+t+' order by id')));
 const a=await claim();await finish(a);await finish(a);
 const after=await Promise.all(tables.map(t=>db.query('select * from '+t+' order by id')));assert.deepEqual(after.map(x=>x.rows),before.map(x=>x.rows));
});

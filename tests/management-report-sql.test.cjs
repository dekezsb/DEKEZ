const test=require('node:test'),assert=require('node:assert/strict');
let db,id;
const asOf='2026-10-25T12:00:00Z';
async function snapshot(company=id(1),date=asOf){return (await db.query('select dekez_management_report_snapshot($1,$2) result',[company,date])).rows[0].result;}
async function claim(kind='daily',company=id(1),recipient='60168173911',actor=null){const s=await snapshot(company);return (await db.rpcQuery('select dekez_management_report_claim($1,$2,$3,$4,$5,$6,$7) result',[company,s.report_date,recipient,kind,JSON.stringify(s),'Fixture report',actor])).rows[0].result;}
async function finish(a,state='accepted',provider='fixture-message-id'){await db.rpcQuery('select dekez_management_report_finish($1,$2,$3,$4,$5)',[a.attempt_id,state,provider,state==='accepted'?200:429,state==='accepted'?null:state==='rejected'?'provider_rejected':'delivery_uncertain']);}
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
test('service role has function-only reporting access: direct table reads and writes are denied',async()=>{
 const a=await claim();await finish(a);
 for(const table of ['report_runs','delivery_attempts']){
  for(const sql of [`select * from dekez_reports_private.${table}`,`insert into dekez_reports_private.${table} default values`,`update dekez_reports_private.${table} set state='rejected'`,`delete from dekez_reports_private.${table}`,`truncate dekez_reports_private.${table}`]){
   await assert.rejects(db.rpcQuery(sql),/permission denied/);
  }
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
   assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',['service_role',`dekez_reports_private.${table}`,privilege])).rows[0].allowed,false);
  }
 }
 assert.equal((await claim()).state,'accepted');
});
test('internal executor cannot log in, bypass RLS, inherit roles, access sources or be assumed by runtime roles',async()=>{
 const role=(await db.query("select rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname='dekez_report_executor'")).rows[0];
 assert.ok(Object.values(role).every(x=>x===false));
 for(const roleName of ['service_role','anon','authenticated']){
  assert.equal((await db.query("select pg_has_role($1,'dekez_report_executor','MEMBER') member",[roleName])).rows[0].member,false);
 }
 await db.exec('set session authorization service_role; set role service_role;');
 try{await assert.rejects(db.exec('set role dekez_report_executor'),/permission denied/);}
 finally{await db.exec('set session authorization postgres; set role postgres;');}
 const membership=(await db.query("select inherit_option,set_option,admin_option from pg_auth_members where roleid='dekez_report_executor'::regrole and member='fixture_migrator'::regrole")).rows[0];
 assert.deepEqual(membership,{inherit_option:false,set_option:false,admin_option:true});
 for(const table of ['profiles','companies','payments','rent_bills','tenancies','tenants','maintenance_tickets']){
  assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',['dekez_report_executor',`public.${table}`,'SELECT,INSERT,UPDATE,DELETE'])).rows[0].allowed,false);
 }
 assert.equal((await db.query("select has_schema_privilege('dekez_report_executor','dekez_reports_private','CREATE') allowed")).rows[0].allowed,false);
});
test('all reporting definers are private, narrowly owned, fixed-path and executable only by the reporting server',async()=>{
 const functions=(await db.query("select p.proname,p.prosecdef,p.proconfig,r.rolname owner,pg_get_functiondef(p.oid) definition,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='dekez_reports_private' order by p.proname")).rows;
 assert.deepEqual(functions.map(f=>f.proname),['claim','finish']);
 for(const f of functions){assert.equal(f.prosecdef,true);assert.equal(f.owner,'dekez_report_executor');assert.equal(f.anon,false);assert.equal(f.authenticated,false);assert.equal(f.service,true);assert.ok(f.proconfig.includes('search_path=""'));assert.ok(f.proconfig.includes('row_security=on'));assert.ok(f.proconfig.includes('statement_timeout=10s'));assert.doesNotMatch(f.definition,/\bEXECUTE\s|\bpublic\./i);}
 const wrappers=(await db.query("select prosecdef from pg_proc where proname like 'dekez_management_report_%'")).rows;assert.equal(wrappers.length,3);assert.ok(wrappers.every(f=>!f.prosecdef));
 const tables=(await db.query("select relrowsecurity,relforcerowsecurity,relowner::regrole::text owner from pg_class where relnamespace='dekez_reports_private'::regnamespace and relkind='r'")).rows;
 assert.equal(tables.length,2);assert.ok(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity&&t.owner==='fixture_migrator'));
});
test('even an accidental private EXECUTE grant and forged JWT cannot elevate an authenticated user',async()=>{
 await db.exec('grant usage on schema dekez_reports_private to authenticated; grant execute on function dekez_reports_private.finish(uuid,text,text,integer,text) to authenticated; set session authorization authenticated; set role authenticated;');
 try{
  await db.exec(`set request.jwt.claims='{"role":"service_role","sub":"${id(3)}"}';`);
  await assert.rejects(db.query("select dekez_reports_private.finish(null,'accepted','fake',200,null)"),/Reporting server role required/);
  await assert.rejects(db.exec('set role service_role'),/permission denied/);
 }finally{await db.exec('set session authorization postgres; set role postgres; reset request.jwt.claims; revoke usage on schema dekez_reports_private from authenticated; revoke execute on function dekez_reports_private.finish(uuid,text,text,integer,text) from authenticated;');}
});
test('temporary objects and caller search_path cannot redirect privileged writes',async()=>{
 await db.exec("create temporary table report_runs(id uuid,state text); set search_path=pg_temp,public;");
 try{const a=await claim();await finish(a);assert.equal((await db.query('select count(*)::int n from pg_temp.report_runs')).rows[0].n,0);assert.equal((await claim()).state,'accepted');}
 finally{await db.exec('reset search_path; drop table pg_temp.report_runs;');}
});
test('migration runs as the production-like non-superuser and exposes no source-writing privileges',async()=>{
 assert.deepEqual(db.migrationIdentity,{current_user:'fixture_migrator',rolsuper:false});
 const policies=(await db.query("select polcmd,polroles::text roles from pg_policy where polrelid in ('dekez_reports_private.report_runs'::regclass,'dekez_reports_private.delivery_attempts'::regclass)")).rows;
 assert.equal(policies.length,6);assert.ok(policies.every(p=>['r','a','w'].includes(p.polcmd)));
 assert.equal((await db.query("select count(*)::int n from pg_auth_members where member='dekez_report_executor'::regrole")).rows[0].n,0);
});
test('unaltered full migration also executes atomically and leaves the same function-only boundary',async()=>{
 const full=await require('./fixtures/management-report.cjs')({fullMigration:true});
 try{
  assert.equal((await full.query("select has_table_privilege('service_role','dekez_reports_private.report_runs','SELECT,INSERT,UPDATE,DELETE') allowed")).rows[0].allowed,false);
  const s=(await full.rpcQuery('select public.dekez_management_report_snapshot($1,$2) s',[id(1),asOf])).rows[0].s;
  const a=(await full.rpcQuery('select public.dekez_management_report_claim($1,$2,$3,$4,$5,$6,$7) a',[id(1),s.report_date,'60168173911','daily',JSON.stringify(s),'Full migration fixture',null])).rows[0].a;
  assert.equal(a.claimed,true);await full.rpcQuery("select public.dekez_management_report_finish($1,'accepted','full-fixture',200,null)",[a.attempt_id]);
 }finally{await full.close();}
});

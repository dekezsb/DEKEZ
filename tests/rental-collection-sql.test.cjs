const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=require('./fixtures/rental-collection.cjs');
const sql=fs.readFileSync('supabase/migrations/20261027051603_rental_collection_review.sql','utf8');
let db,id;
const rpc=async(name,args)=>(await db.rpcQuery(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const preview=(after=null,limit=50,asof='2026-10-27T01:00:00Z')=>rpc('dekez_collection_preview',[id(1),asof,after,limit]);
test.before(async()=>{db=await fixture();id=db.id;});
test.after(async()=>{await db?.close();});
test.beforeEach(async()=>{await db.exec(`truncate rent_bills,payments,payment_submissions,rental_invoice_line_items,whatsapp_conversations,rent_reminder_logs,
 dekez_collections_private.audit,dekez_collections_private.attempts,dekez_collections_private.escalations,dekez_collections_private.daily_cases,
 dekez_collections_private.controls,dekez_collections_private.contact_controls;
 truncate dekez_collections_private.provider_events,dekez_collections_private.number_suppressions,dekez_collections_private.failure_reports,dekez_collections_private.failure_report_controls,dekez_collections_private.worker_runs,user_module_permissions;
 update profiles set role='super_admin',registration_status='approved' where id='00000000-0000-0000-0000-000000000003';
 update company_users set status='active',role='admin';
 update tenancies set status='active',billing_status='active',checkout_date=null;
 update rooms set current_tenancy_id='00000000-0000-0000-0000-000000000021';
 update profiles set phone='0191111111' where role='tenant';`);});
const enable=async()=>{
 await db.query(`insert into dekez_collections_private.controls(company_id,enabled,compliance_approved,opt_out_ready,legacy_handover_complete,approved_by,approved_at,review_reference)
 values($1,true,true,true,true,$2,now(),'Synthetic approval only')`,[id(1),id(3)]);
 await db.query(`insert into dekez_collections_private.contact_controls(company_id,tenant_id,consent,approved_recipient,consent_reference,reviewed_by,reviewed_at,
 ownership_recipient,ownership_reference,ownership_verified_by,ownership_verified_at)
 values($1,$2,'opted_in','60191111111','Synthetic consent only',$3,now(),'60191111111','Synthetic ownership evidence',$3,now())`,[id(1),id(4),id(3)]);
};
const privateRpc=async(name,args)=>(await db.rpcQuery(`select dekez_collections_private.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const currentItem=async()=>{const now=(await db.query('select clock_timestamp()::text t')).rows[0].t;return (await preview(null,50,now)).items[0];};

test('migration is additive, disabled and has no source writes, enforcement or schedules',async()=>{
 assert.match(sql,/set local lock_timeout = '5s'/);
 assert.doesNotMatch(sql,/\b(?:update|insert into|delete from|alter table|drop table)\s+public\.|http_post|cron\.schedule|ttlock|smart_lock|evict/i);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.controls')).rows[0].n,0);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.attempts')).rows[0].n,0);
});
test('forced RLS and function-only private data access deny all portal and direct service roles',async()=>{
 for(const table of ['controls','contact_controls','daily_cases','escalations','attempts','audit','provider_events','number_suppressions','failure_reports','failure_report_controls','worker_runs']){
  const r=(await db.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass',['dekez_collections_private.'+table])).rows[0];
  assert.deepEqual(r,{relrowsecurity:true,relforcerowsecurity:true});
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
   assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,'dekez_collections_private.'+table,privilege])).rows[0].ok,false,role+table+privilege);
 }
 const functions=(await db.query("select p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dekez_collections_private' or (n.nspname='public' and p.proname like 'dekez_collection_%')")).rows;
 assert.equal(functions.length,40);
 for(const f of functions){
  assert.ok(f.proconfig.includes('search_path=""'));
  assert.equal(f.prosecdef,f.nspname==='dekez_collections_private');
  if(f.prosecdef){assert.equal(f.owner,'dekez_collection_executor');assert.ok(f.proconfig.includes('row_security=on'));}
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,$2::oid,'EXECUTE') ok",[role,f.oid])).rows[0].ok,false);
 }
 for(const table of ['rent_bills','payments','tenancies','profiles'])assert.equal((await db.query("select has_table_privilege('dekez_collection_executor',$1,'UPDATE') ok",[table])).rows[0].ok,false);
});
test('full policy schedule uses original calendar due date at Malaysia boundary',async()=>{
 for(const [days,stage] of [[-180,'tracking'],[-8,'tracking'],[-7,'advance_7'],[-6,'tracking'],[0,'due_today'],[1,'overdue_1_6'],[6,'overdue_1_6'],[7,'day_7_review'],[8,'overdue_8_13'],[13,'overdue_8_13'],[14,'day_14_review'],[15,'overdue_15_plus'],[200,'overdue_15_plus']]){
  await db.exec('truncate rent_bills,payments,dekez_collections_private.escalations');await db.bill(100,days);
  const p=await preview();assert.equal(p.items[0]?.stage??null,stage);if(stage)assert.equal(p.items[0].days_overdue,days);
 }
 await db.exec('truncate rent_bills,payments,dekez_collections_private.escalations');await db.bill(100,0);
 assert.equal((await preview(null,50,'2026-10-26T15:59:59Z')).items[0].days_overdue,-1);
 assert.equal((await preview(null,50,'2026-10-26T16:00:00Z')).items[0].days_overdue,0);
});
test('partial payments reduce balance but never reset 7/14/day15+ clock',async()=>{
 await db.bill(100,20,500,200,'partially_paid');let x=(await preview()).items[0];
 assert.equal(x.outstanding,300);assert.equal(x.days_overdue,20);assert.equal(x.stage,'overdue_15_plus');assert.equal(x.partial_invoices,1);
 await db.query('update rent_bills set paid_amount=500 where id=$1',[id(100)]);await db.query('update payments set amount=500 where rent_bill_id=$1',[id(100)]);
 x=(await preview()).items[0];assert.equal(x.resolved,true);assert.equal(x.send_eligible,false);assert.equal(x.outstanding,0);
});
test('positive paid-status balances remain scanned as reconciliation exceptions',async()=>{
 await db.bill(100,14,500,200,'paid');const x=(await preview()).items[0];
 assert.equal(x.stage,'exception');assert.equal(x.outstanding,300);assert.equal(x.collectible_outstanding,0);assert.equal(x.invoices[0].days_overdue,14);assert.ok(x.exceptions.includes('paid_status_positive_balance'));assert.equal(x.send_eligible,false);
});
test('invoice extras once, deposits excluded, reversed allocation mismatch held',async()=>{
 await db.bill(100,7,500,100);await db.query('insert into rental_invoice_line_items values($1,$2,50)',[id(300),id(100)]);
 let x=(await preview()).items[0];assert.equal(x.outstanding,450);assert.equal(x.invoices[0].extra_amount,50);assert.equal(x.invoices[0].verified_paid,100);
 await db.exec('update payments set reversed_at=now()');x=(await preview()).items[0];assert.ok(x.exceptions.includes('allocation_mismatch'));assert.equal(x.send_eligible,false);
});
test('pending proof retains underlying stage and stops demands through explicit pending flag',async()=>{
 await db.bill(100,14,500,100);await db.query("insert into payment_submissions values($1,$2,$3,'pending_verification')",[id(300),id(100),id(21)]);
 const x=(await preview()).items[0];assert.equal(x.stage,'day_14_review');assert.equal(x.pending_verification,true);assert.equal(x.pending.length,1);assert.match(x.pending[0].reference,/^Submission /);
});
test('unknown consent and compliance fail closed, no real phone directory access',async()=>{
 await db.bill();const x=(await preview()).items[0];assert.equal(x.phone,'60191111111');assert.equal(x.send_eligible,false);
 assert.deepEqual(x.policy,{enabled:false,compliance_approved:false,opt_out_ready:false,legacy_handover_complete:false,approved_recipient:null,ownership_recipient:null,ownership_verified:false,consent:'unknown',hold:'none'});
 for(const role of ['anon','authenticated']){await db.exec(`begin;set local role ${role};`);try{await assert.rejects(db.query('select public.dekez_collection_preview($1,now())',[id(1)]),/permission denied/);}finally{await db.exec('rollback');}}
});
test('checkout/internal invoices and missing identity held without silently dropping balances',async()=>{
 await db.bill();await db.exec('update tenancies set checkout_date=current_date');let x=(await preview()).items[0];assert.ok(x.exceptions.includes('inactive_or_checked_out'));
 await db.exec('update rent_bills set tenant_facing=false,tenancy_id=null,tenant_id=null');x=(await preview()).items[0];assert.match(x.key,/^invoice:/);assert.ok(x.exceptions.includes('internal_invoice'));assert.ok(x.exceptions.includes('identity_or_scope'));
});
test('same-person invoices consolidate once; advance7 remains visible alongside nearer future invoice',async()=>{
 await db.bill(100,-7);await db.bill(101,-1,200);const p=await preview();assert.equal(p.items.length,1);assert.equal(p.items[0].invoices.length,2);assert.equal(p.items[0].outstanding,700);assert.equal(p.items[0].stage,'advance_7');assert.equal(p.summary.tenants,1);
});
test('legacy same-day sends even failed results suppress handover duplicates',async()=>{
 await db.bill();await db.query("insert into rent_reminder_logs values($1,$2,'whatsapp','2026-10-27T01:00Z','failed')",[id(300),id(4)]);
 assert.ok((await preview()).items[0].exceptions.includes('legacy_message_today'));
});

test('consent binds recipient and STOP readiness is required even after compliance approval',async()=>{
 await db.bill();await enable();let x=(await preview()).items[0];assert.equal(x.send_eligible,true);
 await db.exec('update dekez_collections_private.controls set opt_out_ready=false');x=(await preview()).items[0];assert.equal(x.send_eligible,false);
 await db.exec("update dekez_collections_private.controls set opt_out_ready=true;update profiles set phone='0192222222' where role='tenant';update tenants set phone='0192222222'");
 x=(await preview()).items[0];assert.equal(x.phone,'60192222222');assert.equal(x.send_eligible,false);assert.equal(x.policy.approved_recipient,'60191111111');
 await db.exec("update tenants set phone='0191111111'");
});

test('shared phone detection includes another profile without any rental invoice',async()=>{
 await db.bill();await enable();await db.query("insert into profiles values($1,'Synthetic other','+60191111111','tenant','approved')",[id(9)]);
 try{const x=(await preview()).items[0];assert.ok(x.exceptions.includes('shared_phone'));assert.equal(x.send_eligible,false);}finally{await db.query('delete from profiles where id=$1',[id(9)]);}
});

test('pending proof cannot be disguised as collection body by trusted server caller',async()=>{
 await db.bill();await enable();await db.query("insert into payment_submissions values($1,$2,$3,'pending_verification')",[id(300),id(100),id(21)]);
 const x=await currentItem();assert.equal(x.send_eligible,false);
 const forged={...x,send_eligible:true};assert.deepEqual(await privateRpc('claim',[JSON.stringify(forged),'Pay now']),{claimed:false,state:'pending_review'});
 assert.equal((await db.query('select count(*) n from dekez_collections_private.attempts')).rows[0].n,0);
});

test('full transactional scan tracks all balances, reviews held Day7/14 once, preserves business rows',async()=>{
 await db.bill(100,20,500,100,'partially_paid');await db.bill(101,7,200);
 await db.exec("update rent_bills set due_date=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date-case when invoice_number='SYNTH-100' then 20 else 7 end");
 await db.query("insert into payment_submissions values($1,$2,$3,'pending_verification')",[id(300),id(100),id(21)]);
 const before=(await db.query('select jsonb_agg(to_jsonb(b) order by id) rows from rent_bills b')).rows[0].rows;
 let result=await rpc('dekez_collection_scan',[id(1)]);assert.equal(result.checked,1);assert.equal(result.urgent_day7,2);assert.equal(result.urgent_day14,1);assert.equal(result.exceptions,1);
 result=await rpc('dekez_collection_scan',[id(1)]);assert.equal(result.urgent_day7,0);assert.equal(result.urgent_day14,0);
 const cases=(await db.query('select stage,snapshot from dekez_collections_private.daily_cases')).rows;assert.equal(cases.length,1);assert.equal(cases[0].stage,'overdue_15_plus');assert.equal(cases[0].snapshot.pending_verification,true);
 assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(b) order by id) rows from rent_bills b')).rows[0].rows,before);
 const day=(await db.query("select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date::text report_day")).rows[0].report_day;
 const h=await rpc('dekez_collection_history',[id(1),day,null,25]);assert.equal(h.items.length,1);assert.equal(h.new_day_7_reviews,2);assert.equal(h.new_day_14_reviews,1);
 assert.equal((await db.query("select count(*) n from dekez_collections_private.audit where action='case_checked'")).rows[0].n,1);
});

test('permanent daily claim blocks duplicates even after uncertain outcome, audit is immutable',async()=>{
 await db.bill();await enable();const s=await currentItem();const claim=await privateRpc('claim',[JSON.stringify(s),'Synthetic message only']);assert.equal(claim.claimed,true);
 assert.deepEqual(await privateRpc('claim',[JSON.stringify(s),'Retry prohibited']),{claimed:false,state:'duplicate'});
 await rpc('dekez_collection_finish',[claim.attempt_id,'uncertain',null,null,'delivery_uncertain']);
 assert.deepEqual(await privateRpc('claim',[JSON.stringify(s),'Retry prohibited']),{claimed:false,state:'duplicate'});
 await assert.rejects(rpc('dekez_collection_finish',[claim.attempt_id,'accepted','synthetic123',200,null]),/already finalized/);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.attempts')).rows[0].n,1);
});

test('withheld/rejected/settled and spoofed portal role cannot create unauthorized sends',async()=>{
 await db.bill();let s=await currentItem();assert.deepEqual(await privateRpc('claim',[JSON.stringify({...s,send_eligible:true}),'Synthetic']),{claimed:false,state:'withheld'});
 await db.exec("begin;set local role authenticated;set local request.jwt.claims='{\"role\":\"service_role\"}'");
 try{await assert.rejects(db.query('select dekez_collections_private.claim($1,$2)',[JSON.stringify(s),'Bad']),/permission denied/);}finally{await db.exec('rollback');}
 await enable();s=await currentItem();const a=await privateRpc('claim',[JSON.stringify(s),'Synthetic']);await rpc('dekez_collection_finish',[a.attempt_id,'rejected',null,400,'provider_rejected']);
 assert.deepEqual(await privateRpc('claim',[JSON.stringify(s),'Retry']),{claimed:false,state:'duplicate'});
});

test('read-only aggregate preview uses same source and discloses no recipient or tenant name',async()=>{
 await db.bill();const query=fs.readFileSync('scripts/rental-collection-preview.sql','utf8').replaceAll('660cc0c4-daee-445b-9146-ccd112e791d4',id(1));
 const report=(await db.rpcQuery(query)).rows[0].result;assert.equal(report.communications_enabled,false);assert.equal(report.samples[0].outstanding,500);
 const text=JSON.stringify(report);assert.ok(!text.includes('Synthetic tenant'));assert.ok(!text.includes('60191111111'));assert.ok(!text.includes('0191111111'));
});

test('production preview CTE is byte-equivalent to source projection after scope and disabled-policy substitution',()=>{
 let expected=sql.slice(sql.indexOf(' with profile_phones as materialized'),sql.indexOf(') select item||jsonb_build_object(\'fingerprint\''));
 expected=expected.replaceAll('p_company','(select company_id from params)').replaceAll('p_as_of','(select as_of from params)').replace(/\bd\b/g,'(select report_date from params)');
 expected=expected.replace('with profile_phones',"with params as (select '660cc0c4-daee-445b-9146-ccd112e791d4'::uuid company_id,current_timestamp as_of,(current_timestamp at time zone 'Asia/Kuala_Lumpur')::date report_date), profile_phones");
 expected=expected.replace(/dekez_collections_private\.policy\(\(select company_id from params\),tenant_id\)/g,"jsonb_build_object('enabled',false,'compliance_approved',false,'opt_out_ready',false,'legacy_handover_complete',false,'approved_recipient',null,'ownership_recipient',null,'ownership_verified',false,'consent','unknown','hold','none')").replaceAll('dekez_collections_private.number_suppressed(phone)','false');
 const raw=fs.readFileSync('scripts/rental-collection-preview.sql','utf8');const actual=raw.slice(raw.indexOf(' with params as'),raw.indexOf('), stage_counts as'));
 assert.equal(actual.replace(/\r\n/g,'\n'),expected.replace(/\r\n/g,'\n'));
});

test('nonfinite amount is retained as explicit unavailable balance, not a demand',async()=>{
 await db.bill();await db.exec("update rent_bills set amount='NaN'::numeric");const p=await preview(),x=p.items[0];
 assert.equal(x.stage,'exception');assert.equal(x.outstanding,null);assert.equal(x.invoices[0].base_amount,null);assert.ok(x.exceptions.includes('invalid_amount'));assert.equal(x.send_eligible,false);
});

test('future invoices remain tracked separately from arrears and do not reset overdue age',async()=>{
 await db.bill(100,15,500,200);await db.bill(101,-180,700);let x=(await preview()).items[0];
 assert.equal(x.outstanding,1000);assert.equal(x.arrears_outstanding,300);assert.equal(x.days_overdue,15);assert.equal(x.arrears_resolved,false);
 await db.exec('update rent_bills set paid_amount=500 where amount=500;update payments set amount=500');x=(await preview()).items[0];
 assert.equal(x.outstanding,700);assert.equal(x.arrears_outstanding,0);assert.equal(x.arrears_resolved,true);assert.equal(x.stage,'tracking');assert.equal(x.resolved,false);
});

test('unlinked invoice records are not reported as distinct identified tenants',async()=>{
 await db.bill(100);await db.bill(101);await db.query('update rent_bills set tenancy_id=null,tenant_id=null where id=$1',[id(101)]);
 const p=await preview();assert.equal(p.summary.groups,2);assert.equal(p.summary.tenants,1);assert.equal(p.summary.unlinked_records,1);
 const page=await preview(null,1);assert.equal(page.items.length,1);assert.equal(page.summary.groups,2);assert.equal(page.summary.unlinked_records,1);assert.ok(page.next_cursor);
 assert.equal((await preview(page.next_cursor,1)).items.length,1);
});

test('cancelled, internal, unissued, inactive and unreconciled balances never trigger termination review',async()=>{
 for(const issue of ['cancelled','internal','unissued','inactive','allocation','identity']){
  await db.exec('truncate rent_bills,payments,dekez_collections_private.escalations,dekez_collections_private.daily_cases,dekez_collections_private.audit');
  await db.exec("update tenancies set status='active'");await db.bill(100,14,350);
  await db.exec("update rent_bills set due_date=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date-14");
  if(issue==='cancelled')await db.exec("update rent_bills set status='cancelled'");
  if(issue==='internal')await db.exec('update rent_bills set tenant_facing=false');
  if(issue==='unissued')await db.exec('update rent_bills set issued_at=null');
  if(issue==='inactive')await db.exec("update tenancies set status='checked_out'");
  if(issue==='allocation')await db.exec('update rent_bills set paid_amount=50');
  if(issue==='identity')await db.exec('update rent_bills set tenancy_id=null');
  const x=await currentItem();assert.equal(x.stage,'exception',issue);assert.equal(x.collectible_outstanding,0,issue);assert.ok(x.outstanding>0,issue);
  const r=await rpc('dekez_collection_scan',[id(1)]);assert.equal(r.urgent_day7,0,issue);assert.equal(r.urgent_day14,0,issue);
  assert.equal((await db.query('select count(*) n from dekez_collections_private.escalations')).rows[0].n,0,issue);
 }
});

test('verified active debt controls stage; cancelled balance remains separately visible and held',async()=>{
 await db.bill(100,14,350,0,'cancelled');await db.bill(101,2,500,100,'partially_paid');const x=(await preview()).items[0];
 assert.equal(x.stage,'overdue_1_6');assert.equal(x.days_overdue,2);assert.equal(x.recorded_days_overdue,14);
 assert.equal(x.outstanding,750);assert.equal(x.collectible_outstanding,400);assert.equal(x.arrears_outstanding,400);
 assert.equal(x.send_eligible,false);assert.equal(x.invoices.filter(i=>i.collectible).length,1);
});

test('zero recorded balance with missing verified settlement remains exception, never resolved',async()=>{
 await db.bill(100,14,350,350,'paid');await db.exec('delete from payments');const x=(await preview()).items[0];
 assert.equal(x.outstanding,0);assert.equal(x.stage,'exception');assert.equal(x.resolved,false);assert.equal(x.arrears_resolved,false);
 assert.ok(x.exceptions.includes('allocation_mismatch'));
});

test('NULL parent submission verification fails closed despite confirmed child allocation',async()=>{
 await db.bill(100,14,500,100,'partially_paid');await enable();
 await db.query('insert into payment_submissions values($1,$2,$3,null)',[id(300),id(100),id(21)]);
 await db.query('update payments set payment_submission_id=$1 where rent_bill_id=$2',[id(300),id(100)]);
 const x=(await preview()).items[0];assert.ok(x.exceptions.includes('payment_scope_or_verification'));
 assert.equal(x.collectible_outstanding,0);assert.equal(x.stage,'exception');assert.equal(x.send_eligible,false);
});

test('portal login approval and consent alone never prove WhatsApp number ownership',async()=>{
 await db.bill();await enable();await db.exec('update dekez_collections_private.contact_controls set ownership_recipient=null,ownership_reference=null,ownership_verified_by=null,ownership_verified_at=null');
 const x=await currentItem();assert.equal(x.recipient_source,'tenant_portal_login');assert.equal(x.masked_phone,'***1111');assert.equal(x.phone_valid,true);
 assert.equal(x.whatsapp_ownership_verified,false);assert.ok(x.delivery_blocks.includes('whatsapp_ownership_unverified'));assert.equal(x.send_eligible,false);
 assert.deepEqual(await privateRpc('claim',[JSON.stringify({...x,send_eligible:true}),'Synthetic']),{claimed:false,state:'withheld'});
 await rpc('dekez_collection_scan',[id(1)]);
 assert.ok((await db.query('select snapshot from dekez_collections_private.daily_cases')).rows[0].snapshot.delivery_blocks.includes('whatsapp_ownership_unverified'));
});

test('protected management, sender and Rosley numbers cannot receive tenant demands even with consent and ownership evidence',async()=>{
 await db.bill();await enable();
 for(const phone of ['60198894911','60168173911','60188702371']){
  await db.query("update profiles set phone=$1 where role='tenant'",[phone]);await db.query('update tenants set phone=$1',[phone]);
  await db.query('update dekez_collections_private.contact_controls set approved_recipient=$1,ownership_recipient=$1',[phone]);
  const x=await currentItem();assert.equal(x.phone,phone);assert.equal(x.protected_recipient,true);assert.ok(x.delivery_blocks.includes('protected_recipient'));assert.equal(x.send_eligible,false);
  assert.deepEqual(await privateRpc('claim',[JSON.stringify({...x,send_eligible:true}),'Synthetic']),{claimed:false,state:'protected_recipient'});
 }
 await db.exec("update tenants set phone='0191111111'");assert.equal((await db.query('select count(*) n from dekez_collections_private.attempts')).rows[0].n,0);
});

test('canonical portal phone is never replaced by tenant contact, consent target or legacy invoice profile',async()=>{
 await db.bill();await enable();await db.exec("update tenants set phone='0192222222';update dekez_collections_private.contact_controls set approved_recipient='60192222222',ownership_recipient='60192222222'");
 let x=(await preview()).items[0];assert.equal(x.phone,'60191111111');assert.ok(x.delivery_blocks.includes('consent_number_mismatch'));assert.equal(x.send_eligible,false);
 await db.exec('update rent_bills set tenancy_id=null');x=(await preview()).items[0];assert.equal(x.phone,'');assert.ok(x.delivery_blocks.includes('portal_login_phone_missing'));assert.equal(x.send_eligible,false);
 await db.exec("update tenants set phone='0191111111'");
});

test('local MY and international prefix normalize like portal login; malformed embedded plus is rejected',async()=>{
 await db.bill();await enable();
 for(const phone of ['0191111111','+60191111111','60191111111','+60 (19) 111-1111']){
  await db.query("update profiles set phone=$1 where role='tenant'",[phone]);const x=(await preview()).items[0];assert.equal(x.phone,'60191111111',phone);assert.equal(x.phone_valid,true,phone);
 }
 await db.exec("update profiles set phone='019+1111111' where role='tenant'");const x=(await preview()).items[0];assert.equal(x.phone_valid,false);assert.equal(x.send_eligible,false);
});

test('owner or contractor role and previous room tenant cannot be selected as active tenant recipient',async()=>{
 await db.bill();await enable();
 for(const role of ['owner','contractor_preview']){
  await db.query('update profiles set role=$1 where id=$2',[role,id(4)]);const x=(await preview()).items[0];assert.ok(x.exceptions.includes('identity_or_scope'));assert.equal(x.send_eligible,false);
 }
 await db.query("update profiles set role='tenant' where id=$1",[id(4)]);await db.query('update rooms set current_tenancy_id=$1',[id(88)]);
 const x=await currentItem();assert.ok(x.exceptions.includes('not_current_room_tenancy'));assert.equal(x.collectible_outstanding,0);assert.equal(x.send_eligible,false);
 const scan=await rpc('dekez_collection_scan',[id(1)]);assert.equal(scan.urgent_day7,0);assert.equal(scan.urgent_day14,0);
});

test('source preview returns every group redacted with comprehensive messaging-block counts',async()=>{
 await db.bill(100);await db.bill(101);await db.query('update rent_bills set tenancy_id=null,tenant_id=null where id=$1',[id(101)]);
 const query=fs.readFileSync('scripts/rental-collection-preview.sql','utf8').replaceAll('660cc0c4-daee-445b-9146-ccd112e791d4',id(1));
 const report=(await db.rpcQuery(query)).rows[0].result;assert.equal(report.items.length,2);assert.equal(report.summary.groups,2);assert.equal(report.summary.unlinked_records,1);
 assert.equal(report.delivery_blocks.find(b=>b.code==='consent_missing').groups,2);assert.equal(report.delivery_blocks.find(b=>b.code==='portal_login_phone_missing').groups,1);
 const serialized=JSON.stringify(report.items);assert.ok(!serialized.includes(id(4)));assert.ok(!serialized.includes(id(100)));assert.ok(!serialized.includes('60191111111'));
 for(const row of report.items)for(const invoice of row.invoices){assert.ok(invoice.invoice_reference);assert.equal(invoice.id,undefined);assert.equal(invoice.pending,undefined);}
});

const review=(action,phone='60191111111',actor=id(3),company=id(1))=>rpc('dekez_collection_review_contact',[
 company,id(4),phone,actor,action,'Synthetic evidence reference','Synthetic documented review reason']);
const contactEvent=async(kind='stop',event='event-stop',phone='60191111111',channel='FALCON-D9NS9')=>rpc('dekez_collection_ingest_contact_event',[
 id(1),channel,event,'provider-'+event,phone,kind,(await db.query('select clock_timestamp()::text t')).rows[0].t]);
const receipt=async(provider,status='delivered',event='receipt-'+status,phone='60191111111',company=id(1))=>rpc('dekez_collection_ingest_receipt',[
 company,'FALCON-D9NS9',event,provider,phone,status,(await db.query('select clock_timestamp()::text t')).rows[0].t]);

test('Admin evidence reviews bind separate ownership and consent to current login without enabling sends',async()=>{
 await db.bill();
 await assert.rejects(review('record_opt_in'),/ownership/);
 let r=await review('verify_ownership');assert.equal(r.ownership_verified,true);assert.equal(r.consent,'unknown');assert.equal(r.masked_recipient,'***1111');
 r=await review('record_opt_in');assert.equal(r.consent,'opted_in');assert.equal((await currentItem()).send_eligible,false);
 r=await review('set_dispute_hold');assert.equal(r.hold,'dispute');r=await review('clear_hold');assert.equal(r.hold,'none');
 const logs=(await db.query("select details from dekez_collections_private.audit where action='contact_reviewed' order by recorded_at")).rows;
 assert.equal(logs.length,4);assert.equal(logs[0].details.actor,id(3));assert.ok(logs[0].details.reference);assert.ok(logs[3].details.before);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.controls')).rows[0].n,0);
});

test('Admin reviews recheck approval, role, exact company membership and explicit module restrictions',async()=>{
 for(const actor of [id(4),id(999)])await assert.rejects(review('verify_ownership','60191111111',actor),/administrator|permission denied/);
 await assert.rejects(review('verify_ownership','60191111111',id(3),id(2)),/administrator/);
 await db.query("update profiles set registration_status='pending' where id=$1",[id(3)]);await assert.rejects(review('verify_ownership'),/administrator/);
 await db.query("update profiles set registration_status='approved',role='admin' where id=$1",[id(3)]);
 await db.query("insert into user_module_permissions values($1,'rent_due_tracker','view')",[id(3)]);await assert.rejects(review('verify_ownership'),/permission denied|insufficient_privilege/);
 await db.exec("update user_module_permissions set access_level='manage'");assert.equal((await review('verify_ownership')).state,'reviewed');
 await db.exec("update company_users set status='suspended'");await assert.rejects(review('verify_ownership'),/administrator/);
});

test('review rejects arbitrary, protected, changed, shared and previous-tenant recipients',async()=>{
 await assert.rejects(review('verify_ownership','60192222222'),/Current tenant/);
 for(const phone of ['60198894911','60168173911','60188702371']){
  await db.query('update profiles set phone=$1 where id=$2',[phone,id(4)]);await assert.rejects(review('verify_ownership',phone),/Invalid payment/);
 }
 await db.query("update profiles set phone='0191111111' where id=$1",[id(4)]);
 await db.query("update profiles set phone='0191111111' where id=$1",[id(3)]);await assert.rejects(review('verify_ownership'),/Ambiguous/);
 await db.query("update profiles set phone='60112222222' where id=$1",[id(3)]);
 await db.exec('update rooms set current_tenancy_id=null');await assert.rejects(review('verify_ownership'),/Current tenant/);
});

test('STOP is durable number-level suppression without a tenant match and START never opts in',async()=>{
 assert.equal((await contactEvent('stop','unlinked-stop','60195555555')).state,'suppressed');
 assert.equal(await privateRpc('number_suppressed',['60195555555']),true);
 assert.equal((await contactEvent('start','unlinked-start','60195555555')).state,'start_review_required');
 assert.equal(await privateRpc('number_suppressed',['60195555555']),true);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.contact_controls')).rows[0].n,0);
 await assert.rejects(contactEvent('stop','wrong-channel','60195555555','OTHER'),/Invalid authenticated/);
});

test('STOP blocks even a stale eligible snapshot; retry is deduped and explicit resubscription is audited',async()=>{
 await db.bill();await enable();const item=await currentItem();assert.equal(item.send_eligible,true);
 assert.equal((await contactEvent()).state,'suppressed');assert.equal((await contactEvent()).state,'duplicate');
 assert.ok((await currentItem()).delivery_blocks.includes('opted_out'));
 assert.deepEqual(await privateRpc('claim',[JSON.stringify(item),'Synthetic test only']),{claimed:false,state:'opted_out'});
 await assert.rejects(review('record_opt_in'),/resubscription/);
 await contactEvent('start','event-start');assert.equal(await privateRpc('number_suppressed',[item.phone]),true);
 assert.equal((await review('review_resubscription')).suppressed,false);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.attempts')).rows[0].n,0);
});

test('receipt processing distinguishes HTTP acceptance, actual delivery, conflicts and unknown outcomes',async()=>{
 await db.bill();await enable();const a=await privateRpc('claim',[JSON.stringify(await currentItem()),'Synthetic test only']);
 await rpc('dekez_collection_finish',[a.attempt_id,'accepted','provider-one',200,null]);
 let row=(await db.query('select state,delivery_state from dekez_collections_private.attempts')).rows[0];assert.deepEqual(row,{state:'accepted',delivery_state:'unconfirmed'});
 assert.equal((await receipt('provider-one','unknown')).delivery_state,'unknown');
 assert.equal((await receipt('provider-one','delivered')).delivery_state,'delivered');
 assert.equal((await receipt('provider-one','read')).delivery_state,'read');
 assert.equal((await receipt('provider-one','sent')).delivery_state,'read');
 assert.equal((await receipt('provider-one','failed')).delivery_state,'conflict');
 assert.equal((await receipt('provider-one','failed')).state,'duplicate');
 row=(await db.query('select state,delivery_state from dekez_collections_private.attempts')).rows[0];assert.deepEqual(row,{state:'accepted',delivery_state:'conflict'});
 assert.equal((await privateRpc('claim',[JSON.stringify(await currentItem()),'Synthetic retry'])).claimed,false);
});

test('callback before finish is safely reconciled; wrong recipient/company/message never changes attempt',async()=>{
 await db.bill();await enable();const a=await privateRpc('claim',[JSON.stringify(await currentItem()),'Synthetic test only']);
 assert.equal((await receipt('provider-early','failed','early-failure')).state,'unmatched');
 await rpc('dekez_collection_finish',[a.attempt_id,'accepted','provider-early',200,null]);
 assert.equal((await db.query('select delivery_state from dekez_collections_private.attempts')).rows[0].delivery_state,'failed');
 for(const args of [['provider-early','delivered','foreign-phone','60192222222',id(1)],['provider-early','delivered','foreign-company','60191111111',id(2)],['unrelated-id','delivered','foreign-message','60191111111',id(1)]])
  assert.equal((await receipt(...args)).state,'unmatched');
 assert.equal((await db.query('select delivery_state from dekez_collections_private.attempts')).rows[0].delivery_state,'failed');
});

test('provider event and review audit records cannot be updated or deleted by runtime roles',async()=>{
 await contactEvent();await review('verify_ownership');
 for(const role of ['anon','authenticated','service_role','dekez_collection_executor']){
  for(const table of ['provider_events','audit'])for(const action of ['UPDATE','DELETE','TRUNCATE'])
   assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,'dekez_collections_private.'+table,action])).rows[0].ok,false);
 }
 for(const role of ['anon','authenticated']){
  await db.exec(`begin;set local role ${role};`);
  try{await assert.rejects(db.query('select public.dekez_collection_review_contact($1,$2,$3,$4,$5,$6,$7)',[id(1),id(4),'60191111111',id(3),'verify_ownership','Synthetic evidence','Synthetic reason']),/permission denied/);}finally{await db.exec('rollback');}
 }
});

test('provider event identifiers cannot be replayed with changed recipient, status or company',async()=>{
 await contactEvent('stop','same-event');
 await assert.rejects(contactEvent('start','same-event'),/Conflicting provider event/);
 await assert.rejects(contactEvent('stop','same-event','60192222222'),/Conflicting provider event/);
 await receipt('unmatched-provider','sent','same-receipt');
 await assert.rejects(receipt('unmatched-provider','failed','same-receipt'),/Conflicting provider event/);
 await assert.rejects(receipt('unmatched-provider','sent','same-receipt','60191111111',id(2)),/Conflicting provider event/);
});

const managerFixture=async()=>{
 await db.query("insert into profiles(id,full_name,phone,role,registration_status) values($1,'Synthetic manager','60188702371','admin','approved') on conflict(id) do update set phone=excluded.phone,role=excluded.role,registration_status=excluded.registration_status",[id(50)]);
 await db.query("insert into company_users values($1,$2,$3,$3,'admin','active') on conflict(id) do update set status='active',role='admin'",[id(51),id(1),id(50)]);
};
const reviewManager=action=>rpc('dekez_collection_review_failure_recipient',[id(1),id(3),id(50),action,'Synthetic management evidence','Synthetic management recipient review']);
const evidence=(after=null,limit=100)=>rpc('dekez_collection_failure_evidence',[id(1),after,limit]);
const runFixture=async(state='complete')=>{
 const r=(await db.query(`insert into dekez_collections_private.worker_runs(company_id,report_date,state,started_at,expires_at,finished_at)
 values($1,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date,$2,clock_timestamp()-interval '60 seconds',clock_timestamp()+interval '230 seconds',case when $2='running' then null else clock_timestamp() end) returning lease_token`,[id(1),state])).rows[0];return r.lease_token;
};
const digestSnapshot=(e,personal=false)=>({company_id:id(1),report_date:e.report_date,recipient:'60188702371',all_history_loaded:true,contains_personal_details:personal});

test('fixed management recipient requires current account scope and separate ownership/consent',async()=>{
 await managerFixture();let e=await evidence();assert.equal(e.recipient_authorization.verified,true);assert.equal(e.recipient_authorization.whatsapp_ownership_verified,false);
 await assert.rejects(reviewManager('record_opt_in'),/ownership/);
 await reviewManager('verify_ownership');await reviewManager('record_opt_in');e=await evidence();assert.equal(e.recipient_authorization.whatsapp_consent,'opted_in');
 await db.query("insert into user_module_permissions values($1,'rent_due_tracker','none')",[id(50)]);
 e=await evidence();assert.equal(e.recipient_authorization.verified,false);assert.equal(e.recipient_authorization.whatsapp_ownership_verified,true);
 await assert.rejects(reviewManager('record_opt_in'),/management recipient/);
 await db.query("update profiles set phone='60182222222' where id=$1",[id(50)]);
 e=await evidence();assert.equal(e.recipient_authorization.verified,false);assert.equal(e.recipient_authorization.whatsapp_ownership_verified,false);
});

test('consolidated failure evidence is all-history paginated and fingerprints current balances, receipts and permissions',async()=>{
 await managerFixture();await db.bill();await enable();await rpc('dekez_collection_scan',[id(1)]);
 const a=await privateRpc('claim',[JSON.stringify(await currentItem()),'Synthetic message']);
 await rpc('dekez_collection_finish',[a.attempt_id,'accepted','digest-provider',200,null]);
 const first=await evidence(null,1);assert.ok(first.total>=1);assert.ok(first.fingerprint);
 const all=await evidence();assert.equal(all.fingerprint,first.fingerprint);assert.equal(all.items[0].kind,'attempt');assert.equal(all.items[0].data.confirmed_failure,false);
 await receipt('digest-provider','failed','digest-failed');const failed=await evidence();assert.notEqual(failed.fingerprint,all.fingerprint);assert.equal(failed.items.find(x=>x.kind==='attempt').data.confirmed_failure,true);
 await db.exec('update rent_bills set amount=501');assert.notEqual((await evidence()).fingerprint,failed.fingerprint);
 await receipt('digest-provider','delivered','digest-conflict');assert.equal((await evidence()).items.find(x=>x.kind==='attempt').data.confirmed_failure,false);
});

test('management digest reserves once per date, preserves sent body and only updates later portal draft',async()=>{
 await managerFixture();await db.bill();await enable();await reviewManager('verify_ownership');await reviewManager('record_opt_in');await runFixture();
 const e=await evidence(),snap=digestSnapshot(e,true);
 const a=await privateRpc('failure_claim',[id(1),e.fingerprint,'Synthetic consolidated report',JSON.stringify(snap),JSON.stringify(e.recipient_authorization)]);
 assert.equal(a.claimed,true);assert.equal(a.recipient,'60188702371');
 await rpc('dekez_collection_failure_finish',[a.attempt_id,'uncertain',null,null,'delivery_uncertain']);
 const again=await privateRpc('failure_claim',[id(1),e.fingerprint,'Different later report',JSON.stringify({...snap,updated:true}),JSON.stringify(e.recipient_authorization)]);
 assert.equal(again.claimed,false);assert.equal(again.state,'already_reserved');
 const row=(await db.query('select state,message_body,snapshot,latest_snapshot from dekez_collections_private.failure_reports')).rows[0];
 assert.equal(row.state,'uncertain');assert.equal(row.message_body,'Synthetic consolidated report');assert.equal(row.snapshot.updated,undefined);assert.equal(row.latest_snapshot.updated,true);
 await assert.rejects(rpc('dekez_collection_failure_finish',[a.attempt_id,'accepted','retry',200,null]),/already finalized/);
});

const reserveDigest=async()=>{
 await managerFixture();await db.bill();await enable();await reviewManager('verify_ownership');await reviewManager('record_opt_in');await runFixture();
 const e=await evidence();
 return privateRpc('failure_claim',[id(1),e.fingerprint,'Synthetic consolidated report',JSON.stringify(digestSnapshot(e,true)),JSON.stringify(e.recipient_authorization)]);
};

test('management digest HTTP acceptance is not delivered and failed receipt creates sanitized Admin alert once',async()=>{
 const a=await reserveDigest();
 await rpc('dekez_collection_failure_finish',[a.attempt_id,'accepted','rosley-provider',200,null]);
 let e=await evidence();assert.equal(e.digest_status.state,'accepted');assert.equal(e.digest_status.delivery_state,'unconfirmed');assert.equal(e.digest_status.needs_admin_review,false);
 assert.equal(e.digest_alert_count,0);assert.deepEqual(e.digest_alerts,[]);
 const failed=await receipt('rosley-provider','failed','rosley-failed','60188702371');assert.equal(failed.delivery_state,'failed');
 e=await evidence();assert.equal(e.digest_status.delivery_state,'failed');assert.equal(e.digest_status.needs_admin_review,true);assert.equal(e.digest_alert_count,1);assert.equal(e.digest_alerts.length,1);
 assert.deepEqual(Object.keys(e.digest_alerts[0]).sort(),['delivery_state','error_code','needs_admin_review','report_date','state','updated_at'].sort());
 assert.equal((await receipt('rosley-provider','failed','rosley-failed','60188702371')).state,'duplicate');
 assert.equal((await db.query("select count(*) n from dekez_collections_private.audit where action='failure_report_receipt'")).rows[0].n,1);
 assert.equal((await evidence()).daily_reservation,'sent');
 assert.equal((await db.query('select count(*) n from dekez_collections_private.failure_reports')).rows[0].n,1);
});

test('digest receipts require exact company, recipient and provider ID and do not leak other company alerts',async()=>{
 const a=await reserveDigest();await rpc('dekez_collection_failure_finish',[a.attempt_id,'accepted','rosley-scoped',200,null]);
 for(const [provider,phone,company,event] of [['rosley-scoped','60191111111',id(1),'wrong-phone'],['rosley-scoped','60188702371',id(2),'wrong-company'],['different-provider','60188702371',id(1),'wrong-provider']]){
  assert.equal((await receipt(provider,'failed',event,phone,company)).state,'unmatched');
 }
 assert.equal((await evidence()).digest_status.delivery_state,'unconfirmed');
 await receipt('rosley-scoped','failed','right-scope','60188702371');
 const other=await rpc('dekez_collection_failure_evidence',[id(2),null,100]);
 assert.equal(other.digest_status,null);assert.equal(other.digest_alert_count,0);assert.deepEqual(other.digest_alerts,[]);
 assert.equal((await evidence()).digest_alert_count,1);
});

test('a reused management provider ID fails closed across dates without rewriting either delivery ledger',async()=>{
 const first=await reserveDigest();await rpc('dekez_collection_failure_finish',[first.attempt_id,'accepted','rosley-unique',200,null]);
 const second=(await db.query(`insert into dekez_collections_private.failure_reports(company_id,report_date,recipient,fingerprint,snapshot,message_body,latest_snapshot)
 values($1,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date-1,'60188702371','synthetic','{}','Synthetic previous date','{}') returning id`,[id(1)])).rows[0];
 const before=(await db.query('select id,state,provider_message_id,message_body,finished_at,delivery_state from dekez_collections_private.failure_reports order by id')).rows;
 await assert.rejects(rpc('dekez_collection_failure_finish',[second.id,'accepted','rosley-unique',200,null]),/duplicate key value violates unique constraint/);
 assert.deepEqual((await db.query('select id,state,provider_message_id,message_body,finished_at,delivery_state from dekez_collections_private.failure_reports order by id')).rows,before);
 assert.equal((await db.query("select count(*) n from dekez_collections_private.audit where action='failure_report_finished'")).rows[0].n,1);
 await receipt('rosley-unique','failed','rosley-unique-failure','60188702371');
 assert.equal((await db.query('select delivery_state from dekez_collections_private.failure_reports where id=$1',[first.attempt_id])).rows[0].delivery_state,'failed');
 assert.equal((await db.query('select delivery_state from dekez_collections_private.failure_reports where id=$1',[second.id])).rows[0].delivery_state,'unconfirmed');
});

test('early digest receipt is reconciled at HTTP finish and conflicting receipts remain review-only',async()=>{
 const a=await reserveDigest();
 assert.equal((await receipt('rosley-early','delivered','rosley-delivered-early','60188702371')).state,'unmatched');
 await rpc('dekez_collection_failure_finish',[a.attempt_id,'accepted','rosley-early',200,null]);
 let e=await evidence();assert.equal(e.digest_status.delivery_state,'delivered');assert.equal(e.digest_alert_count,0);
 await receipt('rosley-early','failed','rosley-later-failed','60188702371');
 e=await evidence();assert.equal(e.digest_status.delivery_state,'conflict');assert.equal(e.digest_alert_count,1);
 assert.equal((await privateRpc('failure_claim',[id(1),e.fingerprint,'No retry',JSON.stringify(digestSnapshot(e,true)),JSON.stringify(e.recipient_authorization)])).claimed,false);
 assert.equal((await db.query('select message_body from dekez_collections_private.failure_reports')).rows[0].message_body,'Synthetic consolidated report');
});

test('digest rejected, uncertain and stale unconfirmed sends remain visible without false failed-delivery claims',async()=>{
 const a=await reserveDigest();
 await rpc('dekez_collection_failure_finish',[a.attempt_id,'uncertain',null,null,'delivery_uncertain']);
 let e=await evidence();assert.equal(e.digest_status.delivery_state,'unconfirmed');assert.equal(e.digest_status.needs_admin_review,true);
 assert.equal(e.digest_alert_count,1);assert.equal(e.digest_alerts[0].state,'uncertain');
 // A separate historical synthetic record proves unresolved alerts persist past midnight.
 await db.query(`insert into dekez_collections_private.failure_reports(company_id,report_date,recipient,fingerprint,snapshot,message_body,latest_snapshot,created_at)
 values($1,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date-1,'60188702371','synthetic','{}','Synthetic prior interrupted report','{}',clock_timestamp()-interval '1 day')`,[id(1)]);
 e=await evidence();assert.equal(e.digest_alert_count,2);assert.equal(e.digest_alerts[1].state,'sending');assert.equal(e.digest_alerts[1].delivery_state,'unconfirmed');
 assert.equal(e.digest_alerts[1].needs_admin_review,true);
});

test('digest never bypasses consent or review completion; revoked PII access permits exact generic notice only',async()=>{
 await managerFixture();await db.bill();await enable();let e=await evidence();
 const claim=(body,snap=digestSnapshot(e,false))=>privateRpc('failure_claim',[id(1),e.fingerprint,body,JSON.stringify(snap),JSON.stringify(e.recipient_authorization)]);
 assert.equal((await claim('Synthetic')).state,'daily_review_incomplete');await runFixture();assert.equal((await claim('Synthetic')).state,'withheld');
 await reviewManager('verify_ownership');await reviewManager('record_opt_in');
 await db.query("insert into user_module_permissions values($1,'rent_due_tracker','none')",[id(50)]);e=await evidence();
 await assert.rejects(claim('Tenant identities must not be disclosed'),/generic management/);
 const generic=`DEKEZ MANAGEMENT\nLAPORAN SUSULAN PERINGATAN PEMBAYARAN WHATSAPP\nTarikh: ${e.report_date} (Malaysia)\n\nSemakan susulan tersedia melalui Portal Admin yang selamat. Maklumat penyewa tidak disertakan. Akses memerlukan kebenaran akaun pengurusan.\nhttps://dekez.vercel.app/`;
 assert.equal((await claim(generic)).claimed,true);
});

test('worker reservation expires without automatic replacement and terminal outcomes cannot be rewritten',async()=>{
 await db.bill();const token=await runFixture('running');assert.equal(await privateRpc('worker_active',[id(1)]),true);
 await db.exec("update dekez_collections_private.worker_runs set started_at=clock_timestamp()-interval '301 seconds',expires_at=clock_timestamp()-interval '1 second'");
 assert.equal(await privateRpc('worker_active',[id(1)]),false);
 assert.equal((await rpc('dekez_collection_claim',[id(1),id(4),'missing','Synthetic'])).state,'worker_not_active');
 await rpc('dekez_collection_finish_run',[token,'incomplete']);await rpc('dekez_collection_finish_run',[token,'incomplete']);
 await assert.rejects(rpc('dekez_collection_finish_run',[token,'complete']),/already finalized/);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.worker_runs')).rows[0].n,1);
});

test('fixed formatter hold needs active worker, exact company and fresh eligible source; no message or balance write',async()=>{
 await db.bill();await enable();let item=await currentItem();
 const args=[id(1),item.key,item.fingerprint];
 assert.equal((await rpc('dekez_collection_record_message_hold',args)).state,'withheld');
 await runFixture('running');
 assert.equal((await rpc('dekez_collection_record_message_hold',[id(2),item.key,item.fingerprint])).state,'withheld');
 assert.equal((await rpc('dekez_collection_record_message_hold',[id(1),id(999),item.fingerprint])).state,'not_found');
 assert.equal((await rpc('dekez_collection_record_message_hold',[id(1),item.key,'forged'])).state,'source_changed');
 const bills=(await db.query('select * from rent_bills')).rows;
 assert.equal((await rpc('dekez_collection_record_message_hold',args)).state,'recorded');
 assert.equal((await rpc('dekez_collection_record_message_hold',args)).state,'recorded');
 await rpc('dekez_collection_scan',[id(1)]);
 let history=await rpc('dekez_collection_history',[id(1),item.report_date,null,50]);
 assert.equal(history.items[0].snapshot.send_eligible,false);
 assert.deepEqual(history.items[0].snapshot.delivery_blocks,['message_review_required']);
 assert.equal(history.new_day_7_reviews,1);assert.equal(history.new_day_14_reviews,1);
 assert.equal((await evidence()).items.find(x=>x.kind==='case').data.reason_code,'message_review_required');
 assert.equal((await db.query('select count(*) n from dekez_collections_private.attempts')).rows[0].n,0);
 assert.equal((await db.query("select count(*) n from dekez_collections_private.audit where action='case_checked'")).rows[0].n,1);
 assert.deepEqual((await db.query('select * from rent_bills')).rows,bills);
 await db.query('update rent_bills set amount=501');item=await currentItem();
 assert.equal((await rpc('dekez_collection_record_message_hold',args)).state,'source_changed');
 await rpc('dekez_collection_scan',[id(1)]);history=await rpc('dekez_collection_history',[id(1),item.report_date,null,50]);
 assert.equal(history.items[0].snapshot.send_eligible,true);assert.deepEqual(history.items[0].snapshot.delivery_blocks,[]);
 await db.query("update dekez_collections_private.contact_controls set hold='dispute'");item=await currentItem();
 assert.equal((await rpc('dekez_collection_record_message_hold',[id(1),item.key,item.fingerprint])).state,'withheld');
});

test('documented Admin follow-up resolution preserves provider facts and never allows another send',async()=>{
 await db.bill();await enable();const a=await privateRpc('claim',[JSON.stringify(await currentItem()),'Synthetic message']);
 await rpc('dekez_collection_finish',[a.attempt_id,'accepted','followup-provider',200,null]);await receipt('followup-provider','failed','followup-failed');
 const args=[id(1),id(3),a.attempt_id,'Synthetic follow-up evidence','Synthetic documented action completed'];
 await assert.rejects(rpc('dekez_collection_resolve_followup',[id(2),...args.slice(1)]),/administrator/);
 await assert.rejects(rpc('dekez_collection_resolve_followup',[id(1),id(4),...args.slice(2)]),/administrator/);
 assert.equal((await rpc('dekez_collection_resolve_followup',args)).state,'resolved');
 const row=(await db.query('select state,delivery_state,followup_resolved_at from dekez_collections_private.attempts')).rows[0];
 assert.equal(row.state,'accepted');assert.equal(row.delivery_state,'failed');assert.ok(row.followup_resolved_at);
 assert.equal((await evidence()).items.filter(x=>x.kind==='attempt').length,0);
 assert.equal((await privateRpc('claim',[JSON.stringify(await currentItem()),'Synthetic retry'])).claimed,false);
 await receipt('followup-provider','delivered','followup-later-conflict');
 assert.equal((await evidence()).items.find(x=>x.kind==='attempt').data.state,'unknown');
 assert.equal((await db.query("select count(*) n from dekez_collections_private.audit where action='followup_resolved'")).rows[0].n,1);
});

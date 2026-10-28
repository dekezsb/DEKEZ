const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=require('./fixtures/rental-collection.cjs');
const migration='supabase/migrations/20261028091044_rental_collection_pending_evidence.sql';
const sql=fs.readFileSync(migration,'utf8');
let db,id;
const rpc=async(name,args)=>(await db.rpcQuery(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const submit=(changes={})=>{const x={company:id(1),actor:id(3),tenant:id(4),request:id(100),kind:'consent_evidence',day:'2026-10-27',source:'in_person',ref:'Synthetic existing evidence ref',notes:'Synthetic tenant response, not a real consent',phone:null,...changes};return rpc('dekez_collection_submit_evidence',Object.values(x));};
const review=(decision='reviewed',actor=id(3),proposal=id(100))=>rpc('dekez_collection_review_evidence',[id(1),actor,proposal,decision,'Synthetic review reason only']);
const list=(after=null,limit=25,company=id(1),actor=id(3))=>rpc('dekez_collection_list_evidence',[company,actor,after,limit]);
test.before(async()=>{db=await fixture();id=db.id;await db.exec('set role fixture_migrator');await db.exec(sql);await db.exec('reset role');});
test.after(async()=>{await db?.close();});
test.beforeEach(async()=>{await db.exec(`truncate dekez_collections_private.audit,dekez_collections_private.contact_controls,dekez_collections_private.number_suppressions,user_module_permissions;
 update profiles set role='super_admin',registration_status='approved' where id='${id(3)}';
 update profiles set phone='0191111111' where id='${id(4)}'; update company_users set status='active';
 update tenancies set status='active',checkout_date=null;`);});

test('additive proposal migration never writes business, consent or outbound ledgers',()=>{
 assert.match(sql,/lock_timeout = '5s'/);
 assert.doesNotMatch(sql,/\b(?:update|insert into|delete from|alter table|drop table)\s+public\.|(?:insert into|update|delete from)\s+dekez_collections_private\.(?:contact_controls|number_suppressions|attempts|failure_reports|controls)\b/i);
 assert.doesNotMatch(sql,/cron\.schedule|http_post|ttlock|send_enabled/i);
});
test('approved scoped Management may submit only pending evidence; no consent/account changes',async()=>{
 await db.exec(`update profiles set role='admin' where id='${id(3)}';insert into user_module_permissions values('${id(3)}','rent_due_tracker','manage'),('${id(3)}','admin_setup','none')`);
 assert.equal((await submit()).state,'pending');
 const x=(await list()).items[0];assert.equal(x.status,'pending');assert.equal(x.actor,id(3));assert.equal(x.observed_on,'2026-10-27');
 assert.equal(x.login_phone_snapshot,'0191111111');assert.equal(x.review,null);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.contact_controls')).rows[0].n,0);
 assert.equal((await db.query('select phone from profiles where id=$1',[id(4)])).rows[0].phone,'0191111111');
 await assert.rejects(review(),/Super Admin/);
});
test('duplicate requests are idempotent and changed reuse cannot rewrite evidence',async()=>{
 assert.equal((await submit()).state,'pending');assert.equal((await submit()).state,'already_submitted');
 await assert.rejects(submit({notes:'Changed synthetic evidence cannot overwrite'}),/already used/);
 assert.equal((await list()).items.length,1);
});
test('invalid login numbers can be proposed but never copied into actual authentication',async()=>{
 await db.exec(`update profiles set phone=null where id='${id(4)}'`);
 assert.equal((await submit({kind:'phone_correction',phone:'60192222222'})).state,'pending');
 const x=(await list()).items[0];assert.equal(x.proposed_phone,'60192222222');assert.equal(x.login_phone_snapshot,null);
 assert.equal((await db.query('select phone from profiles where id=$1',[id(4)])).rows[0].phone,null);
});
test('scope checks reject other companies, tenants, revoked users and restricted module access',async()=>{
 for(const changes of [{company:id(2)},{tenant:id(999)},{actor:id(4)}])await assert.rejects(submit(changes),/permission|Authorized|relationship/i);
 await db.exec(`update company_users set status='inactive'`);await assert.rejects(submit(),/Authorized/);
 await db.exec(`update company_users set status='active';update profiles set role='admin' where id='${id(3)}';insert into user_module_permissions values('${id(3)}','rent_due_tracker','view')`);
 await assert.rejects(submit(),/privilege/);await assert.rejects(list(),/privilege/);
});
test('future/invalid evidence and arbitrary/protected phone proposals are rejected',async()=>{
 for(const changes of [{day:'2099-01-01'},{day:null},{source:'invented'},{ref:'short'},{notes:'unsafe\nline'},{kind:'approve_consent'},
  {phone:'60192222222'},...['60188702371','60198894911','60168173911','0192222222','60192222222@lid',null].map(phone=>({kind:'phone_correction',phone}))])
  await assert.rejects(submit(changes));
 assert.equal((await list()).items.length,0);
});
test('Super Admin disposition is append-only, retry-safe and never approval of consent',async()=>{
 await submit();assert.equal((await review()).state,'reviewed');assert.equal((await review()).state,'already_reviewed');
 await assert.rejects(review('rejected'),/immutable/);
 const x=(await list()).items[0];assert.equal(x.status,'reviewed');assert.match(x.review.reason,/Synthetic/);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.audit')).rows[0].n,2);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.contact_controls')).rows[0].n,0);
});
test('changed phone or tenancy prevents reviewed disposition but allows documented rejection',async()=>{
 await submit();await db.exec(`update profiles set phone='0193333333' where id='${id(4)}'`);
 await assert.rejects(review(),/Login number changed/);assert.equal((await review('needs_information')).state,'reviewed');
});
test('Super Admin explicit admin_setup restriction is enforced in database',async()=>{
 await submit();await db.exec(`insert into user_module_permissions values('${id(3)}','admin_setup','none')`);
 await assert.rejects(review(),/Super Admin/);
});
test('STOP suppression survives pending evidence and disposition unchanged',async()=>{
 await db.query(`insert into dekez_collections_private.number_suppressions(channel,recipient,company_id,suppressed) values('FALCON-D9NS9','60191111111',$1,true)`,[id(1)]);
 await submit();await review();assert.equal((await db.query('select suppressed from dekez_collections_private.number_suppressions')).rows[0].suppressed,true);
});
test('existing Management STOP-only path immediately suppresses without ownership approval or account changes',async()=>{
 await db.exec(`update profiles set role='admin' where id='${id(3)}';insert into user_module_permissions values('${id(3)}','rent_due_tracker','manage'),('${id(3)}','admin_setup','none')`);
 const stop=recipient=>rpc('dekez_collection_review_contact',[id(1),id(4),recipient,id(3),'record_opt_out','Synthetic STOP reference','STOP received 2026-10-27 (in_person): Actual synthetic withdrawal evidence']);
 await assert.rejects(stop('60193333333'),/Current tenant login number/);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.number_suppressions')).rows[0].n,0);
 const result=await stop('60191111111');assert.equal(result.consent,'opted_out');assert.equal(result.suppressed,true);
 assert.equal((await db.query('select phone from profiles where id=$1',[id(4)])).rows[0].phone,'0191111111');
 const controls=(await db.query('select ownership_verified_at from dekez_collections_private.contact_controls')).rows[0];assert.equal(controls.ownership_verified_at,null);
 assert.equal((await db.query("select count(*) n from dekez_collections_private.audit where action='contact_reviewed'")).rows[0].n,1);
});
test('private audit grants/RLS remain unchanged; all eight new functions deny ordinary roles',async()=>{
 const a=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='dekez_collections_private.audit'::regclass")).rows[0];assert.deepEqual(a,{relrowsecurity:true,relforcerowsecurity:true});
 for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,'dekez_collections_private.audit',privilege])).rows[0].ok,false);
 const f=(await db.query("select p.oid,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('submit_evidence','get_evidence','list_evidence','review_evidence','dekez_collection_submit_evidence','dekez_collection_list_evidence','dekez_collection_review_evidence','dekez_collection_evidence_tenant')")).rows;
 assert.equal(f.length,8);for(const fn of f){assert(fn.proconfig.includes('search_path=""'));if(fn.prosecdef){assert.equal(fn.owner,'dekez_collection_executor');assert(fn.proconfig.includes('row_security=on'));}for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,$2::oid,'EXECUTE') ok",[role,fn.oid])).rows[0].ok,false);}
});
test('25-row cursor pagination keeps the full immutable history without duplicates or cross-company records',async()=>{
 for(let i=0;i<27;i++)await submit({request:id(100+i)});
 const first=await list();assert.equal(first.items.length,25);assert(first.next_cursor);
 const second=await list(first.next_cursor);assert.equal(second.items.length,2);assert.equal(second.next_cursor,null);
 assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,27);
 await assert.rejects(list(null,26));await assert.rejects(list(null,25,id(2)));
});

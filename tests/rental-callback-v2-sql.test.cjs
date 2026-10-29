// Synthetic PostgreSQL only: no production connection, credential or provider.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=require('./fixtures/rental-collection.cjs');
const migration='supabase/migrations/20261029091616_rental_callback_v2_reviewed_slot.sql';
const sql=fs.readFileSync(migration,'utf8');
const authorize=fs.readFileSync('scripts/authorize-rental-callback-setup-v2.sql','utf8');
const retire=fs.readFileSync('scripts/retire-rental-callback-setup.sql','utf8');
const company='660cc0c4-daee-445b-9146-ccd112e791d4',old='5770722d-fb7a-4992-84aa-ef1186d24da9';
let db,id;
const functions=[
 'public.dekez_collection_setup_assert_admin(uuid,uuid)',
 'public.dekez_collection_setup_check(uuid,uuid,uuid)',
 'public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text)',
 'public.dekez_collection_setup_finish(uuid,uuid,uuid,text)',
 'dekez_collections_private.setup_check(uuid,uuid,uuid)',
 'dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)',
 'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'];
async function operator(text){await db.exec('set role fixture_migrator');try{await db.exec(text);}catch(e){await db.exec('rollback');throw e;}finally{await db.exec('reset role');}}
const record=async()=>(await db.query('select to_jsonb(t) value from dekez_collections_private.callback_setup t where id=$1',[old])).rows[0].value;
async function issue(actor=id(3),operation=id(201)){
 await db.query("select set_config('dekez.callback_v2.actor',$1,false),set_config('dekez.callback_v2.operation',$2,false)",[actor,operation]);
 await operator(authorize);
}
const rpc=async(name,operation=id(201),actor=id(3),scope=company)=>(await db.rpcQuery(`select public.${name}($1,$2,$3) result`,[scope,actor,operation])).rows[0].result;
const claim=async(operation=id(201))=>(await db.rpcQuery('select public.dekez_collection_setup_claim($1,$2,$3,$4,$5,$6) result',[company,id(3),operation,'a'.repeat(64),'b'.repeat(64),'dpl_SYNTHETICONLY'])).rows[0].result;
async function grants(enabled){for(const name of functions)for(const role of ['anon','authenticated','service_role'])
 assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok',[role,name,'EXECUTE'])).rows[0].ok,enabled&&role==='service_role',name+' '+role);}
test.before(async()=>{
 db=await fixture();id=db.id;
 await db.query('insert into companies values($1)',[company]);
 await db.query("insert into company_users values($1,$2,$3,$3,'super_admin','active')",[id(199),company,id(3)]);
 await operator(fs.readFileSync('supabase/migrations/20261028122044_rental_collection_callback_setup.sql','utf8'));
});
test.after(async()=>db?.close());
test.beforeEach(async()=>{
 // Reset only the isolated fixture; never offer this as a production operation.
 await db.exec(`truncate dekez_collections_private.callback_setup,user_module_permissions;
 update profiles set role='super_admin',registration_status='approved' where id='${id(3)}';
 update company_users set status='active',role='super_admin' where id='${id(199)}';
 alter table dekez_collections_private.callback_setup drop constraint callback_setup_operation_key_check;
 alter table dekez_collections_private.callback_setup add constraint callback_setup_operation_key_check check(operation_key='rental_callback_v1');`);
 await db.query(`insert into dekez_collections_private.callback_setup(id,company_id,channel,operation_key,approved_actor,created_at,expires_at,revoked_at)
 select $1,$2,'FALCON-D9NS9','rental_callback_v1',$3,t,t+interval '10 minutes',t from(select clock_timestamp() t)x`,[old,company,id(3)]);
 await operator(retire);
 await db.exec("select set_config('dekez.callback_v2.actor','',false),set_config('dekez.callback_v2.operation','',false)");
});
test('migration permits only enumerated v2; no permit, grants, functions or business mutations',async()=>{
 const before=await record();await operator(sql);assert.deepEqual(await record(),before);await grants(false);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.callback_setup')).rows[0].n,1);
 assert.doesNotMatch(sql,/^\s*(?:insert into|update\s|delete from|grant\s|create function|create or replace)/im);
 assert.match(sql,/lock_timeout='5s'/);assert.match(sql,/statement_timeout='30s'/);
 await assert.rejects(db.query("update dekez_collections_private.callback_setup set operation_key='rental_callback_v3'"),/check constraint/);
 await assert.rejects(operator(sql),/Unexpected setup operation constraint/);
});
test('migration fails closed on absent, active or consumed old permit and restores transaction',async()=>{
 await db.exec('update dekez_collections_private.callback_setup set revoked_at=null');
 await assert.rejects(operator(sql),/revoked and unused/);
 await db.exec('update dekez_collections_private.callback_setup set revoked_at=created_at,consumed_at=created_at,before_hash=repeat(\'a\',64),after_hash=repeat(\'b\',64),deployment=\'dpl_SYNTHETICONLY\'');
 await assert.rejects(operator(sql),/revoked and unused/);
 await db.exec('truncate dekez_collections_private.callback_setup');
 await assert.rejects(operator(sql),/only the reviewed/);await grants(false);
});
test('migration refuses live RPC permissions and any direct private table privilege',async()=>{
 await db.exec('grant execute on function public.dekez_collection_setup_check(uuid,uuid,uuid) to service_role');
 await assert.rejects(operator(sql),/remain retired/);await operator(retire);
 await db.exec('grant select on dekez_collections_private.callback_setup to service_role');
 await assert.rejects(operator(sql),/direct setup table/);
 await db.exec('revoke select on dekez_collections_private.callback_setup from service_role');
});
test('operator needs explicit actor/UUID; issues exactly one bounded v2 and preserves revoked v1',async()=>{
 await operator(sql);const before=await record();
 await assert.rejects(operator(authorize),/Explicit reviewed/);
 await assert.rejects(issue(id(3),old),/Explicit reviewed/);
 await issue();assert.deepEqual(await record(),before);await grants(true);
 const rows=(await db.query("select operation_key,expires_at-created_at lifetime,revoked_at,consumed_at from dekez_collections_private.callback_setup where operation_key='rental_callback_v2'")).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].lifetime,'00:10:00');assert.equal(rows[0].revoked_at,null);assert.equal(rows[0].consumed_at,null);
 assert.equal((await rpc('dekez_collection_setup_check')).state,'ready');
 assert.equal((await rpc('dekez_collection_setup_check',old)).state,'revoked');
 assert.equal((await claim(old)).state,'revoked');
 await assert.rejects(issue(),/must be retired/);await operator(retire);
 await assert.rejects(issue(id(3),id(202)),/lifetime authorization/);await grants(false);
});
test('fresh Super Admin, company membership and module permissions gate issuance atomically',async()=>{
 await operator(sql);
 for(const patch of ["role='tenant'","registration_status='pending'"]){
  await db.exec(`update profiles set ${patch} where id='${id(3)}'`);await assert.rejects(issue(),/Super Admin/);
  await db.exec(`update profiles set role='super_admin',registration_status='approved' where id='${id(3)}'`);
 }
 await db.exec(`update company_users set status='inactive' where id='${id(199)}'`);await assert.rejects(issue(),/company and module/);
 await db.exec(`update company_users set status='active' where id='${id(199)}';insert into user_module_permissions values('${id(3)}','admin_setup','none')`);
 await assert.rejects(issue(),/company and module/);await grants(false);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.callback_setup')).rows[0].n,1);
});
test('v2 retains atomic single use, immutable uncertainty and secure retirement without grants widening',async()=>{
 await operator(sql);await issue();const before=await record();
 assert.equal((await claim()).state,'claimed');assert.equal((await claim()).state,'used');
 await db.rpcQuery('select public.dekez_collection_setup_finish($1,$2,$3,$4)',[company,id(3),id(201),'uncertain']);
 await assert.rejects(db.rpcQuery('select public.dekez_collection_setup_finish($1,$2,$3,$4)',[company,id(3),id(201),'verified']),/immutable/);
 await operator(retire);await grants(false);assert.deepEqual(await record(),before);
 assert.equal((await db.query("select count(*) n from dekez_collections_private.callback_setup where revoked_at is not null")).rows[0].n,2);
 for(const role of ['anon','authenticated','service_role'])
  assert.equal((await db.query("select has_any_column_privilege($1,'dekez_collections_private.callback_setup','SELECT,INSERT,UPDATE,REFERENCES') ok",[role])).rows[0].ok,false);
 await assert.rejects(issue(id(3),id(202)),/lifetime authorization/);
});
test('expired or revoked v2 cannot be consumed and no browser user can authorize or execute it',async()=>{
 await operator(sql);await issue();
 await db.exec("update dekez_collections_private.callback_setup set created_at=created_at-interval '20 minutes',expires_at=expires_at-interval '20 minutes' where operation_key='rental_callback_v2'");
 assert.equal((await claim()).state,'expired');assert.equal((await rpc('dekez_collection_setup_check')).state,'expired');
 await db.exec("update dekez_collections_private.callback_setup set revoked_at=clock_timestamp() where operation_key='rental_callback_v2'");
 assert.equal((await claim()).state,'revoked');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(db.exec(`select public.dekez_collection_setup_check('${company}','${id(3)}','${id(201)}')`),/permission denied/);
  await assert.rejects(db.exec("insert into dekez_collections_private.callback_setup(id) values(gen_random_uuid())"),/permission denied/);
  await db.exec('reset role');
 }
 assert.equal((await db.query("select consumed_at from dekez_collections_private.callback_setup where operation_key='rental_callback_v2'")).rows[0].consumed_at,null);
});
test('authorization failure rolls back row and partial grants; owner memberships exactly restored',async()=>{
 await operator(sql);
 const before=(await db.query("select coalesce(jsonb_agg(to_jsonb(m) order by grantor),'[]') v from pg_auth_members m where roleid='dekez_collection_executor'::regrole and member='fixture_migrator'::regrole")).rows[0].v;
 const broken=authorize.replace('notify pgrst,\'reload schema\';',()=>"do $$ begin raise exception 'Synthetic failure'; end $$;");
 await db.query("select set_config('dekez.callback_v2.actor',$1,false),set_config('dekez.callback_v2.operation',$2,false)",[id(3),id(201)]);
 await assert.rejects(operator(broken),/Synthetic failure/);await grants(false);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.callback_setup')).rows[0].n,1);
 await issue();
 assert.deepEqual((await db.query("select coalesce(jsonb_agg(to_jsonb(m) order by grantor),'[]') v from pg_auth_members m where roleid='dekez_collection_executor'::regrole and member='fixture_migrator'::regrole")).rows[0].v,before);
});

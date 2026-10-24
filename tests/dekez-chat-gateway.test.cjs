const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
let db;
const source=file=>fs.readFileSync('supabase/migrations/'+file,'utf8');
function definition(file,name){const sql=source(file),start=sql.indexOf('create function '+name+'('),end=sql.indexOf('$$;',start);assert.ok(start>=0&&end>start);return sql.slice(start,end+3);}
test.before(async()=>{
 db=await require('./fixtures/chat/database.cjs')({desks:false});
 await db.exec(`create schema owner_private;create schema marketplace_private;create table auth.users(id uuid,raw_app_meta_data jsonb);create role authenticator;
 alter role authenticator set pgrst.db_pre_request='marketplace_private.check_request';create publication supabase_realtime;
 grant usage on schema owner_private,marketplace_private to authenticated,anon,service_role;`);
 await db.exec(definition('20261022131625_client_owner_portal.sql','owner_private.is_client'));
 await db.exec(definition('20261022131625_client_owner_portal.sql','owner_private.check_request'));
 await db.exec(definition('20261023075136_contractor_preview_access.sql','marketplace_private.is_preview'));
 await db.exec(definition('20261023075136_contractor_preview_access.sql','marketplace_private.check_request'));
 await db.exec(source('20261024030355_dekez_chat_gateway_and_realtime.sql'));
 await db.exec(source('20261024060911_dekez_chat_contact_desks.sql'));
 await db.exec(source('20261024152754_dekez_chat_mvp.sql'));
});
test.after(async()=>db?.close());
async function check(n,path,method){await db.as(n,"select set_config('request.path',$1,false),set_config('request.method',$2,false)",[path,method]);return db.as(n,'select dekez_chat_private.check_request()');}
test('gateway admits only narrow chat RPCs for enrolled Owner and Contractor; legacy boundaries remain',async()=>{
 for(const actor of [1,4]){
  for(const [path,method]of [['rpc/dekez_chat_summary','GET'],['rpc/dekez_chat_history','GET'],['rpc/dekez_chat_send','POST'],['rpc/dekez_chat_file_access','POST']])await check(actor,path,method);
  for(const [path,method]of [['rpc/dekez_chat_send','GET'],['rpc/dekez_chat_file_uploaded','POST'],['rpc/dekez_chat_anything','POST'],['dekez_messages','GET'],['payments','GET'],['rpc/verify_payment','POST'],['whatsapp_messages','GET']])await assert.rejects(check(actor,path,method));
  await check(actor,'profiles','GET');
 }
 await check(1,'rpc/client_owner_snapshot','POST');await assert.rejects(check(4,'rpc/client_owner_snapshot','POST'));
});
test('disabled or changed-role contractor loses chat gateway access; old endpoint policies still run',async()=>{
 await db.query('update dekez_chat_private.members set enabled=false where user_id=$1',[db.id(4)]);
 await assert.rejects(check(4,'rpc/dekez_chat_history','GET'));
 await db.query('update dekez_chat_private.members set enabled=true where user_id=$1',[db.id(4)]);
 await db.query("update dekez_chat_private.members set profile_role='tenant',chat_role='tenant' where user_id=$1",[db.id(4)]);
 await assert.rejects(check(4,'rpc/dekez_chat_send','POST'));
});
test('publication contains only the minimal caller signal and no messages or legacy tables',async()=>{
 assert.deepEqual((await db.query("select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime'")).rows,[{schemaname:'public',tablename:'dekez_chat_signals'}]);
 assert.equal((await db.query("select has_function_privilege('authenticated','public.dekez_chat_file_uploaded(uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);
});
test('HTTP middleware permits exact chat APIs only when enabled, not arbitrary preview actions',async()=>{
 const load=require('./marketplace-component-loader.cjs'),{NextRequest}=require('next/server');
 const saved=process.env.DEKEZ_CHAT_ENABLED;process.env.DEKEZ_CHAT_ENABLED='true';process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture';
 const query={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role:'contractor_preview',registration_status:'approved'}})};
 const {updateSession}=load({'@supabase/ssr':{createServerClient:()=>({auth:{getClaims:async()=>({data:{claims:{sub:'fixture',app_metadata:{role:'contractor_preview'}}}})},from:()=>query})},'@/lib/supabase/config':{normalizeSupabaseUrl:x=>x}})('lib/supabase/middleware.ts');
 try{
  for(const path of ['/api/dekez-chat','/api/dekez-chat/files'])assert.equal((await updateSession(new NextRequest('https://test.invalid'+path,{method:'POST'}))).status,200);
  for(const path of ['/api/dekez-chat/other','/api/dekez-chat/files/other','/api/payments','/admin/marketplace/contractor-preview/dashboard'])assert.equal((await updateSession(new NextRequest('https://test.invalid'+path,{method:'POST'}))).status,403);
  process.env.DEKEZ_CHAT_ENABLED='false';assert.equal((await updateSession(new NextRequest('https://test.invalid/api/dekez-chat',{method:'POST'}))).status,403);
 }finally{if(saved===undefined)delete process.env.DEKEZ_CHAT_ENABLED;else process.env.DEKEZ_CHAT_ENABLED=saved;}
});

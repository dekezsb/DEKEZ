const test=require('node:test'),assert=require('node:assert/strict');
const loader=require('./marketplace-component-loader.cjs');
function fixture({denied=false,sessionError=null,existing=false,finalizeError=null,auditError=null,enableError=null}={}){
 const events=[];
 const admin={from(table){return {select(){return this},in:async()=>({data:existing?[{id:'old'}]:[],error:null}),insert:async row=>{events.push(['audit',row]);return {error:auditError}}}},
  rpc:async(name,args)=>{events.push(['finalize',name,args]);return {error:finalizeError}},auth:{admin:{
   createUser:async input=>{events.push(['create',input]);return {data:{user:{id:'new'}},error:null}},
   updateUserById:async(id,input)=>{events.push(['enable',id,input]);return {error:enableError}},
  }}};
 const action=loader({'server-only':{},
  '@/lib/auth/registration':{phoneAuthAlias:()=> 'fixture@auth.dekez.invalid'},
  '@/lib/auth/session':{requireRole:async(roles,requirement)=>{assert.deepEqual(roles,['super_admin']);assert.deepEqual(requirement,{module:'admin_setup',level:'manage'});events.push(['authorize']);if(denied)throw Error('denied')}},
  '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:sessionError?null:{id:'actor'}},error:sessionError})}})},
  '@/lib/supabase/admin':{createAdminClient:()=>admin},
  '@/lib/marketplace/preview-credential':{previewPassword:()=> 'derived-secret-not-raw'},
 })('app/admin/marketplace/test-login/actions.ts').createPreviewLogin;
 const form=new FormData();form.set('phone','01111111111');form.set('password','fixture-password');form.set('confirm','yes');
 return {action,form,events};
}
test('only fresh signed-in Super Admin may create restricted preview; blocked before DB work',async()=>{
 const f=fixture({denied:true});await assert.rejects(()=>f.action({},f.form),/denied/);assert.equal(f.events.length,1);
 const expired=fixture({sessionError:{}});assert.equal((await expired.action({},expired.form)).status,'error');assert.equal(expired.events.length,1);
});
test('provisioning creates banned identity, finalizes/audits then enables only that new preview account',async()=>{
 const f=fixture();f.form.set('role','super_admin');const result=await f.action({},f.form);
 assert.equal(result.status,'success');assert.deepEqual(f.events.map(e=>e[0]),['authorize','create','finalize','audit','enable']);
 const created=f.events[1][1];assert.equal(created.app_metadata.role,'contractor_preview');assert.equal(created.password,'derived-secret-not-raw');assert.ok(created.ban_duration);
 assert.equal(f.events[2][2].p_id,'new');assert.equal(f.events[3][1].actor_profile_id,'actor');assert.equal(f.events[4][1],'new');assert.equal(f.events[4][2].app_metadata.role,'contractor_preview');
 assert.ok(!JSON.stringify(result).includes('fixture-password'));
});
test('existing account, missing confirmation and invalid input cannot create, reset or convert an identity',async()=>{
 const f=fixture({existing:true});assert.equal((await f.action({},f.form)).status,'error');assert.deepEqual(f.events.map(e=>e[0]),['authorize']);
 for(const [key,value] of [['confirm',''],['phone','invalid'],['password','1234']]){
  const s=fixture();s.form.set(key,value);assert.equal((await s.action({},s.form)).status,'error');assert.equal(s.events.length,1);
 }
});
test('finalization and audit failures leave the new identity banned, never reset or delete an existing user',async()=>{
 for(const options of [{finalizeError:{}},{auditError:{}}]){
  const f=fixture(options);assert.equal((await f.action({},f.form)).status,'error');assert.equal(f.events.some(e=>e[0]==='enable'),false);
 }
});

const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./marketplace-component-loader.cjs');
const {NextRequest,NextResponse}=require('next/server');
const {resolveUserAccess}=load()('lib/auth/access.ts');
test('preview role cannot gain internal modules even with explicit permission rows',()=>{
 const access=resolveUserAccess('contractor_preview',[{module_key:'reports',access_level:'manage'},{module_key:'dashboard',access_level:'manage'}]);
 assert.ok(Object.values(access).every(v=>v==='none'));
});
function middleware(role='contractor_preview',approved=true){
 const calls=[];const profile={role,registration_status:approved?'approved':'rejected'};
 const query={select(){return this},eq(){return this},maybeSingle:async()=>({data:profile})};
 const fn=load({'@supabase/ssr':{createServerClient:()=>({auth:{getClaims:async()=>({data:{claims:{sub:'id',app_metadata:{role}}}})},from:t=>{calls.push(t);return query}}) },'@/lib/supabase/config':{normalizeSupabaseUrl:x=>x}})('lib/supabase/middleware.ts').updateSession;
 return {fn,calls};
}
test('pilot can navigate only preview/login/logout; all other GETs redirect, actions are denied',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';
 const {fn,calls}=middleware();
 for(const path of ['/admin/marketplace/contractor-preview/dashboard','/admin/marketplace/contractor-preview/profile','/login/contractor','/logout'])
 assert.equal((await fn(new NextRequest('https://dekez.test'+path))).headers.get('location'),null);
 for(const path of ['/reports','/owner/home','/admin/marketplace','/api/rental-billing','/tenants','/dashboard']) {
 assert.match((await fn(new NextRequest('https://dekez.test'+path))).headers.get('location'),/contractor-preview\/dashboard$/);
 assert.equal((await fn(new NextRequest('https://dekez.test'+path,{method:'POST'}))).status,403);
 }
 assert.equal((await fn(new NextRequest('https://dekez.test/admin/marketplace/contractor-preview/dashboard',{method:'POST'}))).status,403);
 assert.ok(calls.every(t=>t==='profiles'));
 assert.equal((await fn(new NextRequest('https://dekez.test/logout',{method:'POST'}))).status,200);
 assert.match((await middleware('contractor_preview',false).fn(new NextRequest('https://dekez.test/reports'))).headers.get('location'),/\/login\/contractor$/);
});
test('approved Admin middleware keeps access and makes no duplicate profile query',async()=>{
 const {fn,calls}=middleware('super_admin');
 assert.equal((await fn(new NextRequest('https://dekez.test/reports'))).headers.get('location'),null);
 assert.deepEqual(calls,['profiles']);
});
function handler({allowed=true,limitError=null,credentialError=null,role='contractor_preview',approved=true}={}) {
 const calls=[];
 const query={select(){return this},in(){return this},maybeSingle:async()=>({data:{id:'pilot',role,registration_status:approved?'approved':'rejected'}})};
 const admin={from:()=>query,rpc:async()=>{calls.push('reserve');return {data:allowed,error:limitError}},auth:{admin:{getUserById:async()=>({data:{user:{id:'pilot',email:'pilot@auth.dekez.invalid',app_metadata:{role}}}})}}};
 const fn=load({
 '@supabase/ssr':{createServerClient:()=>({auth:{signInWithPassword:async input=>{calls.push('verify');assert.equal(input.password,'derived-not-raw');return {data:{user:{id:'pilot'}},error:credentialError}}}})},
 '@/lib/supabase/admin':{createAdminClient:()=>admin},'@/lib/supabase/config':{normalizeSupabaseUrl:x=>x},
 '@/lib/auth/registration':{phoneRateLimitKey:()=> 'a'.repeat(43)},'@/lib/auth/tenant-account':{},
 '@/lib/marketplace/preview-credential':{previewPassword:()=> 'derived-not-raw'},
 })('app/auth/sign-in/route.ts').POST;
 return {fn,calls};
}
const request=origin=>new NextRequest('https://dekez.test/auth/sign-in',{method:'POST',headers:{origin:origin??'https://dekez.test','content-type':'application/json'},body:JSON.stringify({phone:'0192223333',password:'test-secret-only'})});
test('pilot login reserves attempt before verifying and returns only restricted destination',async()=>{
 const {fn,calls}=handler();const response=await fn(request());assert.equal(response.status,200);
 assert.deepEqual(calls,['reserve','verify']);assert.equal((await response.json()).redirectTo,'/admin/marketplace/contractor-preview/dashboard');
});
test('pilot login fails closed for cross-origin, limiter outage, exhausted attempts and bad credentials',async()=>{
 for(const [options,status,origin] of [[{},403,'https://evil.test'],[{allowed:false},429],[{limitError:{}},503],[{credentialError:{}},401],[{approved:false},401]]){
 const {fn,calls}=handler(options);const res=await fn(request(origin));assert.equal(res.status,status);assert.equal(res.headers.get('set-cookie'),null);
 if(status!==401) assert.ok(!calls.includes('verify'));
 }
});

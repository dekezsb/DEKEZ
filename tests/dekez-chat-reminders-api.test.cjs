const test=require('node:test'),assert=require('node:assert/strict');
const loader=require('./marketplace-component-loader.cjs');
let calls=[],error=null,throws=false;
const api=loader({'@/lib/supabase/admin':{createAdminClient:()=>{
 calls.push('client');if(throws)throw Error('private connection failure');
 return {rpc:async(name,args)=>{calls.push({name,args});return {data:{sent:0,failed:0},error};}};}}})('app/api/dekez-chat-reminders/route.ts');
const keys=['CRON_SECRET','DEKEZ_CHAT_ENABLED','DEKEZ_CHAT_REMINDERS_ENABLED','DEKEZ_CHAT_REMINDERS_SEND'];
const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const request=(auth='Bearer local-fixture-secret',query='')=>new Request(`http://localhost/api/dekez-chat-reminders${query}`,{headers:{authorization:auth}});
test.beforeEach(()=>{calls=[];error=null;throws=false;for(const k of keys)delete process.env[k];process.env.CRON_SECRET='local-fixture-secret';});
test.after(()=>{for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}});
test('missing, malformed and wrong cron credentials never connect to database',async()=>{
 for(const auth of ['','Bearer undefined','Bearer wrong'])assert.equal((await api.GET(request(auth))).status,401);
 delete process.env.CRON_SECRET;assert.equal((await api.GET(request('Bearer undefined'))).status,401);assert.deepEqual(calls,[]);
});
test('disabled reminder deployment has no backend calls',async()=>{
 assert.deepEqual(await (await api.GET(request())).json(),{disabled:true});assert.deepEqual(calls,[]);
});
test('enabled worker defaults to read-only preview and ignores caller sender/date/body',async()=>{
 process.env.DEKEZ_CHAT_ENABLED='true';process.env.DEKEZ_CHAT_REMINDERS_ENABLED='true';
 const response=await api.GET(request(undefined,'?sender=other&date=1900-01-01&preview=false'));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(calls[1],{name:'dekez_chat_reminders',args:{p_preview:true}});
});
test('send requires explicit switch; authorized operator can still force safe preview',async()=>{
 process.env.DEKEZ_CHAT_ENABLED='true';process.env.DEKEZ_CHAT_REMINDERS_ENABLED='true';process.env.DEKEZ_CHAT_REMINDERS_SEND='true';
 await api.GET(request());assert.equal(calls[1].args.p_preview,false);
 calls=[];await api.GET(request(undefined,'?preview=true'));assert.equal(calls[1].args.p_preview,true);
});
test('backend failure returns safe retry response with no secrets/raw SQL',async()=>{
 process.env.DEKEZ_CHAT_ENABLED='true';process.env.DEKEZ_CHAT_REMINDERS_ENABLED='true';error={message:'secret SQL and token'};
 const r=await api.GET(request());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret|SQL|token/);
 throws=true;assert.equal((await api.GET(request())).status,503);
});

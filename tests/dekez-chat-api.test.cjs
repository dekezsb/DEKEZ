const test=require('node:test'),assert=require('node:assert/strict');
const loader=require('./marketplace-component-loader.cjs');
const id='00000000-0000-0000-0000-000000000001';
let calls=[],signedIn=true,error=null;
const api=loader({'@/lib/supabase/server':{createClient:async()=>{
 calls.push('client');return {auth:{getUser:async()=>({data:{user:signedIn?{id}:null}})},
 rpc:async(name,args)=>{calls.push({name,args});return {data:[{id}],error};}};}}})('app/api/dekez-chat/route.ts');
const saved=process.env.DEKEZ_CHAT_ENABLED;
test.after(()=>{if(saved===undefined)delete process.env.DEKEZ_CHAT_ENABLED;else process.env.DEKEZ_CHAT_ENABLED=saved;});
const request=(body,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/dekez-chat',{
 method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('disabled chat does not connect to a backend',async()=>{
 delete process.env.DEKEZ_CHAT_ENABLED;calls=[];
 assert.equal((await api.GET(new Request('http://localhost:3000/api/dekez-chat'))).status,503);
 assert.equal(calls.length,0);
});
test('server rejects missing session and cross-origin sends',async()=>{
 process.env.DEKEZ_CHAT_ENABLED='true';signedIn=false;
 assert.equal((await api.GET(new Request('http://localhost:3000/api/dekez-chat'))).status,401);
 signedIn=true;calls=[];
 assert.equal((await api.POST(request({action:'send'},'https://attacker.invalid'))).status,403);
 assert.equal(calls.length,0);
});
test('server forwards only validated commands with the end-user client',async()=>{
 calls=[];
 const res=await api.POST(request({action:'send',conversationId:id,body:'Hello',clientKey:id}));
 assert.equal(res.status,200);
 assert.equal(calls[1].name,'dekez_chat_send');
 assert.deepEqual(Object.keys(calls[1].args).sort(),['p_body','p_conversation','p_key']);
 assert.equal(res.headers.get('cache-control'),'private, no-store');
 assert.deepEqual((await res.json()).data,{id},'singleton composite response has a consistent application shape');
});
test('backend privacy denial is preserved and raw errors are not exposed',async()=>{
 error={code:'42501',message:'secret SQL and private information'};
 const res=await api.POST(request({action:'send',conversationId:id,body:'Hello',clientKey:id}));
 assert.equal(res.status,403);assert.doesNotMatch(await res.text(),/secret|SQL/);error=null;
});
test('large chunked JSON payloads cannot bypass the body limit',async()=>{
 const res=await api.POST(request({action:'send',conversationId:id,body:'x'.repeat(70000),clientKey:id}));
 assert.equal(res.status,413);
});

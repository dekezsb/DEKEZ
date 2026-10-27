// Synthetic-only diagnostics. Never use real provider credentials or requests.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const loader=require('./marketplace-component-loader.cjs');
const KEYS=['VERCEL_ENV','VERCEL_DEPLOYMENT_ID','DEKEZ_REPORT_COMMANDS_ENABLED','DEKEZ_REPORT_COMPANY_ID','WHAPI_REPORT_TO','WHAPI_TOKEN','WHAPI_REPORT_WEBHOOK_SECRET','CRON_SECRET'];
const saved=Object.fromEntries(KEYS.map(key=>[key,process.env[key]])),originalFetch=global.fetch,originalNow=Date.now;
const TOKEN='synthetic_token_private_NEVER_RETURN',SECRET='synthetic_webhook_secret_0123456789_ABCD';
const CALLBACK='https://dekez.vercel.app/api/webhooks/whapi-reporting';
let actor,now,health,settings,calls,authCalls,handler,authHandler;
const read=loader({'server-only':{},'@/lib/management-report/authorization':{
  reportAdministrator:async()=>{authCalls++;return authHandler?authHandler():actor;},
}})('lib/management-report/temporary-whapi-diagnostic.ts').readTemporaryWhapiDiagnostic;
const expected=()=>({url:CALLBACK,mode:'body',events:[{type:'messages',method:'post'}],headers:{Authorization:`Bearer ${SECRET}`},webhook_max_age_seconds:900});
function configure(){Object.assign(process.env,{VERCEL_ENV:'production',VERCEL_DEPLOYMENT_ID:'dpl_synthetic0123456789',
  DEKEZ_REPORT_COMMANDS_ENABLED:'false',DEKEZ_REPORT_COMPANY_ID:'660cc0c4-daee-445b-9146-ccd112e791d4',WHAPI_REPORT_TO:'60198894911',
  WHAPI_TOKEN:TOKEN,WHAPI_REPORT_WEBHOOK_SECRET:SECRET,CRON_SECRET:'private_different_cron_secret'});}
test.beforeEach(()=>{for(const key of KEYS)delete process.env[key];configure();
  actor='synthetic-admin';now=Date.parse('2026-10-27T01:30:00Z');Date.now=()=>now;
  health={channel_id:'FALCON-D9NS9',status:{text:'AUTH'}};settings={webhooks:[]};calls=[];authCalls=0;handler=null;authHandler=null;
  global.fetch=async(url,options)=>{calls.push({url,options});if(handler)return handler(url,options);
    if(url==='https://gate.whapi.cloud/health?wakeup=false')return Response.json(health);
    assert.equal(url,'https://gate.whapi.cloud/settings');return Response.json(settings);};
});
test.after(()=>{global.fetch=originalFetch;Date.now=originalNow;for(const key of KEYS){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
function sanitized(value){assert.doesNotMatch(JSON.stringify(value),new RegExp(`${TOKEN}|${SECRET}|private_|FALCON|60198894911|660cc0c4|https://`));}
async function row(hook){settings={webhooks:[hook]};const result=await read();assert.equal(result.status,'ready');sanitized(result);return result.report.matchingCallbacks[0];}

test('fresh authorized Admin required for every diagnostic read',async()=>{
  actor=null;assert.equal((await read()).code,'ADMIN_REQUIRED');assert.equal(calls.length,0);
  authHandler=()=>{throw Error('private_auth_error '+TOKEN);};sanitized(await read());assert.equal(calls.length,0);
  authHandler=null;actor='synthetic-admin';await read();await read();assert.equal(authCalls,4);
});
test('production deployment company recipient command-off and distinct secrets are required',async()=>{
  for(const [key,value] of [['VERCEL_ENV','preview'],['VERCEL_DEPLOYMENT_ID',''],['DEKEZ_REPORT_COMPANY_ID','private_wrong_company'],
    ['WHAPI_REPORT_TO','60168173911'],['DEKEZ_REPORT_COMMANDS_ENABLED','true'],['DEKEZ_REPORT_COMMANDS_ENABLED','unexpected'],
    ['WHAPI_TOKEN',''],['WHAPI_TOKEN','private_\ninvalid'],['WHAPI_REPORT_WEBHOOK_SECRET','short'],['WHAPI_REPORT_WEBHOOK_SECRET',TOKEN],['CRON_SECRET',SECRET]]){
    configure();process.env[key]=value;const result=await read();assert.equal(result.code,'CONFIGURATION_UNAVAILABLE');sanitized(result);
  }assert.equal(calls.length,0);
  configure();delete process.env.DEKEZ_REPORT_COMMANDS_ENABLED;assert.equal((await read()).status,'ready');
});
test('hard expiry denies new requests at the boundary and before a second request',async()=>{
  now=Date.parse('2026-10-27T01:59:59Z');assert.equal((await read()).status,'ready');
  calls=[];now=Date.parse('2026-10-27T02:00:00Z');assert.equal((await read()).code,'CONFIGURATION_UNAVAILABLE');assert.equal(calls.length,0);
  now-=1000;handler=()=>{now+=1000;return Response.json(health);};assert.equal((await read()).code,'CONFIGURATION_UNAVAILABLE');assert.equal(calls.length,1);
});
test('fixed GET-only health then settings use bounded no-cache nonredirecting requests',async()=>{
  const result=await read();assert.equal(result.status,'ready');sanitized(result);
  assert.deepEqual(calls.map(call=>call.url),['https://gate.whapi.cloud/health?wakeup=false','https://gate.whapi.cloud/settings']);
  for(const {options} of calls){assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
    assert.ok(options.signal instanceof AbortSignal);assert.equal(options.headers.Authorization,`Bearer ${TOKEN}`);assert.equal(options.body,undefined);}
});
test('channel mismatch or non-AUTH status never reads settings',async()=>{
  for(const [value,code] of [[null,'HEALTH_RESPONSE_INVALID'],[{channel_id:'OTHER',status:{text:'AUTH'}},'CHANNEL_MISMATCH'],
    [{channel_id:'FALCON-D9NS9',status:{text:'DISCONNECTED'}},'CHANNEL_NOT_AUTHENTICATED']]){
    health=value;calls=[];const result=await read();assert.equal(result.code,code);sanitized(result);assert.equal(calls.length,1);
  }
});
test('empty and omitted webhooks are safe counts while invalid containers fail closed',async()=>{
  for(const value of [{},{webhooks:[]}]){settings=value;const result=await read();assert.equal(result.report.callbackCount,0);assert.equal(result.report.matchingUrlCount,0);}
  for(const value of [null,[],{webhooks:null},{webhooks:{}},{webhooks:new Array(51).fill({})}]){settings=value;assert.equal((await read()).code,'SETTINGS_INVALID');}
});
test('URL matching counts exact and normalized targets without returning URLs or unrelated records',async()=>{
  settings={webhooks:[expected(),{...expected(),url:CALLBACK+'/'},{...expected(),url:CALLBACK+'?private_query=secret'},
    {url:'https://private_other.example/other',headers:{private_key:'private_value'}},{url:''},{url:'private_invalid'},null]};
  const result=await read();sanitized(result);assert.equal(result.report.callbackCount,7);assert.equal(result.report.matchingUrlCount,3);
  assert.equal(result.report.exactUrlCount,1);assert.equal(result.report.malformedCallbackCount,2);
  assert.deepEqual(result.report.matchingCallbacks.map(item=>item.exactUrlMatch),[true,false,false]);
});
test('exact callback reports only safe comparisons and count fields',async()=>{
  const value=await row(expected());assert.equal(value.exactExpectedMatch,true);assert.equal(value.shapeValid,true);
  assert.equal(value.mode,'body');assert.equal(value.eventsExactMatch,true);assert.equal(value.requiredMessagesPostPresent,true);
  assert.equal(value.authorizationExactKeyCount,1);assert.equal(value.authorizationCaseInsensitiveKeyCount,1);
  assert.equal(value.exactBearerSecretMatch,true);assert.equal(value.headerCount,1);assert.equal(value.extraFieldCount,0);
  assert.equal(value.onlyHeaderDifferences,false);assert.equal(value.onlyKnownSafeDefaultDifferences,false);
});
test('documented false default is distinguishable from true invalid and unknown added settings',async()=>{
  const safe=await row({...expected(),send_undecrypted_ad:false});assert.equal(safe.sendUndecryptedAd,'false');
  assert.equal(safe.extraFieldCount,1);assert.equal(safe.unexpectedFieldCount,0);assert.equal(safe.onlyKnownSafeDefaultDifferences,true);
  assert.equal(safe.exactExpectedMatch,false);assert.equal(safe.onlyHeaderCaseOrKnownSafeDefaultDifferences,true);
  for(const value of [true,null,'false',0]){const result=await row({...expected(),send_undecrypted_ad:value});assert.equal(result.onlyKnownSafeDefaultDifferences,false);}
  const unknown=await row({...expected(),send_undecrypted_ad:false,private_unknown_field:{private_nested:TOKEN}});
  assert.equal(unknown.extraFieldCount,2);assert.equal(unknown.unexpectedFieldCount,1);assert.equal(unknown.onlyKnownSafeDefaultDifferences,false);sanitized(unknown);
});
test('Authorization casing can be identified without exposing any key spelling or secret',async()=>{
  const lower=await row({...expected(),headers:{authorization:`Bearer ${SECRET}`}});
  assert.equal(lower.authorizationExactKeyCount,0);assert.equal(lower.authorizationCaseInsensitiveKeyCount,1);
  assert.equal(lower.exactBearerSecretMatch,false);assert.equal(lower.caseInsensitiveAuthorizationValueMatch,true);
  assert.equal(lower.onlyAuthorizationKeyCaseDifference,true);assert.equal(lower.onlyHeaderDifferences,true);
  const combined=await row({...expected(),headers:{AUTHORIZATION:`Bearer ${SECRET}`},send_undecrypted_ad:false});
  assert.equal(combined.onlyHeaderCaseOrKnownSafeDefaultDifferences,true);assert.equal(combined.onlyKnownSafeDefaultDifferences,false);
});
test('wrong missing duplicate and additional authentication headers are not called safe equivalents',async()=>{
  for(const headers of [undefined,null,[],{}, {Authorization:'Bearer private_wrong'}, {Authorization:SECRET},
    {Authorization:`bearer ${SECRET}`},{Authorization:`Bearer ${SECRET}`,authorization:`Bearer ${SECRET}`},
    {Authorization:`Bearer ${SECRET}`,private_other:'private_value'},{Authorization:123}]){
    const value=await row({...expected(),headers});assert.equal(value.exactExpectedMatch,false);
    assert.equal(value.onlyAuthorizationKeyCaseDifference,false);assert.equal(value.onlyHeaderCaseOrKnownSafeDefaultDifferences,false);sanitized(value);
  }
});
test('mode events and event multiplicity are reported as fixed enums and exact match booleans',async()=>{
  for(const [mode,classification] of [['path','path'],['method','method'],['query','other'],['private_mode','other'],[undefined,'missing']]){
    const hook=expected();if(mode===undefined)delete hook.mode;else hook.mode=mode;const value=await row(hook);
    assert.equal(value.mode,classification);assert.equal(value.expectedModeMatch,false);assert.equal(value.exactExpectedMatch,false);
  }
  for(const events of [null,[],[{type:'messages',method:'POST'}],[{type:'messages',method:'post',private_extra:true}],
    [{type:'messages',method:'post'},{type:'messages',method:'post'}]]){
    const value=await row({...expected(),events});assert.equal(value.eventsExactMatch,false);assert.equal(value.onlyKnownSafeDefaultDifferences,false);
    assert.equal(value.eventCount,Array.isArray(events)?events.length:null);sanitized(value);
  }
});
test('max age exposes only expected match and bounded numeric classification not the returned value',async()=>{
  for(const [age,classification,numeric] of [[900,'expected',true],[999,'other-number',true],[0,'other-number',true],[-1,'invalid',false],
    [2147483648,'invalid',false],['private_age','invalid',false],[null,'invalid',false],[undefined,'missing',false]]){
    const hook=expected();if(age===undefined)delete hook.webhook_max_age_seconds;else hook.webhook_max_age_seconds=age;
    const value=await row(hook);assert.equal(value.maxAge,classification);assert.equal(value.maxAgeBoundedNumericPresent,numeric);
    assert.equal(value.maxAgeExpectedMatch,age===900);assert.equal(Object.hasOwn(value,'webhook_max_age_seconds'),false);
  }
});
test('transport HTTP JSON and oversized response failures return fixed codes without provider data',async()=>{
  for(const [code,responder] of [
    ['HEALTH_REQUEST_FAILED',()=>{throw Error('private_error '+TOKEN);}],['HEALTH_HTTP_FAILED',()=>new Response('private_error '+SECRET,{status:403})],
    ['HEALTH_RESPONSE_INVALID',()=>new Response('private_error '+TOKEN,{headers:{'Content-Type':'application/json'}})],
    ['HEALTH_RESPONSE_INVALID',()=>Response.json({private_body:'x'.repeat(65537)})],
    ['SETTINGS_REQUEST_FAILED',(url)=>{if(url.includes('/health?'))return Response.json(health);throw Error('private_error '+TOKEN);}],
    ['SETTINGS_HTTP_FAILED',(url)=>url.includes('/health?')?Response.json(health):new Response('private_error '+SECRET,{status:500})],
    ['SETTINGS_RESPONSE_INVALID',(url)=>url.includes('/health?')?Response.json(health):new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'999999'}})],
  ]){handler=responder;const result=await read();assert.equal(result.code,code);assert.equal(result.status,'blocked');sanitized(result);}
});
test('Admin page renders only sanitized report and has no form action or client execution',async()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');settings={webhooks:[{...expected(),send_undecrypted_ad:false}]};
  const page=loader({'@/lib/management-report/temporary-whapi-diagnostic':{readTemporaryWhapiDiagnostic:read}})('app/admin-setup/management-report/whapi-diagnostic/page.tsx');
  assert.equal(page.dynamic,'force-dynamic');assert.equal(page.revalidate,0);
  const html=renderToStaticMarkup(await page.default());assert.match(html,/Read-only/);assert.doesNotMatch(html,/<form|<button|<script|private_|synthetic_token|synthetic_webhook/);
  assert.equal(authCalls,1);
});
test('source has no write method message endpoint database mutation or secret output path',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../lib/management-report/temporary-whapi-diagnostic.ts'),'utf8');
  assert.match(source,/import "server-only"/);assert.match(source,/method: "GET"/);assert.match(source,/const ORIGIN = "https:\/\/gate\.whapi\.cloud"/);
  assert.doesNotMatch(source,/method:\s*"(?:POST|PUT|PATCH|DELETE)"|messages\/text|\/contacts\/|createAdminClient|\.rpc\(|console\.(?:log|error)|process\.env\.[A-Z_]+\s*=(?!=)/);
  assert.doesNotMatch(source,/from ["'][^"']*(?:service|whapi)["']/);
});

// Synthetic-only provider responses. No application credentials or live calls.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const loader = require('./marketplace-component-loader.cjs');
const KEYS = ['DEKEZ_WHAPI_SETUP_ENABLED','DEKEZ_WHAPI_SETUP_EXPIRES_AT','DEKEZ_REPORT_COMMANDS_ENABLED',
  'DEKEZ_REPORT_COMPANY_ID','WHAPI_REPORT_TO','WHAPI_TOKEN','WHAPI_REPORT_WEBHOOK_SECRET','CRON_SECRET','VERCEL_DEPLOYMENT_ID','VERCEL_ENV'];
const saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
const originalFetch = global.fetch, originalNow = Date.now;
const SECRET = 'synthetic_webhook_secret_0123456789_ABCD';
const TOKEN = 'synthetic_channel_token_NEVER_UI';
const ADMIN = '00000000-0000-0000-0000-000000000003';
const URL = 'https://dekez.vercel.app/api/webhooks/whapi-reporting';
let actor, now, current, health, calls, authCalls, handler, patchHandler, authHandler;
const clone = value => JSON.parse(JSON.stringify(value));
const desired = () => ({ url: URL, mode:'body', events:[{type:'messages',method:'post'}],
  headers:{Authorization:`Bearer ${SECRET}`}, webhook_max_age_seconds:900 });
const normalized = value => ({pdo_sync:true,offline_mode:false,full_history:false,auto_read_messages:false,locale:'',...clone(value)});
const setup = loader({'server-only':{},'@/lib/management-report/authorization':{
  reportAdministrator:async()=>{authCalls++;return authHandler ? authHandler() : actor;},
}})('lib/management-report/temporary-whapi-setup.ts');

function configure() {
  Object.assign(process.env, {DEKEZ_WHAPI_SETUP_ENABLED:'true',DEKEZ_WHAPI_SETUP_EXPIRES_AT:'2026-10-27T01:00:00Z',
    DEKEZ_REPORT_COMMANDS_ENABLED:'false',DEKEZ_REPORT_COMPANY_ID:'660cc0c4-daee-445b-9146-ccd112e791d4',WHAPI_REPORT_TO:'60198894911',
    WHAPI_TOKEN:TOKEN,WHAPI_REPORT_WEBHOOK_SECRET:SECRET,CRON_SECRET:'synthetic_distinct_cron_secret',
    VERCEL_DEPLOYMENT_ID:'dpl_synthetic0123456789',VERCEL_ENV:'production'});
}
test.beforeEach(()=>{
  for(const key of KEYS) delete process.env[key]; configure();
  actor=ADMIN;now=Date.parse('2026-10-27T00:45:00Z');Date.now=()=>now;
  current={webhooks:[]};health={channel_id:'FALCON-D9NS9',status:{text:'AUTH'},user:{phone:'60168173911'}};
  calls=[];authCalls=0;handler=null;patchHandler=null;authHandler=null;
  global.fetch=async(url,options)=>{
    calls.push({url,options});
    if(handler)return handler(url,options);
    if(url==='https://gate.whapi.cloud/health?wakeup=false')return Response.json(health);
    assert.equal(url,'https://gate.whapi.cloud/settings');
    if(options.method==='GET')return Response.json(current);
    assert.equal(options.method,'PATCH');
    if(patchHandler)return patchHandler(options);
    const before=clone(current);current=JSON.parse(options.body);
    return Response.json({before_update:before,after_update:current,changes:['webhooks']});
  };
});
test.after(()=>{global.fetch=originalFetch;Date.now=originalNow;
  for(const key of KEYS){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
const patchCount=()=>calls.filter(call=>call.options.method==='PATCH').length;
const preview=async()=>{const state=await setup.runSetup('preview');assert.equal(state.phase,'preview');assert.ok(state.ticket);return state.ticket;};
function noSecrets(value){assert.doesNotMatch(JSON.stringify(value),new RegExp(`${SECRET}|${TOKEN}|synthetic_distinct_cron_secret|private-provider-error`));}

test('disabled, expired and non-production control fails closed without network',async()=>{
  for(const [key,value] of [
    ['DEKEZ_WHAPI_SETUP_ENABLED',undefined],['DEKEZ_WHAPI_SETUP_ENABLED','false'],
    ['DEKEZ_WHAPI_SETUP_EXPIRES_AT','2026-10-27T00:44:59Z'],['DEKEZ_WHAPI_SETUP_EXPIRES_AT','2026-10-27T02:00:00Z'],
    ['DEKEZ_WHAPI_SETUP_EXPIRES_AT','not-a-date'],['DEKEZ_REPORT_COMMANDS_ENABLED','true'],['DEKEZ_REPORT_COMMANDS_ENABLED','unexpected'],
    ['VERCEL_ENV','preview'],['VERCEL_DEPLOYMENT_ID',''],['DEKEZ_REPORT_COMPANY_ID','wrong-company'],
    ['WHAPI_REPORT_TO','60168173911'],['WHAPI_TOKEN',''],['WHAPI_REPORT_WEBHOOK_SECRET','short'],
    ['WHAPI_REPORT_WEBHOOK_SECRET',TOKEN],['CRON_SECRET',SECRET],
  ]){
    configure();if(value===undefined)delete process.env[key];else process.env[key]=value;
    assert.equal(setup.getSetupAvailability().available,false,key);
    const state=await setup.runSetup('preview');assert.equal(state.phase,'blocked',key);noSecrets(state);
  }
  assert.equal(calls.length,0);
});

test('hard build-bound expiry cannot be extended through environment changes',async()=>{
  process.env.DEKEZ_WHAPI_SETUP_EXPIRES_AT='2026-10-27T01:15:00.000Z';
  now=Date.parse('2026-10-27T01:14:59Z');assert.equal(setup.getSetupAvailability().available,true);
  now=Date.parse('2026-10-27T01:15:00Z');assert.equal(setup.getSetupAvailability().available,false);
  assert.equal((await setup.runSetup('preview')).phase,'blocked');assert.equal(calls.length,0);
});

test('fresh Admin authorization required for every intent, including already-configured callbacks',async()=>{
  const ticket=await preview();calls=[];actor=null;current={webhooks:[desired()]};
  for(const intent of ['preview','apply','verify'])assert.equal((await setup.runSetup(intent,ticket)).phase,'blocked');
  assert.equal(calls.length,0);assert.equal(authCalls,4);
  authHandler=()=>{throw Error('private-auth-failure');};noSecrets(await setup.runSetup('preview'));
});

test('health binds exact channel and AUTH state and rejects explicit contradictory phone metadata',async()=>{
  for(const bad of [
    {channel_id:'OTHER',status:{text:'AUTH'},user:{phone:'60168173911'}},
    {channel_id:'FALCON-D9NS9',status:{text:'DISCONNECTED'},user:{phone:'60168173911'}},
    {channel_id:'FALCON-D9NS9',status:{text:'AUTH'},user:{phone:'60198894911'}},
    {channel_id:'FALCON-D9NS9',status:{text:'AUTH'},user:{phone:'++60168173911'}},
  ]){health=bad;const state=await setup.runSetup('preview');assert.equal(state.phase,'blocked');noSecrets(state);}
  assert.ok(calls.every(call=>call.url==='https://gate.whapi.cloud/health?wakeup=false'));
  health={channel_id:'FALCON-D9NS9',status:{text:'AUTH'},user:{phone:'+60168173911'}};
  assert.equal((await setup.runSetup('preview')).phase,'preview');
});

test('present invalid or mismatching health phone cannot be overridden by a matching full account ID',async()=>{
  for(const phone of [123,false,{},[],'60198894911','++60168173911','60168173911@s.whatsapp.net',' ']){
    health.user={phone,id:'60168173911@s.whatsapp.net'};
    const state=await setup.runSetup('preview');assert.equal(state.phase,'blocked');noSecrets(state);
  }
  assert.ok(calls.every(call=>call.url.includes('/health?')));assert.equal(patchCount(),0);
});

test('missing null and empty phone data permit only the approved authenticated channel with a truthful notice',async()=>{
  for(const user of [undefined,null,{}, {phone:null},{phone:''},{id:null},{id:''}]){
    health.user=user;calls=[];const state=await setup.runSetup('preview');
    assert.equal(state.phase,'preview');assert.match(state.message,/Approved authenticated channel verified/);
    assert.match(state.message,/existing connection is unchanged/);assert.match(state.message,/Phone metadata is unavailable and has not been independently verified/);
    assert.deepEqual(calls.map(call=>call.url),['https://gate.whapi.cloud/health?wakeup=false','https://gate.whapi.cloud/settings']);
    assert.ok(calls.every(call=>call.options.method==='GET'));noSecrets(state);
  }
  assert.equal(patchCount(),0);
});

test('bare IDs LIDs and opaque strings are not treated as phone proof and cannot select a contact endpoint',async()=>{
  for(const id of ['60168173911','60198894911','123456789012345@lid','60168173911@lid','invalid@lid',
    '../settings','https://evil.example/contact','60168173911?full=true','60168173911@s.whatsapp.net.evil']){
    health.user={id};calls=[];const state=await setup.runSetup('preview');
    assert.equal(state.phase,'preview');assert.match(state.message,/Phone metadata is unavailable and has not been independently verified/);
    assert.deepEqual(calls.map(call=>call.url),['https://gate.whapi.cloud/health?wakeup=false','https://gate.whapi.cloud/settings']);
    assert.doesNotMatch(JSON.stringify(state),/60168173911|60198894911|123456789012345|evil\.example/);
  }
  assert.equal(patchCount(),0);
});

test('full phone JID metadata corroborates the sender but a contradictory full JID always blocks',async()=>{
  health.user={id:'60168173911@s.whatsapp.net'};
  const state=await setup.runSetup('preview');assert.equal(state.phase,'preview');
  assert.match(state.message,/Phone metadata is unavailable; the returned full account ID matches/);
  for(const id of ['60198894911@s.whatsapp.net','+60168173911@s.whatsapp.net','invalid@s.whatsapp.net']){
    for(const phone of [undefined,null,'','60168173911']){
      health.user={id,phone};calls=[];const rejected=await setup.runSetup('preview');
      assert.equal(rejected.phase,'blocked');assert.equal(rejected.code,'SENDER_PHONE_MISMATCH');
      assert.equal(calls.length,1);noSecrets(rejected);
    }
  }
  assert.equal(patchCount(),0);
});

test('malformed nonnull optional sender types fail closed without contacts or settings',async()=>{
  for(const user of [false,0,'',[],{phone:0},{phone:false},{phone:{}},{phone:[]},{id:0},{id:false},{id:{}},{id:[]}]){
    health.user=user;calls=[];const state=await setup.runSetup('preview');
    assert.equal(state.phase,'blocked');assert.equal(state.code,'SENDER_METADATA_INVALID');assert.equal(calls.length,1);
  }
  assert.equal(patchCount(),0);
});

test('optional sender metadata never bypasses Admin configuration channel or authenticated-status gates',async()=>{
  health.user={id:'123456789012345@lid'};
  actor=null;assert.equal((await setup.runSetup('preview')).phase,'blocked');actor=ADMIN;
  process.env.DEKEZ_REPORT_COMPANY_ID='wrong';assert.equal((await setup.runSetup('preview')).phase,'blocked');configure();
  assert.equal(calls.length,0);
  health.channel_id='OTHER';assert.equal((await setup.runSetup('preview')).code,'CHANNEL_MISMATCH');
  health.channel_id='FALCON-D9NS9';health.status.text='DISCONNECTED';assert.equal((await setup.runSetup('preview')).code,'HEALTH_NOT_AUTHENTICATED');
  assert.ok(calls.every(call=>call.url.includes('/health?')));assert.equal(patchCount(),0);
});

test('Apply rechecks authenticated channel and rejects newly contradictory metadata before writing',async()=>{
  health.user={id:'123456789012345@lid'};
  const ticket=await preview();health.user.phone='60198894911';
  assert.equal((await setup.runSetup('apply',ticket)).code,'SENDER_PHONE_MISMATCH');assert.equal(patchCount(),0);
  delete health.user.phone;health.channel_id='OTHER';
  assert.equal((await setup.runSetup('apply',ticket)).code,'CHANNEL_MISMATCH');assert.equal(patchCount(),0);
  health.channel_id='FALCON-D9NS9';const result=await setup.runSetup('apply',ticket);
  assert.equal(result.phase,'verified');assert.match(result.message,/Phone metadata is unavailable and has not been independently verified/);
  assert.equal(patchCount(),1);assert.ok(calls.every(call=>!call.url.includes('/contacts/')));
});

test('preview is read-only, bounded, secret-free and restricted to fixed provider paths',async()=>{
  const state=await setup.runSetup('preview');assert.equal(state.phase,'preview');assert.equal(state.existingWebhooks,0);noSecrets(state);
  assert.equal(patchCount(),0);assert.equal(calls.length,2);
  for(const {url,options} of calls){
    assert.ok(['https://gate.whapi.cloud/health?wakeup=false','https://gate.whapi.cloud/settings'].includes(url));
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization,`Bearer ${TOKEN}`);assert.equal(options.method,'GET');
  }
  const payload=JSON.parse(Buffer.from(state.ticket.split('.')[0],'base64url').toString());
  assert.equal(payload.actor,ADMIN);assert.equal(payload.company,process.env.DEKEZ_REPORT_COMPANY_ID);
  assert.equal(payload.deployment,process.env.VERCEL_DEPLOYMENT_ID);assert.equal(payload.expires-payload.issued,120000);noSecrets(payload);
});

test('apply preserves all known fields, documented omitted defaults, locale and other webhook headers/events',async()=>{
  const other={url:'https://existing.example.test/callback',mode:'body',events:[{type:'statuses',method:'post'}],headers:{'X-Existing-Secret':'private-existing-header'},webhook_max_age_seconds:3600};
  current={webhooks:[other],callback_backoff_delay_ms:5000,max_callback_backoff_delay_ms:1800000,callback_persist:true,
    media:{auto_download:['image','document'],init_avatars:false},proxy:'socks5://private:password@proxy.example.test:8888',
    proxy_trust_filters:false,mobile_proxy:'',locale:'ms-MY',mock_pairing_code:'',ignored_presences:['typing'],data_mode:'original'};
  const original=clone(current),ticket=await preview();const state=await setup.runSetup('apply',ticket);
  assert.equal(state.phase,'verified');assert.equal(patchCount(),1);assert.equal(calls.filter(c=>c.options.method==='GET').length,5);
  assert.deepEqual(current,{...normalized(original),webhooks:[other,desired()]});
  noSecrets(state);assert.doesNotMatch(JSON.stringify(state),/private-existing-header|private:password/);
  assert.equal(authCalls,3);assert.equal(process.env.DEKEZ_REPORT_COMMANDS_ENABLED,'false');
});

test('documented omitted webhooks normalize to an empty array without changing other settings',async()=>{
  current={locale:'ms-MY',outgoing_calls_enabled:false};
  const original=clone(current),ticket=await preview();
  assert.equal((await setup.runSetup('apply',ticket)).phase,'verified');
  assert.deepEqual(current,{...normalized(original),webhooks:[desired()]});assert.equal(patchCount(),1);
});

test('exact blank webhook URL rows are preserved verbatim and never count as the approved callback',async()=>{
  const blank={url:'',mode:'body',events:[{type:'statuses',method:'post'}],headers:{'X-Existing':'private-existing-header'},webhook_max_age_seconds:60};
  current={webhooks:[blank],outgoing_calls_enabled:true};
  const ticket=await preview(),state=await setup.runSetup('apply',ticket);
  assert.equal(state.phase,'verified');assert.deepEqual(current.webhooks,[blank,desired()]);
  assert.equal(current.outgoing_calls_enabled,true);assert.equal(patchCount(),1);noSecrets(state);
  assert.doesNotMatch(JSON.stringify(state),/private-existing-header/);
  assert.equal((await setup.runSetup('apply',ticket)).phase,'verified');assert.equal(patchCount(),1);
});

test('only absent webhooks normalize; null, invalid rows and nonempty malformed URLs still block',async()=>{
  for(const webhooks of [null,{},'',0,[null],[{}],[{url:null}],[{url:123}],[{url:' '}],[{url:'not a URL'}]]){
    current={webhooks};const state=await setup.runSetup('preview');
    assert.equal(state.phase,'blocked');assert.equal(state.code,'WEBHOOK_MALFORMED');
  }
  for(const outgoing_calls_enabled of [null,'true',1,{}]){
    current={outgoing_calls_enabled};const state=await setup.runSetup('preview');
    assert.equal(state.phase,'blocked');assert.equal(state.code,'SETTINGS_INVALID');
  }
  assert.equal(patchCount(),0);
});

test('changed settings after preview prevent PATCH instead of overwriting concurrent updates',async()=>{
  const ticket=await preview();current.locale='en-MY';
  const state=await setup.runSetup('apply',ticket);assert.equal(state.phase,'blocked');assert.equal(patchCount(),0);assert.equal(current.locale,'en-MY');
});

test('unknown settings and invalid known fields fail closed before preparing mutation',async()=>{
  for(const bad of [{webhooks:[],new_provider_field:true},{webhooks:[],pdo_sync:'true'},{webhooks:[],locale:null},{webhooks:{}},{webhooks:[{url:'not a URL'}]}]){
    current=bad;assert.equal((await setup.runSetup('preview')).phase,'blocked');
  }
  assert.equal(patchCount(),0);
});

test('conflicting target callback auth, mode, events, URL or duplicate target never gets replaced',async()=>{
  const conflicts=[{...desired(),mode:'form'},{...desired(),headers:{Authorization:'Bearer wrong'}},
    {...desired(),events:[{type:'messages',method:'get'}]},{...desired(),url:URL+'?secret=wrong'},
    {...desired(),url:URL+'/'},{...desired(),webhook_max_age_seconds:999}];
  for(const conflict of conflicts){current={webhooks:[conflict]};assert.equal((await setup.runSetup('preview')).phase,'blocked');}
  current={webhooks:[desired(),desired()]};assert.equal((await setup.runSetup('preview')).phase,'blocked');assert.equal(patchCount(),0);
});

test('forged, stale, actor-swapped, deployment-swapped and rotated-secret tickets cannot authorize Apply',async()=>{
  const ticket=await preview();calls=[];
  const [payload,sig]=ticket.split('.');
  for(const invalid of [undefined,'bad',ticket+'X',payload+'.'+(sig[0]==='A'?'B':'A')+sig.slice(1)])assert.equal((await setup.runSetup('apply',invalid)).phase,'blocked');
  actor='00000000-0000-0000-0000-000000000004';assert.equal((await setup.runSetup('apply',ticket)).phase,'blocked');actor=ADMIN;
  process.env.VERCEL_DEPLOYMENT_ID='dpl_other0123456789';assert.equal((await setup.runSetup('apply',ticket)).phase,'blocked');configure();
  process.env.WHAPI_REPORT_WEBHOOK_SECRET='rotated_synthetic_secret_012345678901234';assert.equal((await setup.runSetup('apply',ticket)).phase,'blocked');configure();
  now+=120000;assert.equal((await setup.runSetup('apply',ticket)).phase,'blocked');assert.equal(calls.length,0);
});

test('missing confirmation ticket never executes even if the callback is already configured',async()=>{
  current={webhooks:[desired()]};assert.equal((await setup.runSetup('apply')).phase,'blocked');assert.equal(calls.length,0);
});

test('expiry and demotion during preflight abort before the only PATCH',async()=>{
  const ticket=await preview();
  authHandler=()=>authCalls>=3?null:ADMIN;
  assert.equal((await setup.runSetup('apply',ticket)).phase,'blocked');assert.equal(patchCount(),0);
  authHandler=null;const nextTicket=await preview();
  handler=async(url)=>{if(url.includes('/health?'))return Response.json(health);now+=120001;return Response.json(current);};
  assert.equal((await setup.runSetup('apply',nextTicket)).phase,'blocked');assert.equal(patchCount(),0);
});

test('repeat Apply is a verified no-op and Verify never writes',async()=>{
  const ticket=await preview();assert.equal((await setup.runSetup('apply',ticket)).phase,'verified');
  assert.equal((await setup.runSetup('apply',ticket)).phase,'verified');assert.equal(patchCount(),1);
  assert.equal((await setup.runSetup('verify',ticket)).phase,'verified');assert.equal(patchCount(),1);
  current={webhooks:[]};assert.equal((await setup.runSetup('verify')).phase,'blocked');assert.equal(patchCount(),1);
});

test('existing exact callback needs no update or new confirmation',async()=>{
  current={webhooks:[desired()],locale:'ms-MY'};
  assert.equal((await setup.runSetup('preview')).phase,'verified');assert.equal((await setup.runSetup('verify')).phase,'verified');assert.equal(patchCount(),0);
});

test('PATCH timeout with independently verified settings does not cause a retry',async()=>{
  const ticket=await preview();patchHandler=options=>{current=JSON.parse(options.body);throw Error('private-provider-error possibly accepted');};
  const state=await setup.runSetup('apply',ticket);assert.equal(state.phase,'verified');assert.equal(patchCount(),1);noSecrets(state);
  assert.equal((await setup.runSetup('apply',ticket)).phase,'verified');assert.equal(patchCount(),1);
});

test('PATCH timeout plus failed readback is uncertain and never retries',async()=>{
  const ticket=await preview();let patched=false;
  handler=async(url,options)=>{
    if(url.includes('/health?'))return Response.json(health);
    if(options.method==='PATCH'){patched=true;throw Error('private-provider-error '+TOKEN);}
    if(patched)throw Error('private-provider-error '+SECRET);
    return Response.json(current);
  };
  const state=await setup.runSetup('apply',ticket);assert.equal(state.phase,'uncertain');assert.match(state.message,/Do not repeat Apply/);
  assert.equal(patchCount(),1);noSecrets(state);
});

test('unexpected PATCH side effects or mismatching before/after evidence never report success',async()=>{
  for(const mode of ['changes','before','after','missing']){
    current={webhooks:[]};const ticket=await preview();
    patchHandler=options=>{const before=clone(current);current=JSON.parse(options.body);return Response.json({
      ...(mode==='missing'?{}:{before_update:mode==='before'?{...before,locale:'altered'}:before,after_update:mode==='after'?{...current,locale:'altered'}:current}),
      changes:mode==='changes'?['webhooks','locale']:['webhooks'],
    });};
    const state=await setup.runSetup('apply',ticket);assert.equal(state.phase,'uncertain',mode);noSecrets(state);
  }
  assert.equal(patchCount(),4);
});

test('independent readback must equal all requested settings, not only the new callback',async()=>{
  const ticket=await preview();patchHandler=options=>{
    const before=clone(current),after=JSON.parse(options.body);current={...after,locale:'unexpected'};
    return Response.json({before_update:before,after_update:after,changes:['webhooks']});
  };
  assert.equal((await setup.runSetup('apply',ticket)).phase,'uncertain');assert.equal(patchCount(),1);
});

test('uncertain UI keeps the snapshot ticket; read-only action cannot hide unexpected locale changes or expiry',async()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const ticket=await preview();
  patchHandler=options=>{
    const before=clone(current),after=JSON.parse(options.body);current={...after,locale:'unexpected'};
    return Response.json({before_update:before,after_update:current,changes:['webhooks','locale']});
  };
  const uncertain=await setup.runSetup('apply',ticket);assert.equal(uncertain.phase,'uncertain');assert.equal(uncertain.ticket,ticket);
  const control=loader({react:{...React,useActionState:()=>[uncertain,async()=>{},false]},
    './actions':{temporarySetupAction:async()=>{throw Error('Rendering must not act');}},
  })('app/admin-setup/management-report/whapi-setup/setup-control.tsx').TemporarySetupControl;
  const html=renderToStaticMarkup(React.createElement(control));
  assert.match(html,new RegExp(`<input[^>]*name="ticket"[^>]*value="${ticket.replaceAll('.','\\.')}"`));
  assert.match(html,/value="verify"/);assert.doesNotMatch(html,/value="apply"|value="preview"/);
  const actions=loader({'@/lib/management-report/temporary-whapi-setup':{runSetup:setup.runSetup}})('app/admin-setup/management-report/whapi-setup/actions.ts');
  const form=new FormData();form.set('intent','verify');form.set('ticket',ticket);
  assert.equal((await actions.temporarySetupAction(uncertain,form)).phase,'blocked');assert.equal(patchCount(),1);
  now+=120000;const before=calls.length;
  assert.equal((await actions.temporarySetupAction(uncertain,form)).phase,'blocked');assert.equal(calls.length,before);assert.equal(patchCount(),1);
});

test('bounded provider responses, malformed JSON and errors remain sanitized without writes',async()=>{
  for(const response of [()=>new Response('private-provider-error '+TOKEN,{status:500}),()=>new Response('bad',{headers:{'Content-Type':'application/json'}}),
    ()=>Response.json({private:'x'.repeat(65537)}),()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'999999'}})]){
    handler=response;const state=await setup.runSetup('preview');assert.equal(state.phase,'blocked');noSecrets(state);
  }
  assert.equal(patchCount(),0);
});

test('read-only diagnostics distinguish authorization, config and each identity check without values',async()=>{
  const assertCode=async code=>{
    const state=await setup.runSetup('preview');assert.equal(state.phase,'blocked');assert.equal(state.code,code);
    assert.match(state.message,new RegExp(`Check code: ${code}\\.`));noSecrets(state);
    assert.doesNotMatch(JSON.stringify(state),/FALCON|60168173911|60198894911|private-auth-failure|private-channel|private-status|private-sender/);
  };
  actor=null;await assertCode('ADMIN_AUTHORIZATION_FAILED');actor=ADMIN;
  authHandler=()=>{throw Error('private-auth-failure '+TOKEN);};await assertCode('ADMIN_AUTHORIZATION_FAILED');authHandler=null;
  process.env.WHAPI_REPORT_TO='private-recipient';await assertCode('CONFIGURATION_UNAVAILABLE');configure();
  assert.equal(calls.length,0);
  health={channel_id:'private-channel',status:{text:'AUTH'},user:{phone:'60168173911'}};await assertCode('CHANNEL_MISMATCH');
  health={channel_id:'FALCON-D9NS9',status:{text:'private-status'},user:{phone:'60168173911'}};await assertCode('HEALTH_NOT_AUTHENTICATED');
  health={channel_id:'FALCON-D9NS9',status:{text:'AUTH'},user:{phone:123}};await assertCode('SENDER_METADATA_INVALID');
  health.user={phone:'private-sender'};await assertCode('SENDER_PHONE_MISMATCH');
  assert.ok(calls.every(call=>call.url.includes('/health?')));assert.equal(patchCount(),0);
});

test('transport and response diagnostics are fixed codes, never provider status/body/error details',async()=>{
  const cases=[
    ['HEALTH_REQUEST_FAILED',()=>{throw Error('private-provider-error '+TOKEN);} ],
    ['HEALTH_HTTP_FAILED',()=>new Response('private-provider-error '+SECRET,{status:403})],
    ['HEALTH_RESPONSE_INVALID',()=>new Response('private-provider-error '+TOKEN,{headers:{'Content-Type':'application/json'}})],
    ['HEALTH_RESPONSE_INVALID',()=>Response.json(null)],
    ['SETTINGS_REQUEST_FAILED',(url)=>{if(url.includes('/health?'))return Response.json(health);throw Error('private-provider-error '+TOKEN);} ],
    ['SETTINGS_HTTP_FAILED',(url)=>url.includes('/health?')?Response.json(health):new Response('private-provider-error '+TOKEN,{status:500})],
    ['SETTINGS_RESPONSE_INVALID',(url)=>url.includes('/health?')?Response.json(health):new Response('private-provider-error '+SECRET,{headers:{'Content-Type':'application/json'}})],
    ['SETTINGS_INVALID',(url)=>Response.json(url.includes('/health?')?health:null)],
    ['UNKNOWN_SETTINGS_FIELD',(url)=>Response.json(url.includes('/health?')?health:{private_unknown_setting:SECRET})],
    ['WEBHOOK_MALFORMED',(url)=>Response.json(url.includes('/health?')?health:{webhooks:[{url:'private-invalid-url'}]})],
    ['CALLBACK_CONFLICT',(url)=>Response.json(url.includes('/health?')?health:{webhooks:[{...desired(),headers:{Authorization:'private-conflicting-header'}}]})],
  ];
  for(const [code,respond] of cases){
    handler=respond;const first=await setup.runSetup('preview'),second=await setup.runSetup('preview');
    assert.equal(first.phase,'blocked');assert.equal(first.code,code);assert.deepEqual(second,first);
    noSecrets(first);assert.doesNotMatch(JSON.stringify(first),/private_unknown_setting|private-invalid-url|private-conflicting-header|403|500/);
  }
  assert.equal(patchCount(),0);
});

test('overflowing nested provider numbers cannot be silently rewritten as null',async()=>{
  handler=async(url)=>url.includes('/health?')?Response.json(health):new Response('{"webhooks":[],"media":{"unknown_number":1e999}}',{headers:{'Content-Type':'application/json'}});
  assert.equal((await setup.runSetup('preview')).phase,'blocked');assert.equal(patchCount(),0);
});

test('source has no messages endpoint, SQL writes, environment mutation or unrestricted provider origin',()=>{
  const code=fs.readFileSync(require('node:path').join(__dirname,'../lib/management-report/temporary-whapi-setup.ts'),'utf8');
  assert.match(code,/import "server-only"/);assert.doesNotMatch(code,/messages\/text|\/contacts\/|createAdminClient|\.rpc\(|process\.env\.[A-Z_]+\s*=(?!=)|console\.(?:log|error)/);
  assert.match(code,/const ORIGIN = "https:\/\/gate\.whapi\.cloud"/);assert.match(code,/not a durable one-use claim/);
});

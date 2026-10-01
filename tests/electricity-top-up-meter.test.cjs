const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
for(const ext of ['.ts','.tsx'])Module._extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {resolveEffectiveTopUpMeter}=require('../lib/smart-meter/effective-top-up-meter.ts');
const {TopUpCreditForm}=require('../app/verification/top-up-credit-form.tsx');
const meter=(id,extra={})=>({id,room_id:'room-1',meter_type:'electricity',status:'active',updated_at:'2026-10-01T00:00:00Z',...extra});
const renderForm=(hasMeter)=>renderToStaticMarkup(React.createElement(TopUpCreditForm,{action(){},hasMeter,requestId:'req-1'}));
const migrations=path.join(root,'supabase/migrations');
const latestCreditRpc=()=>{
 const files=fs.readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort().filter(f=>/function public\.confirm_smart_meter_top_up_credit\(/.test(fs.readFileSync(path.join(migrations,f),'utf8')));
 return {file:files.at(-1),sql:fs.readFileSync(path.join(migrations,files.at(-1)),'utf8')};
};

test('request with no meter_id uses the room\'s current active meter, so the page shows the meter-credit flow',()=>{
 const roomMeter=meter('meter-new');
 const resolved=resolveEffectiveTopUpMeter({meter_id:null,room_id:'room-1'},[roomMeter]);
 assert.equal(resolved,roomMeter);
 const html=renderForm(Boolean(resolved));
 for(const text of ['Physical meter/provider reference','Enter only after the meter credit succeeds','Confirm Meter Credited'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Confirm Payment Recorded/);
});

test('room with no active electricity meter shows the payment-recorded flow',()=>{
 const meters=[meter('inactive',{status:'inactive'}),meter('water',{meter_type:'water'}),meter('other-room',{room_id:'room-2'})];
 const resolved=resolveEffectiveTopUpMeter({meter_id:null,room_id:'room-1'},meters);
 assert.equal(resolved,null);
 const html=renderForm(Boolean(resolved));
 for(const text of ['Payment reference','Enter the bank/payment reference to mark this as paid','Confirm Payment Recorded'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Confirm Meter Credited|Physical meter/);
});

test('resolver mirrors the RPC lookup: exact meter_id first, latest updated_at, no room fallback when meter_id is set',()=>{
 const older=meter('older',{updated_at:'2026-09-01T00:00:00Z'}),newer=meter('newer',{updated_at:'2026-09-30T00:00:00Z'});
 assert.equal(resolveEffectiveTopUpMeter({meter_id:null,room_id:'room-1'},[older,newer]).id,'newer');
 const assigned=meter('assigned',{room_id:'room-9',updated_at:'2026-01-01T00:00:00Z'});
 assert.equal(resolveEffectiveTopUpMeter({meter_id:'assigned',room_id:'room-1'},[newer,assigned]).id,'assigned');
 // Stored meter is no longer active: the RPC does not fall back to the room.
 assert.equal(resolveEffectiveTopUpMeter({meter_id:'assigned',room_id:'room-1'},[newer,{...assigned,status:'inactive'}]),null);
 const rpc=latestCreditRpc().sql;
 assert.match(rpc,/meter\.id = target_request\.meter_id\s+or \(\s+target_request\.meter_id is null\s+and meter\.room_id = target_request\.room_id\s+\)/);
 assert.match(rpc,/meter\.meter_type = 'electricity'\s+and meter\.status = 'active'\s+order by \(meter\.id = target_request\.meter_id\) desc, meter\.updated_at desc/);
});

test('credit RPC no longer requires a meter, so the old meter_missing handling is gone',()=>{
 const {file,sql}=latestCreditRpc();
 assert.equal(file,'20261001160519_optional_meter_credit_for_topup.sql');
 assert.doesNotMatch(sql.replace(/--.*$/gm,''),/active_electricity_meter_required/);
 assert.match(sql,/has_meter := target_meter\.id is not null/);
 const actions=fs.readFileSync(path.join(root,'app/verification/actions.ts'),'utf8');
 assert.doesNotMatch(actions,/active_electricity_meter_required|meter_missing/);
});

test('Verification page derives open-request meter flow from the shared resolver',()=>{
 const page=fs.readFileSync(path.join(root,'app/verification/page.tsx'),'utf8');
 assert.match(page,/resolveEffectiveTopUpMeter\(request, activeTopUpMeters\)/);
 assert.match(page,/<TopUpCreditForm\s+action=\{confirmSmartMeterCredit\}\s+hasMeter=\{Boolean\(meter\)\}/);
 assert.match(page,/effectiveMeterByRequest\.get\(request\.id\)/);
 assert.doesNotMatch(page,/!request\.meter_id \?/);
});

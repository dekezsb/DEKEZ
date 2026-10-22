// Read-only local visual harness: real AppShell, Claims page and form components.
// All auth/data/action boundaries are stubbed. Never connects to Supabase.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
const rows=Array.from({length:6},(_,i)=>({id:`c${i}`,property_id:'p',room_id:null,description:['Beverly hills key copy','Remote battery replacement','Long receipt filename and repair description '+ 'reference1234567890'.repeat(7),'Car service','Rejected repair claim','Test pen and switch'][i],total_amount:[48,9.5,16,280.3,280.3,5.3][i],funding_source:'staff_personal',bill_date:'2026-09-17',status:i===4?'rejected':i===1?'pending_owner_approval':'approved',properties:{name:'Sample Property'},rooms:null,rejection_reason:i===4?'Wrong method':null}));
const tables={properties:[{id:'p',name:'Sample Property'}],rooms:[],maintenance_tickets:[],claims:rows,claim_attachments:Array.from({length:6},(_,i)=>({id:`a${i}`,claim_id:'c0',bucket_name:'fixture',file_path:'receipt.svg',content_type:'image/png'})),staff_reimbursement_liabilities:[{claim_id:'c0',amount:48,status:'owed'},{claim_id:'c2',amount:16,status:'owed'}]};
const db={from(table){const result={data:tables[table]??[],error:null};const chain=new Proxy({}, {get:(_,key)=>key==='then'?(done)=>Promise.resolve(result).then(done):()=>chain});return chain;},storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:'/receipt.svg'}})};}}};
function loader(route){const cache=new Map();function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod);
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','module','exports',code)(name=>{
 if(name==='next/navigation')return {usePathname:()=>route,useRouter:()=>({refresh(){}})};
 if(name==='next/link')return {__esModule:true,default:({prefetch,children,...p})=>React.createElement('a',p,children)};
 if(name==='next/image')return {__esModule:true,default:({priority,...p})=>React.createElement('img',p)};
 if(name==='@/components/portal-live-sync')return {PortalLiveSync:()=>null};
 if(name==='@/components/language-provider')return {useLanguage:()=>({locale:'en',setLocale(){},t:k=>({'nav.home':'Home','nav.roomAvailability':'Room Availability','nav.rentDueTracker':'Rent Due Tracker','nav.maintenance':'Maintenance','nav.verification':'Verification','nav.claims':'Claims','nav.profile':'Profile','nav.renovation':'Renovation Quotes & Invoices','nav.reservations':'Reservations','nav.tenantMovements':'Monthly Check-ins & Check-outs','common.language':'Language','common.logout':'Logout','portal.management':'Management Portal'}[k]??k)})};
 if(name==='@/lib/auth/session')return {requireRole:async()=> 'admin'};
 if(name==='@/lib/data/organization')return {getCurrentUser:async()=>({id:'fixture'})};
 if(name==='@/lib/supabase/server')return {createClient:async()=>db};
 if(name==='@/lib/supabase/admin')return {createAdminClient:()=>db};
 if(name==='@/app/maintenance/actions')return {createClaimBill:()=>{throw Error('Fixture actions disabled');}};
 if(name.startsWith('@/')||name.startsWith('.')){const target=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);for(const ext of ['.ts','.tsx'])if(fs.existsSync(target+ext))return load(target+ext);}
 return require(name);
},mod,mod.exports);return mod.exports;}return load;}
(async()=>{const postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');const css=(await postcss([tailwind({base:root})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')})).css;
http.createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405);return res.end('Read-only fixture');}try{
 if(req.url==='/dekez-logo.jpg'){res.setHeader('Content-Type','image/jpeg');return res.end(fs.readFileSync(path.join(root,'public/dekez-logo.jpg')));}
 if(req.url==='/receipt.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect width="120" height="160" fill="white"/><text x="12" y="28" font-size="13">SAMPLE RECEIPT</text><path d="M12 48H108M12 68H108M12 88H108M12 108H80" stroke="#aaa"/></svg>');}
 const route=new URL(req.url,'http://localhost').pathname,load=loader(route),{AppShell}=load('components/app-shell.tsx');
 const claims=await load('app/claims/page.tsx').default({searchParams:Promise.resolve({})});
 const {resolveUserAccess}=load('lib/auth/access.ts');const access={...resolveUserAccess('admin'),reports:'manage',properties:'manage'};
 const html=renderToStaticMarkup(React.createElement(AppShell,{role:'admin',access,userName:'Sample Manager'},claims));
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>DEKEZ responsive fixture</title><style>${css}</style></head><body>${html}</body></html>`);
 }catch(e){console.error(e);res.statusCode=500;res.end('Preview failed');}}).listen(4188,'127.0.0.1',()=>console.log('Read-only responsive fixture http://127.0.0.1:4188/claims'));})();

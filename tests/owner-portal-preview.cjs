// Local-only visual harness. Fictional fixtures, no credentials/database access.
// Uses the real server component and stylesheet; never compiled into Next routes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(file){
 file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;
 const mod={exports:{}};cache.set(file,mod);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(id=>{
 if(id.startsWith('@/')||id.startsWith('.')){const target=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);
 if(target.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 for(const ext of ['.ts','.tsx'])if(fs.existsSync(target+ext))return load(target+ext);
 }return require(id);},mod,mod.exports);return mod.exports;
}
const {OwnerPortal}=load('components/owner/portal.tsx');
const fixture={profile:{name:'Alex Owner · Sample Portfolio',identity:'SAMPLE ONLY',phone:'Not provided',tin:'Not provided',address:'Sample address',bank_name:'Sample Bank',bank_holder:'Alex Owner',bank_number:'XXXX 1234'},properties:[{id:'a',name:'ABC Residence',address:'Kuala Lumpur',city:'Kuala Lumpur'},{id:'b',name:'Garden Residence',address:'Kota Kinabalu',city:'Kota Kinabalu'}],rooms:Array.from({length:20},(_,i)=>({id:`r${i}`,property_id:i<12?'a':'b',name:`Unit ${String(i+1).padStart(2,'0')}`,status:i<18?'occupied':'vacant',rent:600})),collections:[{id:'bill',property_id:'a',room_id:'r0',date:'2026-10-01',amount:600,paid:400,outstanding:200}],receipts:[{id:'pay',property_id:'a',room_id:'r0',bill_id:'bill',amount:400,date:'2026-10-10'}],expenses:[{id:'expense',property_id:'a',room_id:'r0',title:'Air-condition repair',summary:'Approved owner charge for compressor repair.',amount:350,date:'2026-10-18',status:'Included in statement'}],claims:[{id:'claim',property_id:'a',room_id:'r0',title:'Air-condition repair',summary:'Cooling restored after compressor replacement. Sample evidence record.',amount:350,claimed:300,chargeable:true,reported:'2026-10-18',completed:'2026-10-20',status:'Completed'}],documents:[{id:'doc',property_id:'a',share_id:'claim',title:'Repair invoice',category:'invoice',mime:'application/pdf',date:'2026-10-20'},{id:'agreement',property_id:'a',share_id:null,title:'Management Agreement',category:'agreement',mime:'application/pdf',date:'2026-01-01'},{id:'statement',property_id:'a',share_id:null,title:'October Owner Statement',category:'statement',mime:'application/pdf',date:'2026-10-20'}],agreements:[{id:'agreement',property_id:'a',document_id:'agreement',start:'2026-01-01',end:'2027-12-31',fee:'10% of rent collected',terminated:null}],statements:[{id:'statement',property_id:'a',document_id:'statement',period:'2026-10-01',income:10800,collected:10200,outstanding:600,expenses:1350,maintenance:0,fee:1080,net:7770,paid:7770}],payouts:[{id:'payout',property_id:'a',statement_id:'statement',amount:7770,date:'2026-10-20',reference:'SAMPLE-REF',proof_document_id:null}]};
http.createServer((req,res)=>{try{
 const css=fs.readFileSync(path.join(root,'components/owner/portal.module.css'),'utf8');
 const url=new URL(req.url,'http://127.0.0.1:4187');
 let section=url.pathname.replace(/^\/owner\//,'')||'home',detail;
 if(section.startsWith('properties/')){detail=section.split('/')[1];section='properties/detail';}
 if(section.startsWith('finance/maintenance-claims/')){detail=section.split('/')[2];section='finance/maintenance-claims/detail';}
 const data=structuredClone(fixture),property=url.searchParams.get('property')||'';
 if(url.searchParams.has('stress')) {
  data.profile.name='Alex Owner · Property Management and Investment Holdings';
  data.profile.address='A long owner address with a long postcode and building name for wrapping checks';
  data.profile.bank_number='123456789012345678901234567890';
  data.properties[0].name='ABC Residence — Long Property Name and Management Block';
  data.documents[0].title='Maintenance-repair-invoice-with-a-very-long-filename-and-reference-2026-October.pdf';
  data.receipts[0].amount=13100;
  data.collections[0].outstanding=600;
  data.statements=[];
  data.payouts=[];
 }
 if(property)for(const key of ['rooms','collections','receipts','expenses','claims','documents','agreements','statements','payouts'])data[key]=data[key].filter(r=>r.property_id===property);
 if(url.searchParams.has('empty'))for(const key of Object.keys(data))if(Array.isArray(data[key]))data[key]=[];
 const html=renderToStaticMarkup(React.createElement(OwnerPortal,{data,month:url.searchParams.get('month')||'2026-10',property,section,detail,email:'sample@example.invalid',query:url.searchParams.get('q')||'',category:url.searchParams.get('type')||'',year:url.searchParams.get('year')||''}));
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner Portal · Local preview</title><style>body{margin:0}button,input,select{font:inherit}a{color:inherit}${css}</style></head><body>${html}</body></html>`);
 }catch(e){res.statusCode=500;res.end('Preview failed');console.error(e.message);}}).listen(4187,'127.0.0.1',()=>console.log('Owner fixture preview: http://127.0.0.1:4187/owner/home (fictional data only)'));

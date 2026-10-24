const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n');
test('owner layout fix preserves all rendering logic, calculations, queries, routes and document security',()=>{
 const before={
  'components/owner/portal.tsx':'79ea16d67072645a65edc5bda4b723ead0cf0b1d4e060bbf8e1d55b43a6eabd5',
  'lib/owner/model.ts':'205d7211dea02acefeeb49f30e72c842d7a3d9884eb0bea3350224f63e1beebf',
  'lib/owner/data.ts':'1e6b5e1000e772fc9b4e2eddbb3af68566f1972b4d5bf75379fb0c66f2711714',
  'app/owner/[[...segments]]/page.tsx':'540e5de8a64b8dee85f74247aba89b976b669343a79852c02417adabddc67efe',
  'app/owner/documents/[id]/route.ts':'f346a44c3248290db8ce1a2652e8c6dbc16c3aa35469a2bf0b945e3543e73247'
 };
 // The only approved rendering addition is a disabled-by-default Messages link.
 // Strip exactly that addition; the original financial, document and route baseline remains enforced.
 const chatLink='{process.env.DEKEZ_CHAT_ENABLED==="true"?<ChatLauncher href="/owner/messages"/>:null}';
 const chatImport="import { ChatLauncher } from '@/components/chat/launcher';\n";
 assert.equal(read('components/owner/portal.tsx').split(chatImport).length,2);
 assert.equal(read('components/owner/portal.tsx').split(chatLink).length,2);
 for(const [file,hash] of Object.entries(before))assert.equal(crypto.createHash('sha256').update(file==='components/owner/portal.tsx'?read(file).replace(chatLink,'').replace(chatImport,''):read(file)).digest('hex'),hash,file+' changed beyond presentation; review baseline deliberately');
});
test('owner shell is fluid, navigation changes at 1024, inputs remain readable, tabs scroll locally',()=>{
 const css=read('components/owner/portal.module.css').replace(/\s+/g,'');
 assert.match(css,/\.main\{width:100%;min-width:0;max-width:none;margin:0\}/);
 assert.match(css,/\.sidebar\{display:none\}/);
 assert.match(css,/@media\(min-width:1024px\)\{\.portal\{padding-left:232px\}/);
 assert.match(css,/\.bottomNav\{display:none\}/);
 assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(css,/safe-area-inset-bottom/);assert.match(css,/safe-area-inset-top/);
 assert.match(css,/font-size:16px/);assert.match(css,/100dvh/);
 assert.match(css,/\.tabs\{display:flex;flex-wrap:nowrap;max-width:100%;overflow-x:auto/);
 assert.doesNotMatch(css,/(?:transform:.*scale|zoom:|overflow-x:hidden)/);
});
test('browser matrix covers every section, finance subtab, detail, requested size and ultrawide',()=>{
 const {sizes,pages}=require('./owner-layout-matrix.cjs');
 assert.equal(sizes.length,14);assert.equal(pages.length,12);
 for(const s of ['home','properties','finance','documents','profile','finance/maintenance-claims','finance/payouts','finance/statements'])assert.ok(pages.includes(s));
 assert.ok(sizes.some(([w,h])=>w===320&&h===568));assert.ok(sizes.some(([w,h])=>w===3440&&h===1440));
});

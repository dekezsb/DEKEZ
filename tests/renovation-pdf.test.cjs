const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=require('./renovation-loader.cjs');
const model=load('lib/renovation/model.ts'),language=load('lib/renovation/languages.ts'),{renovationPdf}=load('lib/renovation/pdf.ts');
const original='9MM G26 partition 2" × 4" - supply and install';
const items=Array.from({length:23},(_,i)=>({item_code:`PART-${i+1}`,description:original,quantity:1,unit:'SQ FT',rate:i===22?25147:1000,translation_source:original,translations:{en:original,ms:'Sekatan 9MM G26 2" × 4" - bekal dan pasang',zh:'9MM G26 隔墙 2" × 4" - 供应及安装'}}));
const d={id:'fictional',company_id:'test',kind:'invoice',status:'issued',document_number:'DRI-TEST-ONLY',client_id:'test',client_snapshot:{name:'TEST CUSTOMER 测试客户',phone:'',email:'',address:'Test address unchanged'},project:'Fictional renovation - test only',site_address:'Test site',document_date:'2026-10-20',due_date:'2026-11-20',version:1,discount_kind:'amount',discount_value:1547,discount_amount:1547,tax_rate:0,tax_amount:0,total:45600,items,stages:model.defaultStages,terms:model.defaultTerms,remarks:'Custom technical specification: 9MM G26'};
test('translations preserve every numerical amount, identity and item code, and reject changed specifications',()=>{
  const before=JSON.stringify(d);
  for(const lang of ['en','ms','zh']){
    const localized=language.localizedDocument(d,lang).document;
    assert.deepEqual(model.validateDocumentAmounts(localized),{subtotal:4714700,discount:154700,tax:0,total:4560000});
    assert.deepEqual(localized.client_snapshot,d.client_snapshot);assert.equal(localized.document_number,d.document_number);assert.equal(localized.project,d.project);
    assert.deepEqual(localized.items.map(i=>[i.item_code,i.quantity,i.unit,i.rate]),d.items.map(i=>[i.item_code,i.quantity,i.unit,i.rate]));
  }
  const wrong={'item:0':{source:original,text:'12MM G26 隔墙 2" × 4"'}};
  assert.equal(language.localizedDocument(d,'zh',wrong).document.items[0].description,original);
  assert.equal(language.safeTranslation(original,'9MM G26 隔墙 2" + 4"'),false);
  assert.equal(language.safeTranslation(original,'9MM G26 隔墙 4" × 2"'),false);
  assert.equal(language.safeTranslation('ABC-123 panel','XYZ-123 板'),false);
  assert.ok(language.localizedDocument(d,'zh',wrong).warnings.length>=2);
  const stale={...d,items:[{...items[0],description:'Changed 12MM partition'}]};
  assert.equal(language.localizedDocument(stale,'zh').document.items[0].description,'Changed 12MM partition');
  assert.equal(JSON.stringify(d),before);
});
test('amount words and totals are calculated rather than translated',()=>{
  assert.equal(language.amountInWords(45600,'zh'),'马来西亚令吉肆万伍仟陆佰整');
  assert.equal(language.amountInWords(10001.05,'zh'),'马来西亚令吉壹万零壹及伍仙');
  assert.match(language.amountInWords(45600,'ms'),/Empat Puluh Lima Ribu Enam Ratus/);
  assert.match(language.amountInWords(45600,'en'),/Forty Five Thousand Six Hundred/);
  assert.throws(()=>model.validateDocumentAmounts({...d,total:40000}),/totals/);
  assert.throws(()=>model.validateDocumentAmounts({...d,stages:[{label:'Deposit',percent:90}]}),/schedule/);
});
test('English, Malay and Chinese PDFs embed Unicode fonts and paginate the same saved document',async()=>{
  const assets={font:new Uint8Array(fs.readFileSync('public/fonts/NotoSansSC-Regular.ttf')),logo:new Uint8Array(fs.readFileSync('public/dekez-logo.jpg'))};
  const {PDFDocument,PDFName,PDFDict}=require('pdf-lib');
  const output=process.env.RENOVATION_PDF_OUTPUT;
  if(output)fs.mkdirSync(output,{recursive:true});
  for(const lang of ['en','ms','zh']){
    const review=language.suggestedTranslations(d,lang);
    if(lang==='ms')review.remarks={source:d.remarks,text:'Spesifikasi teknikal khas: 9MM G26'};
    if(lang==='zh')review.remarks={source:d.remarks,text:'定制技术规格：9MM G26'};
    const result=await renovationPdf(d,lang,review,assets);
    assert.deepEqual(result.warnings,[]);assert.ok(result.pages>=2);
    const parsed=await PDFDocument.load(result.bytes);
    assert.equal(parsed.getPageCount(),result.pages);
    const fonts=parsed.getPages()[0].node.Resources().lookup(PDFName.of('Font'),PDFDict);
    assert.ok(fonts.values().some(ref=>parsed.context.lookup(ref,PDFDict).has(PDFName.of('ToUnicode'))),'Embedded Unicode mapping');
    if(output)fs.writeFileSync(path.join(output,`renovation-${lang}.pdf`),result.bytes);
  }
});

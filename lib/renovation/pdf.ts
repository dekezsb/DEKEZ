import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { documentTotals, lineCents, stageAmounts, validateDocumentAmounts, type DocumentLanguage, type RenovationDocument } from "./model";
import { amountInWords, labels, localizedDocument, type TranslationReview } from "./languages";

export type PdfAssets={font:Uint8Array;logo:Uint8Array};
export async function renovationPdf(document:RenovationDocument,language:DocumentLanguage,review:TranslationReview|undefined,assets:PdfAssets,payments?:{verified:number;outstanding:number}) {
  validateDocumentAmounts(document);
  const {document:d,warnings}=localizedDocument(document,language,review),t=labels[language];
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  // Embed static TrueType outlines in full. CJK composite glyphs must not be
  // lost by the PDF library's incremental subsetter.
  const font=await pdf.embedFont(assets.font,{subset:false}),logo=await pdf.embedJpg(assets.logo);
  const latin=await pdf.embedFont(StandardFonts.Helvetica);
  const runs=(text:string)=>text.match(/[\x20-\x7E]+|[^\x20-\x7E]+/gu)??[];
  const fontFor=(text:string)=>/^[\x20-\x7E]+$/.test(text)?latin:font;
  const measure=(text:string,size:number)=>runs(text).reduce((sum,run)=>sum+fontFor(run).widthOfTextAtSize(run,size),0);
  const supported=new Set(font.getCharacterSet());
  const clean=(value:string)=>value.replace(/\r/g,'').replace(/\t/g,' ');
  // Never silently export missing glyphs as empty boxes.
  const check=(value:string)=>{for(const ch of clean(value)){if(ch!=='\n'&&!supported.has(ch.codePointAt(0)!))throw new Error(`The PDF font does not support “${ch}”. Please review this character before exporting.`);}return clean(value);};
  const width=595.28,height=841.89,margin=40,bottom=45,body=width-margin*2;
  let page:PDFPage,y=0;
  const money=(n:number)=>`RM ${n.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const date=(value:string)=>value.split('-').reverse().join('/');
  const draw=(text:string,x:number,baseline:number,size=9)=>{for(const run of runs(check(text))){const selected=fontFor(run);page.drawText(run,{x,y:baseline,size,font:selected,color:rgb(.06,.09,.12)});x+=selected.widthOfTextAtSize(run,size);}};
  function newPage(){page=pdf.addPage([width,height]);y=height-margin;draw(`${d.document_number??t.number} · ${t.version} ${d.version}`,margin,y,8);y-=22;}
  function ensure(h:number){if(y-h<bottom)newPage();}
  function paragraph(text:string,size=9,gap=5){const lines=wrap(check(text),body,measure,size);for(const line of lines){ensure(size+5);draw(line,margin,y,size);y-=size+5;}y-=gap;}
  function heading(text:string){ensure(36);y-=10;paragraph(text,12,8);}
  function tableRow(values:string[],sizes:number[],header=false){
    const size=header?8:9,leading=14,pad=6;
    const columns=values.map((v,i)=>wrap(check(v),sizes[i]-pad*2,measure,size));
    let offset=0;const rows=Math.max(...columns.map(c=>c.length));
    while(offset<rows){
      if(y-(leading+pad*2)<bottom){newPage();if(!header&&sizes.length===6)tableHeader();}
      const fit=Math.max(1,Math.min(rows-offset,Math.floor((y-bottom-pad*2)/leading)));
      const rowHeight=fit*leading+pad*2;let x=margin;
      for(let i=0;i<values.length;i++){
        page.drawRectangle({x,y:y-rowHeight,width:sizes[i],height:rowHeight,borderWidth:.5,borderColor:rgb(.65,.67,.7),...(header?{color:rgb(.94,.95,.96)}:{})});
        for(let j=0;j<fit;j++){const line=columns[i][offset+j];if(line!==undefined){const numeric=!header&&(values.length===6?(i===2||i>=4):i>=1);draw(line,numeric?x+sizes[i]-pad-measure(line,size):x+pad,y-pad-size-j*leading,size);}}
        x+=sizes[i];
      }
      y-=rowHeight;offset+=fit;
      if(offset<rows){newPage();if(!header&&sizes.length===6)tableHeader();}
    }
  }
  const columns=[32,body-32-48-50-80-85,48,50,80,85];
  function tableHeader(){tableRow([t.no,t.description,t.qty,t.unit,t.rate,t.amount],columns,true);}
  newPage();
  page!.drawImage(logo,{x:margin,y:y-65,width:65,height:65});
  draw('DEKEZ SDN BHD',margin+90,y-12,18);
  for(const [i,line] of ['202501054747 (1656153-U)','Lot 30, Kian Yap Industrial Estate, Lorong Durian 3,','Kota Kinabalu, Sabah, Malaysia','Tel: +6016-8173911 · TIN: C60479177010'].entries())draw(line,margin+90,y-28-i*12,8);
  y-=93;paragraph(t[d.kind],20,12);
  if(d.status==='draft')paragraph(t.draft,11);
  if(d.status==='voided'||d.status==='superseded'||d.status==='rejected')paragraph(t[d.status],11);
  paragraph(`${t.client}: ${d.client_snapshot.name}`,11);
  for(const value of [d.client_snapshot.address,d.client_snapshot.phone,d.client_snapshot.email])if(value)paragraph(value,9,0);
  paragraph(`${t.date}: ${date(d.document_date)}    ${d.kind==='quotation'?t.valid:t.due}: ${date(d.due_date)}`,9,10);
  paragraph(`${t.project}: ${d.project}`,10);if(d.site_address)paragraph(d.site_address);
  paragraph(`${t.contract}: ${money(Number(d.total))}`,12,12);
  tableHeader();
  for(const [i,item] of d.items.entries()){
    // Keep ordinary rows whole; very long rows continue safely with repeated headers.
    const description=(item.item_code?item.item_code+'\n':'')+item.description;
    const rowHeight=Math.max(wrap(description,columns[1]-12,measure,9).length,1)*14+12;
    if(rowHeight<height-margin-bottom-60&&y-rowHeight<bottom){newPage();tableHeader();}
    tableRow([String(i+1),description,String(item.quantity),item.unit,Number(item.rate).toFixed(2),(lineCents(item)/100).toFixed(2)],columns);
  }
  const totals=documentTotals(document);ensure(110);y-=16;
  paragraph(`${t.subtotal}: ${money(totals.subtotal/100)}`);
  paragraph(`${t.discount}${d.discount_kind==='percent'?` (${d.discount_value}%)`:''}: -${money(totals.discount/100)}`);
  paragraph(`${t.tax} (${Number(d.tax_rate??0)}%): ${money(totals.tax/100)}`);
  paragraph(`${t.total}: ${money(totals.total/100)}`,13);
  paragraph(amountInWords(Number(d.total),language),10);
  const scheduleHeight=75+d.stages.reduce((sum,stage)=>sum+Math.max(1,wrap(stage.label,body-157,measure,9).length)*14+12,0);
  // Keep a normal payment schedule together instead of leaving its first row
  // on one page and the remaining percentages on the next.
  ensure(Math.min(scheduleHeight,height-margin-bottom-22));heading(t.schedule);tableRow([t.stage,'%',t.amount],[body-145,45,100],true);
  const amounts=stageAmounts(totals.total,d.stages);
  for(const [i,stage] of d.stages.entries())tableRow([stage.label,`${stage.percent}%`,money(amounts[i])],[body-145,45,100]);
  y-=16;
  if(payments){y-=12;paragraph(`${t.received}: ${money(payments.verified)}`);paragraph(`${t.outstanding}: ${money(payments.outstanding)}`,11);}
  if(d.kind==='invoice')paragraph(t.payText,8);
  heading(t.terms);for(const [i,term] of d.terms.split('\n').filter(Boolean).entries())paragraph(`${i+1}. ${term}`,9,6);
  if(d.remarks){heading(t.remarks);paragraph(d.remarks);}
  heading(d.kind==='quotation'?t.acceptance:t.paymentDetails);
  if(d.kind==='quotation')paragraph(t.acceptText);
  paragraph(`${t.bank}: Public Bank Berhad\n${t.accountName}: DEKEZ SDN. BHD.\n${t.accountNo}: 3247421720`);
  paragraph(t.startText);ensure(100);y-=15;
  paragraph(`${t.prepared}: DEKEZ SDN. BHD.`);paragraph(`${t.signature}: __________________    ${t.date}: __________________`);
  if(d.kind==='quotation'){paragraph(`${t.accepted}: ${d.client_snapshot.name}`);paragraph(`${t.signature}: __________________    ${t.date}: __________________`);}
  const pages=pdf.getPages();pages.forEach((p,i)=>{page=p;draw(`${t.page} ${i+1} / ${pages.length}`,width-110,22,8);});
  pdf.setTitle(`${d.document_number??'Draft'} - ${t[d.kind]}`);pdf.setAuthor('DEKEZ SDN BHD');pdf.setSubject(`Document ${d.id}; version ${d.version}; language ${language}`);
  return {bytes:await pdf.save(),warnings,pages:pages.length};
}

export function wrap(text:string,width:number,measure:(text:string,size:number)=>number,size:number) {
  const lines:string[]=[];
  for(const paragraph of text.split('\n')) {
    let line='';
    // Word-aware Latin wrapping; CJK characters are natural break opportunities.
    for(const token of paragraph.match(/[\u2E80-\u9FFF\uF900-\uFAFF]|[^\s\u2E80-\u9FFF\uF900-\uFAFF]+|\s+/gu)??['']) {
      if(measure(line+token,size)<=width){line+=token;continue;}
      if(line.trim()){lines.push(line.trimEnd());line='';}
      for(const character of token.trimStart()) {
        if(line&&measure(line+character,size)>width){lines.push(line);line='';}
        line+=character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

import { ringgitInWords } from "@/lib/invoices/format";
import { defaultStages, defaultTerms, type DocumentLanguage, type RenovationDocument } from "./model";

export const languages = { en: "ENGLISH", ms: "BAHASA MELAYU", zh: "简体中文" };
export const labels = {
  en: { quotation:"QUOTATION", invoice:"INVOICE", client:"CLIENT / ATTENTION", date:"Date", due:"Due date", valid:"Valid until", project:"PROJECT", contract:"TOTAL CONTRACT SUM", no:"NO.", description:"DESCRIPTION", qty:"QTY", unit:"UNIT", rate:"UNIT PRICE (RM)", amount:"AMOUNT (RM)", subtotal:"Subtotal", discount:"Discount", tax:"Tax", total:"TOTAL", schedule:"PAYMENT TERMS", stage:"STAGE", terms:"TERMS & CONDITIONS", remarks:"REMARKS", bank:"Bank", accountName:"Account Name", accountNo:"Account No.", prepared:"PREPARED BY", accepted:"ACCEPTED BY", signature:"Signature", name:"Name", draft:"DRAFT - NOT ISSUED", voided:"VOIDED - DO NOT PAY", superseded:"SUPERSEDED - DO NOT ACCEPT OR PAY", rejected:"REJECTED", number:"Number assigned on issue", received:"Payments received", outstanding:"Outstanding", version:"Version", page:"Page", paymentDetails:"PAYMENT DETAILS", acceptance:"ACCEPTANCE", acceptText:"If the scope and payment terms are acceptable, please sign and return this quotation.", startText:"Work and material preparation commence upon confirmation and receipt of the agreed down payment.", payText:"Only recorded payments are reflected. Please use this invoice number when paying." },
  ms: { quotation:"SEBUT HARGA", invoice:"INVOIS", client:"PELANGGAN / UNTUK PERHATIAN", date:"Tarikh", due:"Tarikh akhir bayaran", valid:"Sah sehingga", project:"PROJEK", contract:"JUMLAH KONTRAK", no:"BIL.", description:"KETERANGAN", qty:"KUANTITI", unit:"UNIT", rate:"HARGA SEUNIT (RM)", amount:"JUMLAH (RM)", subtotal:"Subjumlah", discount:"Diskaun", tax:"Cukai", total:"JUMLAH", schedule:"TERMA PEMBAYARAN", stage:"PERINGKAT", terms:"TERMA & SYARAT", remarks:"CATATAN", bank:"Bank", accountName:"Nama Akaun", accountNo:"No. Akaun", prepared:"DISEDIAKAN OLEH", accepted:"DITERIMA OLEH", signature:"Tandatangan", name:"Nama", draft:"DRAF - BELUM DIKELUARKAN", voided:"DIBATALKAN - JANGAN BAYAR", superseded:"DIGANTI - JANGAN TERIMA ATAU BAYAR", rejected:"DITOLAK", number:"Nombor diberikan semasa dikeluarkan", received:"Bayaran diterima", outstanding:"Baki belum dibayar", version:"Versi", page:"Halaman", paymentDetails:"BUTIRAN PEMBAYARAN", acceptance:"PENERIMAAN", acceptText:"Jika skop dan terma pembayaran dipersetujui, sila tandatangani dan kembalikan sebut harga ini.", startText:"Kerja dan penyediaan bahan bermula selepas pengesahan dan penerimaan bayaran pendahuluan yang dipersetujui.", payText:"Hanya bayaran yang direkodkan ditunjukkan. Sila gunakan nombor invois ini semasa membayar." },
  zh: { quotation:"报价单", invoice:"发票", client:"客户 / 收件人", date:"日期", due:"付款到期日", valid:"有效期至", project:"工程项目", contract:"合同总额", no:"序号", description:"项目说明", qty:"数量", unit:"单位", rate:"单价 (RM)", amount:"金额 (RM)", subtotal:"小计", discount:"折扣", tax:"税额", total:"总计", schedule:"付款安排", stage:"阶段", terms:"条款与条件", remarks:"备注", bank:"银行", accountName:"账户名称", accountNo:"账号", prepared:"编制方", accepted:"接受方", signature:"签名", name:"姓名", draft:"草稿 - 尚未签发", voided:"已作废 - 请勿付款", superseded:"已被取代 - 请勿接受或付款", rejected:"已拒绝", number:"签发时分配编号", received:"已收款", outstanding:"未付余额", version:"版本", page:"页", paymentDetails:"付款资料", acceptance:"确认接受", acceptText:"如同意工程范围及付款条款，请签署并交回本报价单。", startText:"确认并收到约定的首期款项后，开始准备材料及施工。", payText:"仅列示已记录的付款。付款时请注明本发票编号。" },
} satisfies Record<DocumentLanguage, Record<string, string>>;

const standardTerms: Record<"ms"|"zh", string[]> = {
  ms:["Semua bahan, tenaga kerja, peralatan biasa dan pemasangan yang diperlukan untuk skop yang disenaraikan adalah termasuk.","Warna cat akhir dan skop yang dipersetujui hendaklah disahkan oleh Pelanggan sebelum kerja bermula.","Kerja tambahan atau perubahan di luar sebut harga ini memerlukan Perintah Perubahan yang dipersetujui dan akan dicaj berasingan.","Bayaran perlu dibuat mengikut peringkat pembayaran di atas. Kerja dan penyediaan bahan bermula selepas pengesahan dan penerimaan bayaran pendahuluan.","Ukuran dan kuantiti akhir tertakluk kepada pengesahan di tapak dan susun atur yang dipersetujui.","Sebut harga ini sah sehingga tarikh sah yang dinyatakan di atas."],
  zh:["包括所列工程范围所需的所有材料、人工、常规工具、设备及安装。","施工前，客户须确认最终油漆颜色及约定工程范围。","本报价范围以外的新增或变更工程须经双方同意的变更单确认，并另行收费。","款项须按上述付款阶段支付。确认并收到首期款项后开始准备材料及施工。","最终尺寸及数量以现场核实及双方同意的布局为准。","本报价有效期至上方注明的日期。"],
};
const standardStages: Record<"ms"|"zh", string[]> = {
  ms:["Bayaran pendahuluan - sebelum kerja bermula","Bayaran kemajuan - kira-kira 50% siap","Bayaran akhir - siap, pemeriksaan akhir dan serahan"],
  zh:["首期付款 - 开工前","进度付款 - 约50%完工","尾款 - 完工、最终检查及交付"],
};
export type TranslationReview = Record<string, { source: string; text: string }>;
export function translationFields(d: RenovationDocument) {
  return [
    ...d.items.map((item,i)=>({key:`item:${i}`,label:`Item ${i+1}`,source:item.description,translations:item.translation_source===item.description?item.translations:undefined})),
    ...d.stages.map((stage,i)=>({key:`stage:${i}`,label:`Payment stage ${i+1}`,source:stage.label,translations:undefined})),
    {key:"terms",label:"Terms & conditions",source:d.terms,translations:undefined},
    {key:"remarks",label:"Remarks",source:d.remarks??"",translations:undefined},
  ].filter(field=>field.source.trim());
}
export function protectedTokens(value:string) {
  const tokens=value.match(/\b(?:[A-Za-z]*\d[\w]*(?:\.\d+)?[A-Za-z]*["″%]?|SQ\s+FT|G\d+|MM|CM|LED)\b["″%]?/gi)??[];
  // Dimensions are one specification: preserving just the individual numbers
  // would incorrectly accept 2" + 4" or a swapped dimension in place of 2" × 4".
  const dimensions=value.match(/\b\d+(?:\.\d+)?\s*(?:MM|CM|FT|IN|["″])?\s*[×xX]\s*\d+(?:\.\d+)?\s*(?:MM|CM|FT|IN|["″])?/gi)??[];
  const codes=(value.match(/\b[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)+\b/g)??[]).filter(code=>/[A-Za-z]/.test(code)&&/\d/.test(code));
  return [...tokens,...dimensions.map(d=>'dimension:'+d.replace(/\s+/g,'')),...codes.map(c=>'code:'+c)].sort();
}
export function safeTranslation(source:string, translated:string) {
  return JSON.stringify(protectedTokens(source))===JSON.stringify(protectedTokens(translated));
}
export function suggestedTranslations(d:RenovationDocument, language:DocumentLanguage):TranslationReview {
  const result:TranslationReview={};
  for(const field of translationFields(d)) {
    let text=language==='en'?field.source:field.translations?.[language]??"";
    if(language!=='en'&&!text) {
      if(field.key==='terms' && field.source===defaultTerms) text=standardTerms[language].join('\n');
      const stage=defaultStages.findIndex(s=>s.label===field.source);
      if(field.key.startsWith('stage:')&&stage>=0) text=standardStages[language][stage];
    }
    result[field.key]={source:field.source,text};
  }
  return result;
}
export function localizedDocument(d:RenovationDocument, language:DocumentLanguage, review?:TranslationReview) {
  const defaults=suggestedTranslations(d,language),warnings:string[]=[];
  function translated(key:string,source:string) {
    if(!source) return source;
    const value=review?.[key]??defaults[key];
    if(value?.source===source&&value.text.trim()&&safeTranslation(source,value.text)) return value.text;
    warnings.push(`${key}: ${value?.text?.trim()?"translation changed a protected specification or is stale":"translation unavailable"}; original retained.`);
    return source;
  }
  return { document:{...d,items:d.items.map((item,i)=>({...item,description:translated(`item:${i}`,item.description)})),stages:d.stages.map((stage,i)=>({...stage,label:translated(`stage:${i}`,stage.label)})),terms:translated('terms',d.terms),remarks:translated('remarks',d.remarks??'')}, warnings };
}
function malay(n:number):string {
  const small=['Sifar','Satu','Dua','Tiga','Empat','Lima','Enam','Tujuh','Lapan','Sembilan','Sepuluh','Sebelas'];
  if(n<12)return small[n];if(n<20)return `${malay(n-10)} Belas`;
  if(n<100)return `${malay(Math.floor(n/10))} Puluh${n%10?' '+malay(n%10):''}`;
  if(n<1000)return `${n<200?'Seratus':malay(Math.floor(n/100))+' Ratus'}${n%100?' '+malay(n%100):''}`;
  if(n<1000000)return `${n<2000?'Seribu':malay(Math.floor(n/1000))+' Ribu'}${n%1000?' '+malay(n%1000):''}`;
  return `${malay(Math.floor(n/1000000))} Juta${n%1000000?' '+malay(n%1000000):''}`;
}
function chinese(n:number):string {
  const digits='零壹贰叁肆伍陆柒捌玖';
  if(n===0)return digits[0];
  if(n>=10000){const low=n%10000;return chinese(Math.floor(n/10000))+'万'+(low?(low<1000?'零':'')+chinese(low):'');}
  let result='',zero=false;
  for(const [unit,label] of [[1000,'仟'],[100,'佰'],[10,'拾'],[1,'']] as const) {
    const digit=Math.floor(n/unit);n%=unit;
    if(digit){if(zero)result+='零';result+=digits[digit]+label;zero=false;}else if(result&&n)zero=true;
  }
  return result;
}
export function amountInWords(amount:number,language:DocumentLanguage) {
  const cents=Math.round(amount*100),whole=Math.floor(cents/100),sen=cents%100;
  if(language==='en')return ringgitInWords(amount);
  if(language==='ms')return `Ringgit Malaysia ${malay(whole)}${sen?' Dan Sen '+malay(sen):''} Sahaja`;
  return `马来西亚令吉${chinese(whole)}${sen?'及'+chinese(sen)+'仙':'整'}`;
}

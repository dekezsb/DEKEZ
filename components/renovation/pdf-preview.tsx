"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { languages, localizedDocument, suggestedTranslations, translationFields, safeTranslation, type TranslationReview } from "@/lib/renovation/languages";
import type { DocumentLanguage, RenovationDocument } from "@/lib/renovation/model";
import { savePdfTranslations } from '@/app/renovation/actions';
import type { SavedTranslations } from '@/lib/renovation/saved-translations';

export function RenovationPdfPreview({document:d,manage,payments,historical=false,savedTranslations={}}:{document:RenovationDocument;manage:boolean;payments?:{verified:number;outstanding:number};historical?:boolean;savedTranslations?:SavedTranslations}) {
  const [language,setLanguage]=useState<DocumentLanguage>('en'),[reviews,setReviews]=useState<Partial<Record<DocumentLanguage,TranslationReview>>>(()=>savedTranslations);
  const [saved,setSaved]=useState<SavedTranslations>(()=>savedTranslations),[saving,setSaving]=useState(false),[saveMessage,setSaveMessage]=useState('');
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reviewed,setReviewed]=useState(false);
  const generation=useRef(0),iframe=useRef<HTMLIFrameElement>(null);
  const review=reviews[language]??suggestedTranslations(d,language),warnings=localizedDocument(d,language,review).warnings;
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  function invalidate(){generation.current++;setUrl('');setError('');setReviewed(false);setSaveMessage('');}
  function select(value:DocumentLanguage){invalidate();setLanguage(value);setReviewed(value!=='en'&&!!saved[value]&&JSON.stringify(reviews[value])===JSON.stringify(saved[value]));}
  function change(key:string,source:string,text:string){invalidate();setReviews(previous=>({...previous,[language]:{...review,[key]:{source,text}}}));}
  async function save(){
    if(language==='en')return;
    const selected=language,current=generation.current,wording=review;
    const form=new FormData();form.set('id',d.id);form.set('version',String(d.version));form.set('language',selected);form.set('review',JSON.stringify(wording));form.set('reviewed',reviewed?'yes':'no');
    setSaving(true);setSaveMessage('');setError('');
    try {
      const result=await savePdfTranslations(form);
      if(result.success)setSaved(previous=>({...previous,[selected]:wording}));
      if(current===generation.current){if(result.error)setError(result.error);else setSaveMessage(result.success??'');}
    } catch { if(current===generation.current)setError('Could not save translations. Please retry.'); }
    finally {setSaving(false);}
  }
  async function preview(){
    const current=++generation.current;setBusy(true);setError('');setUrl('');
    try{
      const [{renovationPdf},fontResponse,logoResponse]=await Promise.all([import('@/lib/renovation/pdf'),fetch('/fonts/NotoSansSC-Regular.ttf'),fetch('/dekez-logo.jpg')]);
      if(!fontResponse.ok||!logoResponse.ok)throw new Error('Could not load the PDF font or company logo. Please retry.');
      const [font,logo]=await Promise.all([fontResponse.arrayBuffer(),logoResponse.arrayBuffer()]);
      const result=await renovationPdf(d,language,review,{font:new Uint8Array(font),logo:new Uint8Array(logo)},payments);
      if(current===generation.current)setUrl(URL.createObjectURL(new Blob([new Uint8Array(result.bytes)],{type:'application/pdf'})));
    }catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'PDF generation failed.');}finally{setBusy(false);}
  }
  const edit=d.status==='draft'?`/renovation/new?edit=${d.id}`:d.kind==='invoice'&&d.status==='issued'?`/renovation/new?correct=${d.id}`:d.kind==='quotation'&&d.status==='issued'?`/renovation/new?revise=${d.id}`:null;
  return <section className="mx-auto max-w-5xl space-y-4 rounded-xl border bg-white p-5 print:hidden"><h2 className="text-xl font-semibold">PDF preview & export</h2>
    <div className="flex flex-wrap items-center gap-4"><label>DOCUMENT LANGUAGE<select aria-label="Document language" className="ml-2 rounded border p-2" value={language} onChange={e=>select(e.target.value as DocumentLanguage)}>{Object.entries(languages).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><p>DOCUMENT TYPE: {d.kind==='invoice'?'Invoice':'Quotation'} · Version {d.version}{historical?' · Historical copy':''}</p></div>
    <p className="text-sm text-slate-600">Language changes affect this PDF only. Names, addresses, codes, quantities, prices and totals are kept unchanged.</p>
    <details><summary className="cursor-pointer font-semibold">Translate / review wording before export</summary><p className="my-3 text-sm">Available library translations and standard wording are suggested below. Enter or correct translations here. Save translations to reuse reviewed wording on future downloads. Saved translations are separate from the original document; its wording and amounts never change.</p>
      <button type="button" className="rounded border p-2" onClick={()=>{invalidate();setReviews(previous=>({...previous,[language]:suggestedTranslations(d,language)}));}}>Use available translations</button>
      <div className="mt-3 space-y-4">{translationFields(d).map(field=><div className="rounded border p-3" key={field.key}><label className="block font-semibold">{field.label}<span className="my-2 block whitespace-pre-line text-sm font-normal">Original: {field.source}</span><textarea className="min-h-20 w-full rounded border p-2 font-normal" aria-label={`Translation: ${field.label}`} value={review[field.key]?.text??''} maxLength={field.key==='terms'?15000:field.key==='remarks'?5000:1000} onChange={e=>change(field.key,field.source,e.target.value)} /></label>{review[field.key]?.text&&!safeTranslation(field.source,review[field.key].text)&&<p role="alert" className="text-red-700">A number or technical specification changed. This translation will not be used.</p>}</div>)}</div>
    </details>
    {warnings.length>0&&<div role="alert" className="rounded border border-amber-400 bg-amber-50 p-3"><p>{warnings.length} translation warning(s). Original wording will be retained where needed.</p><ul className="list-disc pl-5 text-sm">{warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
    {language!=='en'&&<label className="flex gap-2"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed the translated wording and any original-text fallbacks.</label>}
    {language!=='en'&&saved[language]&&JSON.stringify(review)===JSON.stringify(saved[language])&&<p className="text-sm text-emerald-800">Saved translation loaded for this document version.</p>}
    <div className="flex flex-wrap gap-3"><button type="button" className="rounded bg-[#b58a2a] px-4 py-2 text-white disabled:opacity-50" disabled={busy||(language!=='en'&&!reviewed)} onClick={preview}>{busy?'Generating…':'Preview PDF'}</button>
      {manage&&!historical&&language!=='en'&&<button type="button" className="rounded border px-4 py-2 disabled:opacity-50" disabled={saving||!reviewed||warnings.length>0} onClick={save}>{saving?'Saving translations…':'Save translations'}</button>}
      {url&&<><a href={url} download={`${d.document_number??'Draft'}-v${d.version}-${language}.pdf`} className="rounded border px-4 py-2">Download PDF</a><button type="button" className="rounded border px-4 py-2" onClick={()=>{try{iframe.current?.contentWindow?.focus();iframe.current?.contentWindow?.print();}catch{setError('Use the print control inside the PDF preview or download the PDF to print.');}}}>Print</button></>}
      {manage&&!historical&&edit&&<Link href={edit} className="rounded border px-4 py-2">Edit Document</Link>}
    </div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {saveMessage&&<p role="status" className="text-emerald-800">{saveMessage}</p>}
    {url?<iframe ref={iframe} title={`${languages[language]} ${d.kind} PDF preview`} src={url} className="h-[80vh] min-h-96 w-full rounded border"/>:<p className="rounded bg-slate-50 p-6">Choose the language and click Preview PDF. Download becomes available after the PDF is generated.</p>}
  </section>;
}

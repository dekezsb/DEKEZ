import React from 'react';
import {createRoot} from 'react-dom/client';
import {RenovationEditor} from '@/components/renovation/editor';
import {RenovationPrintDocument} from '@/components/renovation/print-document';
import {defaultStages,defaultTerms} from '@/lib/renovation/model';
const client={id:'test-client',name:'TEST CLIENT - NOT A REAL INVOICE',phone:'',email:'',address:'Test address, Kota Kinabalu'};
const document={id:'test',kind:'quotation',status:'issued',document_number:'DQ-TEST-ONLY',client_id:client.id,client_snapshot:client,project:'Shoplot renovation - sample preview only',site_address:'Fictional test site',document_date:'2026-10-19',due_date:'2026-11-18',version:1,discount_kind:'percent',discount_value:10,discount_amount:1000,total:9000,stages:defaultStages,terms:defaultTerms,items:[{description:'Partition walls and door openings',quantity:500,unit:'SQ FT',rate:10},{description:'Electrical wiring, lighting and switches',quantity:10,unit:'POINT',rate:200},{description:'Surface preparation and painting',quantity:1,unit:'LOT',rate:3000}]};
const print=new URLSearchParams(location.search).has('print');
createRoot(documentRoot()).render(print?<RenovationPrintDocument document={document}/>:<main className="mx-auto max-w-5xl p-5"><RenovationEditor id="test-draft" today="2026-10-19" clients={[client]} catalogue={[{id:'item',description:'Saved partition work',unit:'SQ FT',rate:10}]}/></main>);
function documentRoot(){return window.document.getElementById('root');}

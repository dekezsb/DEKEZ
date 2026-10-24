"use client";
import { useEffect, useState, type FormEvent } from "react";
import { chatErrorMessage, requestChat } from "@/lib/chat/client";
import styles from "./workspace.module.css";
type Option={id:string;label:string;enabled:boolean;support:boolean;dispatch:boolean};

/** Existing accounts only. Server/DB authorize every action independently. */
export function ChatAccessSetup({endpoint="/api/dekez-chat"}:{endpoint?:string}) {
  const [accounts,setAccounts]=useState<Option[]>([]),[properties,setProperties]=useState<Option[]>([]),[jobs,setJobs]=useState<Option[]>([]);
  const [more,setMore]=useState<Record<string,boolean>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [account,setAccount]=useState(""),[enabled,setEnabled]=useState(false),[support,setSupport]=useState(false),[dispatch,setDispatch]=useState(false),[ack,setAck]=useState(false);
  const [a,setA]=useState(""),[b,setB]=useState(""),[property,setProperty]=useState(""),[job,setJob]=useState(""),[reason,setReason]=useState(""),[relationship,setRelationship]=useState("");
  async function options(kind:string,after?:string,signal?:AbortSignal) {
    const query=new URLSearchParams({view:"setup-options",kind}); if(after)query.set("after",after);if(kind==="jobs")query.set("property",property);
    const rows=await requestChat<Option[]>(endpoint,query,signal);if(signal?.aborted)return;
    const update=kind==="accounts"?setAccounts:kind==="properties"?setProperties:setJobs;
    update(previous=>after?[...previous,...rows]:rows);setMore(previous=>({...previous,[kind]:rows.length===25}));
  }
  useEffect(()=>{const abort=new AbortController();void Promise.all([options("accounts",undefined,abort.signal),options("properties",undefined,abort.signal)]).catch(cause=>{if(!abort.signal.aborted)setError(chatErrorMessage(cause));});return()=>abort.abort();},[endpoint]);
  async function run(work:()=>Promise<void>) {if(busy)return;setBusy(true);setError("");setNotice("");try{await work();}catch(cause){setError(chatErrorMessage(cause));}finally{setBusy(false);}}
  async function save(event:FormEvent){event.preventDefault();await run(async()=>{await requestChat(endpoint,{action:"member-setup",accountId:account,enabled,support,dispatch,previewAcknowledged:ack,reason});setAccounts(previous=>previous.map(p=>p.id===account?{...p,enabled,support,dispatch}:p));setNotice("Chat capability saved. No login, profile or financial record was changed.");});}
  async function authorize(event:FormEvent){event.preventDefault();await run(async()=>{const id=await requestChat<string>(endpoint,{action:"relationship-setup",accountA:a,accountB:b,propertyId:property,roomId:null,tenancyId:null,ticketId:job||null,reason});setRelationship(id);setNotice("Relationship authorized after database checks. This does not create a new user or job.");});}
  const choices=(rows:Option[])=>rows.map(row=><option key={row.id} value={row.id}>{row.label}</option>);
  return <section className={styles.workspace}><h1>Chat access setup</h1><p className={styles.privacy}>Super Admin only. Enable existing accounts, then authorize a real property/job relationship. This does not grant access to private message content.</p>
    <p>Current job source: existing Maintenance tickets and assignments. Marketplace job matching is not connected; no substitute or demo jobs are created.</p>
    {error?<p className={styles.error} role="alert">{error}</p>:null}{notice?<p className={styles.notice} role="status">{notice}</p>:null}
    <label className={styles.supportField}>Reason for access change<textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <form className={styles.contacts} onSubmit={save}><h2>1. Existing account capabilities</h2>
      <label className={styles.supportField}>Account<select aria-label="Account" required value={account} onChange={e=>{const found=accounts.find(p=>p.id===e.target.value);setAccount(e.target.value);setEnabled(found?.enabled??false);setSupport(found?.support??false);setDispatch(found?.dispatch??false);setAck(false);}}><option value="">Choose existing account</option>{choices(accounts)}</select></label>
      {more.accounts?<button type="button" disabled={busy} onClick={()=>void run(()=>options("accounts",accounts.at(-1)?.id))}>More accounts</button>:null}
      <label className={styles.evidence}><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enable in-app chat</label>
      <label className={styles.evidence}><input type="checkbox" checked={support} onChange={e=>setSupport(e.target.checked)}/>May be assigned selected support evidence (internal staff only)</label>
      <label className={styles.evidence}><input type="checkbox" checked={dispatch} onChange={e=>setDispatch(e.target.checked)}/>May assign support cases (authorized Admin/Management only)</label>
      <label className={styles.evidence}><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>Contractor pilot: I have reviewed this account's identity and credentials. Shared test logins must not receive real private chats.</label>
      <button disabled={busy||!account||reason.trim().length<5}>Save account chat access</button>
    </form>
    <form className={styles.contacts} onSubmit={authorize}><h2>2. Authorize a property or active job relationship</h2>
      <label className={styles.supportField}>Participant A<select aria-label="Participant A" required value={a} onChange={e=>setA(e.target.value)}><option value="">Choose account</option>{choices(accounts)}</select></label>
      <label className={styles.supportField}>Participant B<select aria-label="Participant B" required value={b} onChange={e=>setB(e.target.value)}><option value="">Choose account</option>{choices(accounts)}</select></label>
      <label className={styles.supportField}>Property<select aria-label="Property" required value={property} onChange={e=>{setProperty(e.target.value);setJob("");setJobs([]);setMore(previous=>({...previous,jobs:false}));}}><option value="">Choose property</option>{choices(properties)}</select></label>
      {more.properties?<button type="button" disabled={busy} onClick={()=>void run(()=>options("properties",properties.at(-1)?.id))}>More properties</button>:null}
      <button type="button" disabled={busy||!property} onClick={()=>void run(()=>options("jobs"))}>Load active jobs for this property</button>
      <label className={styles.supportField}>Active job (required for contractors)<select aria-label="Active job (required for contractors)" value={job} onChange={e=>setJob(e.target.value)}><option value="">Property management relationship only</option>{choices(jobs)}</select></label>
      {more.jobs?<button type="button" disabled={busy} onClick={()=>void run(()=>options("jobs",jobs.at(-1)?.id))}>More jobs</button>:null}
      <p>Owner–Tenant pairs are always blocked. Contractors require an actual active assignment. Closed job conversations cannot reopen.</p>
      <button disabled={busy||!a||!b||a===b||!property||reason.trim().length<5}>Authorize relationship</button>
    </form>
    <section className={styles.contacts}><h2>Revoke chat relationship</h2><label className={styles.supportField}>Relationship reference<input value={relationship} onChange={e=>setRelationship(e.target.value)}/></label><p>Revocation removes access but preserves messages and audit history.</p>
      <button disabled={busy||!relationship||reason.trim().length<5} onClick={()=>void run(async()=>{if(!window.confirm("Revoke this relationship? Its history will remain stored but no longer accessible through this grant."))return;await requestChat(endpoint,{action:"relationship-revoke",relationshipId:relationship,reason});setNotice("Chat relationship revoked. History has not been deleted.");})}>Revoke relationship</button>
    </section>
  </section>;
}

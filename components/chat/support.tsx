"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chatErrorMessage, requestChat, type ChatMessage, type ChatFile } from "@/lib/chat/client";
import { ChatFileCard } from "./file-card";
import styles from "./workspace.module.css";

type Case = { case_id: string; conversation_id: string; reported_by: string; reason: string; status: string; assigned_to: string | null; access_until: string | null; created_at: string; maintenance_ticket_id: string | null; can_dispatch: boolean };
type Manifest = { explanation: string; access_until: string; messages: { id: string; seq: number; created_at: string }[]; attachments?: ChatFile[] };
type Staff = { user_id: string; display_name: string };
const label = (value: string) => value.replaceAll("_", " ");

/** One case at a time. No conversation browser or unrestricted history request. */
export function ChatSupport({ userId, endpoint = "/api/dekez-chat", realtimeEnabled=false }: { userId: string; endpoint?: string; realtimeEnabled?: boolean }) {
  const [cases, setCases] = useState<Case[]>([]), [more, setMore] = useState(false);
  const [selected, setSelected] = useState<Case | null>(null), [staff, setStaff] = useState<Staff[]>([]);
  const [moreStaff, setMoreStaff] = useState(false), [staffId, setStaffId] = useState("");
  const [minutes, setMinutes] = useState(60), [reason, setReason] = useState("");
  const [manifest, setManifest] = useState<Manifest | null>(null), [evidence, setEvidence] = useState<ChatMessage | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const version = useRef(0), mounted = useRef(false);
  const active = selected && ["open", "under_review", "waiting_for_response"].includes(selected.status);
  const canReview = active && selected.assigned_to === userId && !!selected.access_until && Date.parse(selected.access_until) > Date.now();

  const load = useCallback(async (signal?: AbortSignal) => {
    setManifest(null); setEvidence(null); setSelected(null); version.current++;
    try {
      const rows = await requestChat<Case[]>(endpoint, new URLSearchParams({ view: "support-queue" }), signal);
      if (!mounted.current || signal?.aborted) return;
      setCases(rows); setMore(rows.length === 25);
    } catch (cause) { if (mounted.current && !signal?.aborted) { setCases([]); setError(chatErrorMessage(cause)); } }
    finally { if (mounted.current && !signal?.aborted) setLoading(false); }
  }, [endpoint]);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController(); void load(controller.signal);
    return () => { mounted.current = false; version.current++; controller.abort(); };
  }, [load]);
  useEffect(() => {
    if (!selected?.access_until) return;
    const expiry = Date.parse(selected.access_until);
    const timer = setTimeout(() => { setManifest(null); setEvidence(null); version.current++; setSelected(value => value ? { ...value, access_until: null } : null); }, Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [selected?.access_until]);
  useEffect(() => {
    const hide = () => { setManifest(null); setEvidence(null); version.current++; };
    window.addEventListener("blur", hide); document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("blur", hide); document.removeEventListener("visibilitychange", hide); };
  }, []);
  useEffect(() => {
    if(!realtimeEnabled)return;
    let cancelled=false,stop:(()=>void)|undefined;
    void import("@/lib/chat/realtime").then(({subscribeChat})=>{if(!cancelled)stop=subscribeChat(userId,null,()=>{if(document.visibilityState==="visible")void load();});}).catch(()=>{if(!cancelled)setError("Live support updates are unavailable. Refresh cases before reviewing evidence.");});
    return()=>{cancelled=true;stop?.();};
  },[userId,realtimeEnabled,load]);

  async function operate(work: () => Promise<void>) {
    if (busy) return; setBusy(true); setError("");
    try { await work(); } catch (cause) { if (mounted.current) { setManifest(null); setEvidence(null); setError(chatErrorMessage(cause)); } }
    finally { if (mounted.current) setBusy(false); }
  }
  function choose(item: Case) {
    version.current++; setSelected(item); setManifest(null); setEvidence(null); setReason(""); setStaffId(""); setStaff([]); setMoreStaff(false); setError("");
  }
  async function loadStaff(older = false) {
    const turn = version.current;
    const query = new URLSearchParams({ view: "support-staff" });
    if (older && staff.length) query.set("after", staff.at(-1)!.user_id);
    const rows = await requestChat<Staff[]>(endpoint, query);
    if (mounted.current && turn === version.current) { setStaff(previous => older ? [...previous, ...rows] : rows); setMoreStaff(rows.length === 25); }
  }
  async function viewReport() {
    if (!selected) return; const turn = version.current;
    setManifest(null); setEvidence(null);
    const result = await requestChat<Manifest>(endpoint, { action: "support-manifest", caseId: selected.case_id, reason });
    if (mounted.current && turn === version.current && Date.parse(result.access_until) > Date.now()) setManifest(result);
  }
  async function viewMessage(messageId: string) {
    if (!selected) return; const turn = version.current; setEvidence(null);
    const result = await requestChat<ChatMessage>(endpoint, { action: "evidence", caseId: selected.case_id, messageId, reason });
    if (mounted.current && turn === version.current) setEvidence(result);
  }
  async function updateStatus(status: string) {
    if (!selected) return;
    setManifest(null); setEvidence(null); version.current++;
    await requestChat(endpoint, { action: "support-status", caseId: selected.case_id, status, reason }); await load();
  }
  async function assign() {
    if (!selected) return;
    await requestChat(endpoint, { action: "support-assign", caseId: selected.case_id, staffId, minutes, reason }); await load();
  }
  async function olderCases() {
    const last = cases.at(-1); if (!last) return;
    const turn = version.current;
    const rows = await requestChat<Case[]>(endpoint, new URLSearchParams({ view: "support-queue", before: last.created_at, beforeId: last.case_id }));
    if (mounted.current && turn === version.current) { setCases(previous => [...previous, ...rows]); setMore(rows.length === 25); }
  }
  return <section className={styles.workspace} aria-label="DEKEZ support cases">
    <div className={styles.toolbar}><h1>Support Cases</h1><button disabled={busy} onClick={() => void operate(() => load())}>Refresh cases</button></div>
    <p className={styles.privacy}>This is not a private-chat browser. Case metadata is separate from selected evidence. Evidence requires an explicit, temporary assignment; every report and message view is audited.</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading support cases…</p> : null}
    {!loading && !error && !cases.length ? <p>No support cases are assigned or available to your support role.</p> : null}
    <div className={styles.supportGrid}>{cases.map(item => <button className={styles.conversation} key={item.case_id} disabled={busy} aria-pressed={item.case_id === selected?.case_id} onClick={() => choose(item)}>
      <strong>Case {item.case_id}</strong><p>{label(item.reason)} · {label(item.status)}</p>
      <small>Reported by: {item.reported_by}<br/>Job: {item.maintenance_ticket_id ?? "Property scope"}<br/>Assigned: {item.assigned_to ?? "Not assigned"}</small><br/><time>{new Date(item.created_at).toLocaleString("en-MY")}</time>
    </button>)}</div>
    {more ? <button disabled={busy} onClick={() => void operate(olderCases)}>Older cases</button> : null}
    {selected ? <section className={styles.contacts} aria-label="Selected support case">
      <h2>Case {selected.case_id}</h2><p>Status: {label(selected.status)}</p>
      <label className={styles.supportField}>Reason for access / action<textarea maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why this case needs review"/></label>
      {active && selected.can_dispatch ? <section><h3>Assign temporary support access</h3>
        <button disabled={busy} onClick={() => void operate(() => loadStaff())}>Choose authorized support staff</button>
        <label className={styles.supportField}>Assigned staff<select aria-label="Assigned staff" value={staffId} onChange={event => setStaffId(event.target.value)}><option value="">Choose staff</option>{staff.map(person => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label>
        {moreStaff ? <button disabled={busy} onClick={() => void operate(() => loadStaff(true))}>More staff</button> : null}
        <label className={styles.supportField}>Access duration<select value={minutes} onChange={event => setMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={1440}>24 hours</option></select></label>
        <button disabled={busy || !staffId || reason.trim().length < 5} onClick={() => void operate(assign)}>Assign case</button>
      </section> : null}
      {canReview ? <button disabled={busy || reason.trim().length < 5} onClick={() => void operate(viewReport)}>Open selected evidence</button> : <p>Evidence is unavailable without a current assignment to you. Closed cases grant no ongoing evidence access.</p>}
      {manifest ? <section aria-label="Selected case evidence"><h3>Reporter explanation</h3><p>{manifest.explanation}</p><p>Access expires: {new Date(manifest.access_until).toLocaleString("en-MY")}</p>
        {manifest.messages.length ? manifest.messages.map(message => <button key={message.id} disabled={busy || reason.trim().length < 5} onClick={() => void operate(() => viewMessage(message.id))}>View selected message {message.seq}</button>) : <p>No message evidence was selected.</p>}
        {evidence ? <article className={styles.message}><strong>Selected message</strong><p>{evidence.body}</p><time>{new Date(evidence.created_at).toLocaleString("en-MY")}</time></article> : null}
        {manifest.attachments?.map(file => <ChatFileCard key={file.id} file={file} endpoint={endpoint} caseId={selected.case_id} reason={reason}/>)}
      </section> : null}
      {active && (selected.can_dispatch || canReview) ? <div className={styles.toolbar}>{["under_review", "waiting_for_response", "resolved", "closed"].filter(status => status !== selected.status).map(status => <button key={status} disabled={busy || reason.trim().length < 5} onClick={() => void operate(() => updateStatus(status))}>Mark {label(status)}</button>)}</div> : null}
    </section> : null}
  </section>;
}

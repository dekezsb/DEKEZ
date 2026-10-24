"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChatRequestError, chatErrorMessage, chatHistory, chatFileRequest, mergeMessages, requestChat, type ChatContact, type ChatDetail, type ChatMessage, type InboxItem } from "@/lib/chat/client";
import { ChatFileCard } from "./file-card";
import { chatInitials, shortChatName, unreadLabel } from "@/lib/chat/display";
import styles from "./workspace.module.css";

const reasons = [
  ["not_responding", "Not responding"], ["inappropriate", "Inappropriate communication"],
  ["suspected_fraud", "Suspected fraud"], ["quotation", "Quotation disagreement"],
  ["payment_dispute", "Payment dispute"], ["other", "Other issue"],
];
const query = (values: Record<string, string>) => new URLSearchParams(values);
const date = (value: string) => new Date(value).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });

export function ChatWorkspace({ userId, endpoint = "/api/dekez-chat", realtimeEnabled = false, filesEnabled = false }: {
  userId: string; endpoint?: string; realtimeEnabled?: boolean; filesEnabled?: boolean;
}) {
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [desks, setDesks] = useState<{ desk_id: string; label: string }[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [hasMoreContacts, setHasMoreContacts] = useState(false);
  const [hasMoreInbox, setHasMoreInbox] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reporting, setReporting] = useState(false);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [fileEvidence, setFileEvidence] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<string, { file: File; key: string }>>({});
  const [reportReason, setReportReason] = useState("other");
  const [explanation, setExplanation] = useState("");
  const retry = useRef<Record<string, { body: string; key: string }>>({});
  const historyElement = useRef<HTMLDivElement>(null);
  const current = useRef(selected); current.current = selected;
  const generation = useRef(0);
  const mounted = useRef(false);
  const fetching = useRef<{ turn: number; signal?: AbortSignal } | null>(null);
  const refreshQueued = useRef(false);
  const visibleMessages = useRef(messages); visibleMessages.current = messages;
  const lastRead = useRef<Record<string, number>>({});
  const reading = useRef<Record<string, boolean>>({});
  const olderLoading = useRef(false);

  const loseAccess = useCallback((cause: unknown) => {
    if (cause instanceof ChatRequestError && [401, 403].includes(cause.status)) {
      setMessages([]); setDetail(null); setContacts([]); setInbox([]); setSelected(null);
      setDrafts({}); setFiles({}); retry.current = {};
    }
    setError(chatErrorMessage(cause));
  }, []);

  const markVisibleRead = useCallback(() => {
    const target = current.current, element = historyElement.current;
    const highest = visibleMessages.current.at(-1)?.seq;
    const turn = generation.current;
    if (!target || !element || !highest || reading.current[target] || highest <= (lastRead.current[target] ?? 0)
      || document.visibilityState !== "visible" || element.scrollHeight - element.scrollTop - element.clientHeight > 24) return;
    reading.current[target] = true;
    void requestChat(endpoint, { action: "read", conversationId: target, sequence: highest }).then(() => {
      lastRead.current[target] = highest;
      window.dispatchEvent(new Event("dekez-chat-read"));
      if (mounted.current && turn === generation.current) setInbox(previous => previous.map(c => c.conversation_id === target ? { ...c, unread_count: 0 } : c));
    }).catch(cause => { if (mounted.current && turn === generation.current) loseAccess(cause); })
      .finally(() => { delete reading.current[target]; });
  }, [endpoint, loseAccess]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (fetching.current?.turn === generation.current && !fetching.current.signal?.aborted) { refreshQueued.current = true; return; }
    const target = current.current;
    const turn = generation.current;
    const flight = { turn, signal }; fetching.current = flight;
    try {
      const [items, thread, recent] = await Promise.all([
        requestChat<InboxItem[]>(endpoint, query({ view: "inbox" }), signal),
        target ? requestChat<ChatDetail[]>(endpoint, query({ view: "detail", conversation: target }), signal) : Promise.resolve([]),
        target ? chatHistory(endpoint, query({ view: "history", conversation: target }), filesEnabled, signal) : Promise.resolve([]),
      ]);
      if (!mounted.current || signal?.aborted || turn !== generation.current) return;
      // Replace on revalidation so a revoked conversation is not retained locally.
      setInbox(items);
      setHasMoreInbox(items.length === 25);
      if (target === current.current && target) {
        setDetail(thread[0] ?? null);
        const previous = visibleMessages.current;
        const gap = recent.length > 0 && previous.length > 0 && recent.at(-1)!.seq > previous.at(-1)!.seq + 1;
        const element = historyElement.current;
        const atBottom = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        setMessages(mergeMessages(gap ? [] : previous, recent));
        if (gap) setHasOlder(recent.length === 40);
        if (atBottom) requestAnimationFrame(() => { if (target === current.current && element) element.scrollTop = element.scrollHeight; });
      }
    } catch (cause) { if (mounted.current && !signal?.aborted && turn === generation.current) loseAccess(cause); }
    finally {
      if (fetching.current === flight) fetching.current = null;
      if (mounted.current && !signal?.aborted && turn === generation.current) {
        setLoading(false);
        if (refreshQueued.current) { refreshQueued.current = false; queueMicrotask(() => { if (mounted.current) void refresh(); }); }
      }
    }
  }, [endpoint, filesEnabled, loseAccess]);

  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void requestChat(endpoint, { action: "bootstrap" }, controller.signal)
      .then(() => { if (!controller.signal.aborted) return refresh(controller.signal); })
      .catch(cause => { if (!controller.signal.aborted) { loseAccess(cause); setLoading(false); } });
    return () => { mounted.current = false; generation.current++; controller.abort(); };
  }, [refresh, endpoint, loseAccess]);

  useEffect(() => {
    // Recovery for a broken socket, plus periodic expiry/source-access recheck.
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, connectionError ? 15000 : 60000);
    return () => clearInterval(timer);
  }, [connectionError, refresh]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController(); const target = selected;
    setLoading(true); setDetail(null); setMessages([]); setReporting(false); setEvidence([]); setFileEvidence([]); setError("");
    void Promise.all([
      requestChat<ChatDetail[]>(endpoint, query({ view: "detail", conversation: target }), controller.signal),
      chatHistory(endpoint, query({ view: "history", conversation: target }), filesEnabled, controller.signal),
    ]).then(([thread, recent]) => {
      if (controller.signal.aborted || current.current !== target) return;
      setDetail(thread[0] ?? null); setMessages(mergeMessages([], recent)); setHasOlder(recent.length === 40);
      requestAnimationFrame(() => { if (current.current === target && historyElement.current) historyElement.current.scrollTop = historyElement.current.scrollHeight; });
    }).catch(cause => { if (!controller.signal.aborted && current.current === target) loseAccess(cause); })
      .finally(() => { if (!controller.signal.aborted && current.current === target) setLoading(false); });
    return () => controller.abort();
  }, [selected, endpoint, filesEnabled, loseAccess]);

  useEffect(() => {
    const frame = requestAnimationFrame(markVisibleRead);
    return () => cancelAnimationFrame(frame);
  }, [messages, selected, markVisibleRead]);

  const activeConversation = detail?.status === "active" ? selected : null;
  useEffect(() => {
    if (!realtimeEnabled) return;
    let stop: (() => void) | undefined; let cancelled = false;
    void import("@/lib/chat/realtime").then(({ subscribeChat }) => {
      if (!cancelled) stop = subscribeChat(userId, activeConversation, () => { if (document.visibilityState === "visible") void refresh(); }, connected => { if (!cancelled) setConnectionError(!connected); });
    }).catch(() => { if (!cancelled) setConnectionError(true); });
    return () => { cancelled = true; stop?.(); };
  }, [userId, activeConversation, realtimeEnabled, refresh]);

  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", visible); document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("online", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);

  function selectConversation(id: string | null) {
    generation.current++; current.current = id; setSelected(id); setShowContacts(false); setNotice("");
  }
  async function loadContacts(older = false) {
    const turn = generation.current;
    setBusy(true); setError(""); setShowContacts(true);
    try {
      const params = query({ view: "contacts" });
      if (older && contacts.length) params.set("after", contacts.at(-1)!.relationship_id);
      const [rows, staffDesks] = await Promise.all([
        requestChat<ChatContact[]>(endpoint, params),
        requestChat<{ desk_id: string; label: string }[]>(endpoint, query({ view: "desks" })),
      ]);
      if (!mounted.current || turn !== generation.current) return;
      setContacts(previous => older ? [...previous, ...rows] : rows); setDesks(staffDesks); setHasMoreContacts(rows.length === 25);
    } catch (cause) { if (mounted.current && turn === generation.current) loseAccess(cause); } finally { if (mounted.current) setBusy(false); }
  }
  async function start(contact: ChatContact) {
    const turn = generation.current;
    setBusy(true); setError("");
    try { const id = await requestChat<string>(endpoint, { action: "open", relationshipId: contact.relationship_id }); if (mounted.current && turn === generation.current) selectConversation(id); }
    catch (cause) { if (mounted.current && turn === generation.current) loseAccess(cause); } finally { if (mounted.current) setBusy(false); }
  }
  async function startDesk(deskId: string) {
    setBusy(true); setError("");
    try { const id = await requestChat<string>(endpoint, { action: "open-desk", deskId }); if (mounted.current) selectConversation(id); }
    catch (cause) { if (mounted.current) loseAccess(cause); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function loadOlder() {
    if (!selected || !messages.length || olderLoading.current || !hasOlder) return;
    olderLoading.current = true;
    const target = selected, element = historyElement.current, height = element?.scrollHeight ?? 0, top = element?.scrollTop ?? 0;
    setBusy(true);
    try {
      const older = await chatHistory(endpoint, query({ view: "history", conversation: target, before: String(messages[0].seq) }), filesEnabled);
      if (target !== current.current) return;
      setMessages(previous => mergeMessages(previous, older)); setHasOlder(older.length === 40);
      requestAnimationFrame(() => { if (element && target === current.current) element.scrollTop = top + element.scrollHeight - height; });
    } catch (cause) { if (target === current.current) loseAccess(cause); } finally { olderLoading.current = false; setBusy(false); }
  }
  async function moreInbox() {
    const last = inbox.at(-1); if (!last) return; setBusy(true);
    try {
      const older = await requestChat<InboxItem[]>(endpoint, query({ view: "inbox", before: last.last_message_at, beforeId: last.conversation_id }));
      setInbox(previous => [...new Map([...previous, ...older].map(c => [c.conversation_id, c])).values()]); setHasMoreInbox(older.length === 25);
    } catch (cause) { loseAccess(cause); } finally { setBusy(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault(); if (!selected || detail?.status !== "active" || busy) return;
    const target = selected, attached = files[target], body = (drafts[target] ?? "").trim() || attached?.file.name || ""; if (!body) return;
    const pending = retry.current[target]?.body === body ? retry.current[target] : { body, key: crypto.randomUUID() };
    retry.current[target] = pending; setBusy(true); setError("");
    try {
      if (attached) {
        const uploaded = await chatFileRequest(endpoint, { "x-chat-action": "upload", "x-chat-conversation": target, "x-chat-key": attached.key, "x-chat-name": encodeURIComponent(attached.file.name), "Content-Type": "application/octet-stream" }, attached.file);
        const { data } = await uploaded.json();
        await requestChat(endpoint, { action: "send-file", uploadId: data.uploadId, body });
        setFiles(previous => { const next = { ...previous }; if (next[target]?.key === attached.key) delete next[target]; return next; });
      } else await requestChat(endpoint, { action: "send", conversationId: target, body, clientKey: pending.key });
      setDrafts(previous => ({ ...previous, [target]: previous[target]?.trim() === body ? "" : previous[target] })); delete retry.current[target];
      await refresh();
    } catch (cause) {
      if (target === current.current) {
        if (cause instanceof ChatRequestError && cause.status === 403) {
          setError(chatErrorMessage(cause)); await refresh();
        } else loseAccess(cause);
      }
    } finally { setBusy(false); }
  }
  async function report(event: FormEvent) {
    event.preventDefault(); if (!selected || busy) return; setBusy(true); setError("");
    const target = selected;
    try {
      await requestChat(endpoint, { action: "report", conversationId: target, reason: reportReason, explanation, messageIds: evidence, attachmentIds: fileEvidence });
      if (!mounted.current || current.current !== target) return;
      setReporting(false); setEvidence([]); setFileEvidence([]); setExplanation(""); setNotice("Support request submitted. Only selected evidence can be reviewed by assigned support staff.");
    } catch (cause) { if (mounted.current && current.current === target) loseAccess(cause); } finally { if (mounted.current) setBusy(false); }
  }

  return <section className={styles.workspace} aria-label="DEKEZ in-app messages">
    <div className={styles.toolbar}><h1>Messages</h1><div><button onClick={() => { setError(""); void refresh(); }} disabled={busy}>Refresh</button><button onClick={() => void loadContacts()} disabled={busy}>New chat</button></div></div>
    <p className={styles.privacy}>Private DEKEZ chat. Only authorized contacts appear. Job conversations become read-only when access ends.</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {connectionError ? <p className={styles.notice} role="status">Live connection unavailable. Use Refresh to check for messages. Your draft is preserved.</p> : null}
    {showContacts ? <section className={styles.contacts} aria-label="Authorized contacts"><div className={styles.toolbar}><h2>New chat</h2><button onClick={() => setShowContacts(false)}>Close contacts</button></div>
      <p>Contact DEKEZ directly, or choose an authorized property/job contact. There is no public user directory.</p>
      {desks.map(desk => <button className={styles.contact} key={desk.desk_id} disabled={busy} onClick={() => void startDesk(desk.desk_id)}><strong>{desk.label}</strong><span>Contact DEKEZ · No maintenance job required</span></button>)}
      {!contacts.length && !desks.length && !busy ? <p>No new contacts are available. Existing conversations remain in your inbox.</p> : null}
      {contacts.map(contact => <button className={styles.contact} key={contact.relationship_id} disabled={busy} onClick={() => void start(contact)}><strong>{shortChatName(contact.contact_name)}</strong><span>{contact.chat_role} · {contact.maintenance_ticket_id ? "Active job" : contact.property_id ? "Property management" : "DEKEZ contact desk"}</span></button>)}
      {hasMoreContacts ? <button onClick={() => void loadContacts(true)} disabled={busy}>More contacts</button> : null}
    </section> : null}
    <div className={`${styles.columns} ${selected ? styles.open : ""}`}>
      <aside className={styles.inbox} aria-label="Your conversations"><h2>Conversations</h2>
        {loading && !selected && !inbox.length ? <p role="status">Loading conversations…</p> : null}
        {!loading && !inbox.length ? <p>No conversations yet. Choose New chat to see authorized contacts.</p> : null}
        {inbox.map(item => <button key={item.conversation_id} className={styles.conversation} aria-pressed={selected === item.conversation_id} onClick={() => selectConversation(item.conversation_id)}>
          <span><span className={styles.identity}><span className={styles.avatar} aria-hidden>{chatInitials(item.contact_name)}</span><strong>{shortChatName(item.contact_name)}</strong></span>{item.unread_count > 0 ? <b className={styles.badge} aria-label={`${item.unread_count} unread messages`}>{unreadLabel(item.unread_count)}</b> : null}</span>
          <small>{item.status === "closed" ? "Closed · Read-only" : "Active"}</small><p>{item.preview || "No messages yet"}</p><time dateTime={item.last_message_at}>{date(item.last_message_at)}</time>
        </button>)}
        {hasMoreInbox ? <button disabled={busy} onClick={() => void moreInbox()}>Older conversations</button> : null}
      </aside>
      <section className={styles.thread} aria-label="Conversation">
        {!selected ? <div className={styles.empty}><h2>Your conversations stay here</h2><p>Select a conversation or start a new authorized chat.</p></div> : <>
          <header className={styles.threadHeader}><button className={styles.back} onClick={() => selectConversation(null)}>Back</button><div><h2>{detail ? shortChatName(detail.contact_name) : "Conversation"}</h2><p>{detail ? `${detail.property_name}${detail.ticket_number ? ` · ${detail.ticket_number}` : ""}` : "Loading details…"}</p></div>
            {detail ? <button onClick={() => { setReporting(value => !value); setEvidence([]); setFileEvidence([]); }} disabled={busy}>Request support</button> : null}</header>
          {detail?.status === "closed" ? <p className={styles.closed} role="status">Conversation closed · Read-only. The job or chat authorization has ended. Your history is preserved.</p> : null}
          <div className={styles.history} ref={historyElement} onScroll={() => { markVisibleRead(); if (!loading && !busy && hasOlder && (historyElement.current?.scrollTop ?? 100) < 24) void loadOlder(); }} aria-label="Message history" aria-busy={loading}>
            {hasOlder ? <button disabled={busy} onClick={() => void loadOlder()}>Load older messages</button> : null}
            {loading ? <p role="status">Loading messages…</p> : null}
            {!loading && !messages.length ? <p>No messages yet.</p> : null}
            {messages.map(message => <article key={message.id} className={`${styles.message} ${message.sender_id === userId ? styles.mine : ""}`}>
              <strong>{message.sender_id === userId ? "You" : detail ? shortChatName(detail.contact_name) : "Participant"}</strong><p>{message.body}</p><time dateTime={message.created_at}>{date(message.created_at)}</time>
              {message.attachments?.map(file => <div key={file.id}><ChatFileCard file={file} endpoint={endpoint}/>{reporting ? <label className={styles.evidence}><input type="checkbox" checked={fileEvidence.includes(file.id)} disabled={!fileEvidence.includes(file.id) && fileEvidence.length >= 50} onChange={e => setFileEvidence(previous => e.target.checked ? [...previous,file.id] : previous.filter(id => id !== file.id))}/>Include this file as support evidence</label> : null}</div>)}
              {reporting ? <label className={styles.evidence}><input type="checkbox" checked={evidence.includes(message.id)} disabled={!evidence.includes(message.id) && evidence.length >= 50} onChange={e => setEvidence(previous => e.target.checked ? [...previous, message.id] : previous.filter(id => id !== message.id))}/>Include this message as support evidence</label> : null}
            </article>)}
          </div>
          {reporting ? <form className={styles.report} onSubmit={report}><h3>Request support / report a problem</h3><p>Assigned support staff may review only the messages you select, with access recorded. Unrelated conversation history stays private.</p>
            <label>Reason<select value={reportReason} onChange={e => setReportReason(e.target.value)}>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Explain the problem<textarea required maxLength={4000} value={explanation} onChange={e => setExplanation(e.target.value)}/></label>
            <p>{evidence.length} messages and {fileEvidence.length} files selected</p><button disabled={busy || !explanation.trim()}>Submit support request</button><button type="button" onClick={() => setReporting(false)}>Cancel</button>
          </form> : null}
          {detail?.status === "active" ? <form className={styles.composer} onSubmit={send}><label htmlFor="dekez-chat-message">Message</label><textarea id="dekez-chat-message" maxLength={10000} required={!files[selected]} value={drafts[selected] ?? ""} onChange={e => setDrafts(previous => ({ ...previous, [selected]: e.target.value }))} placeholder="Write your message…"/>
            {filesEnabled ? <div><label>Attach photo or PDF<input type="file" key={selected} accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={event => { const file=event.target.files?.[0]; event.target.value=""; if (!file) return; if (file.size>3*1024*1024) { setError("Choose a file up to 3 MB."); return; } setFiles(previous=>({...previous,[selected]:{file,key:crypto.randomUUID()}})); }}/></label>{files[selected] ? <p>{files[selected].file.name} <button type="button" disabled={busy} onClick={()=>setFiles(previous=>{const next={...previous};delete next[selected];return next;})}>Remove attachment</button></p> : null}</div> : null}
            <button disabled={busy || (!(drafts[selected] ?? "").trim() && !files[selected])}>{busy ? "Please wait…" : "Send message"}</button><small>{filesEnabled ? "Photos/PDFs up to 3 MB. " : ""}Drafts stay on this page if a send fails.</small></form> : null}
        </>}
      </section>
    </div>
  </section>;
}

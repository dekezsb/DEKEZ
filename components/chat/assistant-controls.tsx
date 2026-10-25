"use client";
import { useEffect, useState } from "react";
import { chatErrorMessage, requestChat } from "@/lib/chat/client";
import styles from "./workspace.module.css";
type State = { enabled: boolean; mode: "active" | "takeover" | "escalated"; needs_admin_reply: boolean; ai_answered: boolean };
export function AssistantControls({ endpoint, conversation, revision, onChange }: { endpoint: string; conversation: string; revision: string; onChange: () => void }) {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setError("");
    void requestChat<State>(endpoint, new URLSearchParams({ view: "assistant", conversation }), controller.signal)
      .then(value => { if (!controller.signal.aborted) setState(value); })
      .catch(() => { if (!controller.signal.aborted) setError("Assistant controls unavailable. Manual chat still works."); });
    return () => controller.abort();
  }, [endpoint, conversation, revision]);
  async function control(mode: "pause" | "resume") {
    setBusy(true); setError("");
    try { setState(await requestChat<State>(endpoint, { action: "assistant-control", conversationId: conversation, mode })); onChange(); }
    catch (cause) { setError(chatErrorMessage(cause)); } finally { setBusy(false); }
  }
  return <div className={styles.assistant} aria-label="Assistant controls">
    {state ? <><p>{!state.enabled ? "Assistant disabled · Manual chat available" : state.mode === "active" ? "AI ACTIVE" : state.mode === "takeover" ? "ADMIN TAKEOVER" : "NEEDS ADMIN REPLY · Assistant paused"}{state.needs_admin_reply && state.mode !== "escalated" ? " · NEEDS ADMIN REPLY" : ""}</p>
      {state.enabled ? <button disabled={busy} onClick={() => void control(state.mode === "active" ? "pause" : "resume")}>{state.mode === "active" ? "Take over" : "Re-enable assistant"}</button> : null}</> : !error ? <p role="status">Loading assistant controls…</p> : null}
    {error ? <p role="status">{error}</p> : null}
  </div>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { chatErrorMessage, chatFileRequest, type ChatFile } from "@/lib/chat/client";
import styles from "./workspace.module.css";

/** Only metadata initially. Never preload full files or expose Storage URLs. */
export function ChatFileCard({ file, endpoint, caseId, reason }: { file: ChatFile; endpoint: string; caseId?: string; reason?: string }) {
  const [preview, setPreview] = useState<string | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const version = useRef(0), objectUrl = useRef<string | null>(null);
  function clear() { version.current++; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; setPreview(null); }
  useEffect(() => () => { version.current++; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  useEffect(() => {
    if (!caseId) return;
    window.addEventListener("blur", clear); document.addEventListener("visibilitychange", clear);
    return () => { window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear); };
  }, [caseId]);
  async function open(intent: "view" | "download") {
    if (busy) return; const turn = version.current; setBusy(true); setError("");
    try {
      const response = await chatFileRequest(endpoint, { "x-chat-action": intent, "x-chat-attachment": file.id, ...(caseId ? { "x-chat-case": caseId, "x-chat-reason": encodeURIComponent(reason ?? "") } : {}) });
      const blob = await response.blob(); if (turn !== version.current) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const url = URL.createObjectURL(blob); objectUrl.current = url;
      if (intent === "view" && file.mime_type.startsWith("image/")) setPreview(url);
      else { const link = document.createElement("a"); link.href = url; link.download = file.file_name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (cause) { if (turn === version.current) setError(chatErrorMessage(cause)); }
    finally { if (turn === version.current) setBusy(false); }
  }
  return <div className={styles.fileCard}><strong>{file.file_name}</strong><small>{Math.ceil(file.byte_size / 1024)} KB · {file.mime_type === "application/pdf" ? "PDF" : "Image"}</small>
    {file.mime_type.startsWith("image/") ? <button type="button" disabled={busy} onClick={() => void open("view")}>View image</button> : null}
    <button type="button" disabled={busy} onClick={() => void open("download")}>Download {file.mime_type === "application/pdf" ? "PDF" : "file"}</button>
    {preview ? <div><img src={preview} alt={file.file_name}/><button type="button" onClick={clear}>Close image</button></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

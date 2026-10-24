"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { requestChat } from "@/lib/chat/client";
import { unreadLabel } from "@/lib/chat/display";
import styles from "./launcher.module.css";

type Summary = { user_id: string; unread_count: number; realtime_enabled: boolean };
export function ChatLauncher({ href = "/messages", endpoint = "/api/dekez-chat" }: { href?: string; endpoint?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let stop: (() => void) | undefined, userId: string | undefined, fetching = false, queued = false;
    async function refresh() {
      if (controller.signal.aborted) return;
      if (fetching) { queued = true; return; }
      fetching = true;
      try {
        const rows = await requestChat<Summary[]>(endpoint, new URLSearchParams({ view: "summary" }), controller.signal);
        if (controller.signal.aborted) return;
        const summary = rows[0];
        setCount(Number(summary?.unread_count ?? 0));
        if (summary?.realtime_enabled && summary.user_id !== userId) {
          stop?.(); userId = summary.user_id;
          const { subscribeChat } = await import("@/lib/chat/realtime");
          if (!controller.signal.aborted) stop = subscribeChat(userId, null, () => void refresh());
        }
      } catch { if (!controller.signal.aborted) setCount(0); }
      finally { fetching = false; if (queued && !controller.signal.aborted) { queued = false; void refresh(); } }
    }
    // Bootstrap only the authenticated caller, never another account.
    void requestChat(endpoint, { action: "bootstrap" }, controller.signal).then(refresh).catch(() => {});
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(visibleRefresh, 60000);
    window.addEventListener("dekez-chat-read", visibleRefresh);
    window.addEventListener("online", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => { controller.abort(); stop?.(); clearInterval(timer); window.removeEventListener("dekez-chat-read", visibleRefresh); window.removeEventListener("online", visibleRefresh); document.removeEventListener("visibilitychange", visibleRefresh); };
  }, [endpoint]);
  return <Link href={href} className={styles.launcher} aria-label={`Messages${count > 0 ? `, ${count} unread` : ""}`} title="Messages">
    <MessageCircle size={22} aria-hidden />
    {count > 0 ? <span className={styles.badge} aria-live="polite">{unreadLabel(count)}</span> : null}
  </Link>;
}

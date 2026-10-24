import { createClient } from "@/lib/supabase/client";

/** Events invalidate authorized API data; event bodies are never rendered. */
export function subscribeChat(userId: string, conversationId: string | null, changed: () => void, connection?: (connected: boolean) => void) {
  const client = createClient();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const notify = () => { if (!disposed && !timer) timer = setTimeout(() => { timer = undefined; if (!disposed) changed(); }, 200); };
  const channel = client.channel(`dekez-chat:${userId}:${conversationId ?? "inbox"}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "dekez_chat_signals", filter: `user_id=eq.${userId}` }, notify);
  channel.subscribe(status => {
    if (disposed) return;
    if (status === "SUBSCRIBED") { connection?.(true); notify(); }
    else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) connection?.(false);
  });
  return () => { disposed = true; if (timer) clearTimeout(timer); void client.removeChannel(channel); };
}

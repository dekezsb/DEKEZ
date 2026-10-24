import { createClient } from "@/lib/supabase/client";

type Listener = { changed: () => void; connection?: (connected: boolean) => void };
// Browser subscriptions only, no private payload cache. Header and open chat share
// one user-filtered channel, removed when its final consumer unmounts.
const subscriptions = new Map<string, { listeners: Set<Listener>; stop: () => void; connected: boolean }>();
export function subscribeChat(userId: string, _conversationId: string | null, changed: () => void, connection?: (connected: boolean) => void) {
  const listener = { changed, connection };
  const existing = subscriptions.get(userId);
  if (existing) {
    existing.listeners.add(listener); connection?.(existing.connected);
    return () => { existing.listeners.delete(listener); if (!existing.listeners.size) { existing.stop(); subscriptions.delete(userId); } };
  }
  const client = createClient();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const listeners = new Set([listener]);
  const notify = () => { if (!disposed && !timer) timer = setTimeout(() => { timer = undefined; if (!disposed) listeners.forEach(item => item.changed()); }, 200); };
  const channel = client.channel(`dekez-chat:${userId}:inbox`)
    .on("postgres_changes", { event: "*", schema: "public", table: "dekez_chat_signals", filter: `user_id=eq.${userId}` }, notify);
  const state = { listeners, connected: false, stop: () => { disposed = true; if (timer) clearTimeout(timer); void client.removeChannel(channel); } };
  subscriptions.set(userId, state);
  channel.subscribe(status => {
    if (disposed) return;
    if (status === "SUBSCRIBED") { state.connected = true; listeners.forEach(item => item.connection?.(true)); notify(); }
    else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) { state.connected = false; listeners.forEach(item => item.connection?.(false)); }
  });
  return () => { listeners.delete(listener); if (!listeners.size) { state.stop(); subscriptions.delete(userId); } };
}

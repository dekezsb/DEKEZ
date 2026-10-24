// Deliberately NOT a Supabase Realtime simulation or live-service claim.
// The actual subscription filter/cleanup adapter has separate unit coverage.
export function subscribeChat(userId, conversationId, changed) {
  window.addEventListener('fixture-chat-change', changed);
  return () => window.removeEventListener('fixture-chat-change', changed);
}

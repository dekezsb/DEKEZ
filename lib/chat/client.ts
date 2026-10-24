export type ChatFile = { id: string; message_id: string; file_name: string; mime_type: string; byte_size: number };
export type ChatMessage = { id: string; conversation_id: string; sender_id: string; seq: number; body: string; created_at: string; attachments?: ChatFile[] };
export type InboxItem = { conversation_id: string; status: "active" | "closed"; last_message_at: string; unread_count: number; preview: string | null; contact_name: string };
export type ChatContact = { relationship_id: string; contact_id: string; contact_name: string; chat_role: string; property_id: string; maintenance_ticket_id: string | null };
export type ChatDetail = { conversation_id: string; status: "active" | "closed"; contact_name: string; property_name: string; ticket_number: string | null };

export class ChatRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function requestChat<T>(endpoint: string, params: URLSearchParams | Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const get = params instanceof URLSearchParams;
  const response = await fetch(get ? `${endpoint}?${params}` : endpoint, {
    method: get ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: get ? undefined : { "Content-Type": "application/json" }, body: get ? undefined : JSON.stringify(params),
  });
  if (response.redirected) throw new ChatRequestError("Please sign in again to open Messages.", 401);
  let payload: { data?: T; error?: string };
  try { payload = await response.json(); } catch { throw new ChatRequestError("Unable to connect to chat. Please retry.", response.status); }
  if (!response.ok) throw new ChatRequestError(payload.error ?? "Unable to complete this chat request.", response.status);
  return payload.data as T;
}

export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map(m => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function chatErrorMessage(error: unknown): string {
  return error instanceof ChatRequestError ? error.message : "Unable to connect. Your draft is still here; please retry.";
}

export async function chatHistory(endpoint: string, params: URLSearchParams, files: boolean, signal?: AbortSignal): Promise<ChatMessage[]> {
  const messages = await requestChat<ChatMessage[]>(endpoint, params, signal);
  if (!files || !messages.length) return messages;
  const attachments = await requestChat<ChatFile[]>(endpoint, { action: "files", conversationId: params.get("conversation"), messageIds: messages.map(m => m.id) }, signal);
  return messages.map(message => ({ ...message, attachments: attachments.filter(file => file.message_id === message.id) }));
}

export async function chatFileRequest(endpoint: string, headers: Record<string, string>, body?: File): Promise<Response> {
  const response = await fetch(`${endpoint}/files`, { method: "POST", credentials: "same-origin", cache: "no-store", headers, body });
  if (response.redirected) throw new ChatRequestError("Please sign in again.", 401);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ChatRequestError(payload.error || "Unable to open secure file. Please retry.", response.status);
  }
  return response;
}

/** One command contract for every portal. Identity always comes from the session. */
export type ChatCommand = { rpc: string; args: Record<string, unknown> };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const position = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 50 && v.every(uuid);

export function chatCommand(input: unknown): ChatCommand | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  // Reject identity/scope injection rather than accidentally forwarding it.
  if (["sender_id", "user_id", "role", "participants", "assigned_to", "scope_id", "message_type", "system_label"].some(k => k in p)) return null;
  switch (p.action) {
    case "assistant-control":
      return uuid(p.conversationId) && ["pause", "resume"].includes(String(p.mode)) ? { rpc: "dekez_chat_assistant", args: { p_action: p.mode, p_conversation: p.conversationId } } : null;
    case "bootstrap":
      return { rpc: "dekez_chat_bootstrap", args: {} };
    case "open-desk":
      return uuid(p.deskId) ? { rpc: "dekez_chat_desk_open", args: { p_desk: p.deskId } } : null;
    case "files":
      return uuid(p.conversationId) && ids(p.messageIds) ? { rpc: "dekez_chat_files", args: { p_conversation: p.conversationId, p_messages: p.messageIds } } : null;
    case "send-file":
      return uuid(p.uploadId) && text(p.body, 1, 10000) ? { rpc: "dekez_chat_file_send", args: { p_upload: p.uploadId, p_body: p.body.trim() } } : null;
    case "member-setup":
      return uuid(p.accountId) && [p.enabled,p.support,p.dispatch,p.previewAcknowledged].every(v => typeof v === "boolean") && text(p.reason,5,1000)
        ? { rpc: "dekez_chat_member_setup", args: { p_user:p.accountId,p_enabled:p.enabled,p_support:p.support,p_dispatch:p.dispatch,p_preview_ack:p.previewAcknowledged,p_reason:p.reason.trim() } } : null;
    case "relationship-setup":
      return uuid(p.accountA) && uuid(p.accountB) && uuid(p.propertyId) && [p.roomId,p.tenancyId,p.ticketId].every(v => v === null || uuid(v)) && text(p.reason,5,1000)
        ? { rpc: "dekez_chat_relationship_setup", args: { p_a:p.accountA,p_b:p.accountB,p_property:p.propertyId,p_room:p.roomId,p_tenancy:p.tenancyId,p_ticket:p.ticketId,p_reason:p.reason.trim() } } : null;
    case "relationship-revoke":
      return uuid(p.relationshipId) && text(p.reason,5,1000) ? { rpc:"dekez_chat_relationship_revoke",args:{p_relationship:p.relationshipId,p_reason:p.reason.trim()} } : null;
    case "open":
      return uuid(p.relationshipId) ? { rpc: "dekez_chat_open", args: { p_relationship: p.relationshipId } } : null;
    case "send":
      return uuid(p.conversationId) && uuid(p.clientKey) && text(p.body, 1, 10000)
        ? { rpc: "dekez_chat_send", args: { p_conversation: p.conversationId, p_body: p.body.trim(), p_key: p.clientKey } } : null;
    case "read":
      return uuid(p.conversationId) && position(p.sequence)
        ? { rpc: "dekez_chat_read", args: { p_conversation: p.conversationId, p_seq: p.sequence } } : null;
    case "report":
      return uuid(p.conversationId) && typeof p.reason === "string"
        && ["not_responding", "inappropriate", "suspected_fraud", "quotation", "payment_dispute", "other"].includes(p.reason)
        && text(p.explanation, 1, 4000) && ids(p.messageIds) && ids(p.attachmentIds)
        ? { rpc: "dekez_chat_report", args: { p_conversation: p.conversationId, p_reason: p.reason,
          p_explanation: p.explanation.trim(), p_messages: p.messageIds, p_attachments: p.attachmentIds } } : null;
    case "evidence":
      return uuid(p.caseId) && uuid(p.messageId) && text(p.reason, 5, 1000)
        ? { rpc: "dekez_chat_evidence", args: { p_case: p.caseId, p_message: p.messageId, p_reason: p.reason.trim() } } : null;
    case "support-manifest":
      return uuid(p.caseId) && text(p.reason, 5, 1000)
        ? { rpc: "dekez_chat_support_manifest", args: { p_case: p.caseId, p_reason: p.reason.trim() } } : null;
    case "support-assign":
      return uuid(p.caseId) && uuid(p.staffId) && position(p.minutes) && p.minutes >= 15 && p.minutes <= 1440 && text(p.reason, 5, 1000)
        ? { rpc: "dekez_chat_support_assign", args: { p_case: p.caseId, p_staff: p.staffId, p_minutes: p.minutes, p_reason: p.reason.trim() } } : null;
    case "support-status":
      return uuid(p.caseId) && typeof p.status === "string" && ["under_review", "waiting_for_response", "resolved", "closed"].includes(p.status) && text(p.reason, 5, 1000)
        ? { rpc: "dekez_chat_support_status", args: { p_case: p.caseId, p_status: p.status, p_reason: p.reason.trim() } } : null;
    default: return null;
  }
}

export function chatQuery(params: URLSearchParams): ChatCommand | null {
  const view = params.get("view") ?? "inbox";
  if (view === "assistant") {
    const conversation = params.get("conversation");
    return uuid(conversation) ? { rpc: "dekez_chat_assistant", args: { p_action: "status", p_conversation: conversation } } : null;
  }
  if (view === "summary") return { rpc: "dekez_chat_summary", args: {} };
  if (view === "desks") return { rpc: "dekez_chat_desks", args: {} };
  if (view === "setup-options") {
    const kind=params.get("kind"), property=params.get("property"), after=params.get("after");
    return kind && ["accounts","properties","jobs"].includes(kind) && (property===null || uuid(property)) && (after===null || uuid(after))
      ? {rpc:"dekez_chat_setup_options",args:{p_kind:kind,p_property:property,p_after:after}} : null;
  }
  if (view === "detail") {
    const conversation = params.get("conversation");
    return uuid(conversation) ? { rpc: "dekez_chat_detail", args: { p_conversation: conversation, ...(params.get("context") === "true" ? { p_context: true } : {}) } } : null;
  }
  if (view === "history") {
    const conversation = params.get("conversation"), before = params.get("before");
    if (!uuid(conversation) || before !== null && (!/^\d+$/.test(before) || !position(Number(before)))) return null;
    return { rpc: "dekez_chat_history", args: { p_conversation: conversation, p_before: before === null ? null : Number(before), p_limit: 40 } };
  }
  if (view === "contacts" || view === "support-staff") {
    const after = params.get("after");
    return after !== null && !uuid(after) ? null : { rpc: view === "contacts" ? "dekez_chat_contacts" : "dekez_chat_support_staff", args: { p_after: after, p_limit: 25 } };
  }
  if (view === "inbox" || view === "support-queue") {
    const before = params.get("before"), beforeId = params.get("beforeId");
    if (before !== null && (!Number.isFinite(Date.parse(before)) || !uuid(beforeId))) return null;
    const filter = params.get("filter");
    if (filter !== null && (view !== "inbox" || !["all", "unread", "tenant", "owner", "contractor", "automated", "needs_reply", "ai_answered"].includes(filter))) return null;
    return { rpc: view === "inbox" ? "dekez_chat_inbox" : "dekez_chat_support_queue", args: { p_before: before, p_before_id: beforeId, p_limit: 25, ...(filter !== null ? { p_filter: filter } : {}) } };
  }
  return null;
}

export function chatError(code?: string): { status: number; message: string } {
  if (code === "42501") return { status: 403, message: "This conversation or action is not authorized. The related job may have closed." };
  if (code === "P0001" || code === "23514" || code === "22P02") return { status: 400, message: "Check your message or selected evidence and try again." };
  return { status: 503, message: "Chat is temporarily unavailable. Your draft has not been sent. Please retry." };
}

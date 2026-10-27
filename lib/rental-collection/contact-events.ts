import { createHash } from "node:crypto";

export const COLLECTION_CHANNEL = "FALCON-D9NS9";
type ContactEvent = { type: "contact"; kind: "stop" | "start"; id: string; messageId: string; recipient: string; occurredAt: string };
type ReceiptEvent = { type: "receipt"; status: "sent" | "delivered" | "read" | "failed" | "unknown"; id: string; messageId: string; recipient: string; occurredAt: string };
export type CollectionEvent = ContactEvent | ReceiptEvent;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(v);
const phone = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{8,14}$/.test(v);

// Suppression is intentionally broader than send eligibility: STOP from a valid
// direct sender must be retained even if no unique tenant currently matches it.
export function contactCommand(value: unknown): "stop" | "start" | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const text = value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]$/, "");
  if (["stop", "unsubscribe", "opt out", "stop messages", "please stop", "please stop messaging me", "berhenti", "hentikan", "jangan hantar mesej", "jangan mesej saya"].includes(text)) return "stop";
  return ["start", "subscribe", "mula"].includes(text) ? "start" : null;
}

function occurred(value: unknown, now: Date): string | null {
  const seconds = typeof value === "string" && /^\d{10}$/.test(value) ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 946684800 || seconds > now.getTime() / 1000 + 60) return null;
  return new Date(seconds * 1000).toISOString();
}

// Documented Whapi messages.post / statuses.post body envelopes. No identity
// comes from message text, quoted messages, display names, groups or LID guesses.
export function collectionEvents(payload: unknown, now = new Date()): CollectionEvent[] {
  if (!record(payload) || payload.channel_id !== COLLECTION_CHANNEL || !record(payload.event) || payload.event.event !== "post") return [];
  const events: CollectionEvent[] = [];
  if (payload.event.type === "messages" && Array.isArray(payload.messages) && payload.messages.length <= 50) {
    for (const m of payload.messages) {
      if (!record(m) || m.from_me !== false || m.type !== "text" || !phone(m.from)
        || m.chat_id !== `${m.from}@s.whatsapp.net` || !validId(m.id) || !record(m.text)) continue;
      const kind = contactCommand(m.text.body), occurredAt = occurred(m.timestamp, now);
      if (kind && occurredAt) events.push({type: "contact", kind, id: `message:${m.id}`, messageId: m.id, recipient: m.from, occurredAt});
    }
  }
  if (payload.event.type === "statuses" && Array.isArray(payload.statuses) && payload.statuses.length <= 50) {
    const codes: Record<string, number> = {sent: 2, delivered: 3, read: 4};
    for (const s of payload.statuses) {
      if (!record(s) || !validId(s.id) || typeof s.status !== "string" || !["failed", "pending", "sent", "delivered", "read"].includes(s.status)
        || (Object.hasOwn(codes, s.status) ? s.code !== codes[s.status]
          : typeof s.code !== "number" || !Number.isInteger(s.code) || s.code < 0 || s.code > 1)
        || typeof s.recipient_id !== "string" || !/^[1-9][0-9]{8,14}@s\.whatsapp\.net$/.test(s.recipient_id)) continue;
      const occurredAt = occurred(s.timestamp, now);
      if (!occurredAt) continue;
      const recipient = s.recipient_id.split("@")[0];
      // Whapi can repeat a status; this deterministic event key survives retries.
      const id = createHash("sha256").update([COLLECTION_CHANNEL, s.id, recipient, s.status, occurredAt].join("|")).digest("hex");
      events.push({type: "receipt", status: s.status === "pending" ? "unknown" : s.status as ReceiptEvent["status"], id, messageId: s.id, recipient, occurredAt});
    }
  }
  return [...new Map(events.map(event => [event.id, event])).values()];
}

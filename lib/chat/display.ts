/** Presentation only; identity and access always use the existing account IDs. */
export function shortChatName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return "Contact";
  // Server-provided room labels are already deliberately short.
  if (clean.includes(" · ") || clean.startsWith("Room ")) return clean;
  return clean.split(" ").slice(0, 2).join(" ");
}
export function chatInitials(name: string): string {
  return shortChatName(name).split(/[\s·]+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
}
export function unreadLabel(count: number): string {
  return count > 99 ? "99+" : count > 0 ? String(count) : "";
}

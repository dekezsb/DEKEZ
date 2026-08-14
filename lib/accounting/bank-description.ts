export function bankDescriptionKey(value: string | null | undefined) {
  return String(value ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " DATE ")
    .replace(/\b\d+[.,]\d{2}\b/g, " AMOUNT ")
    .replace(/\b\d{6,}\b/g, " REF ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

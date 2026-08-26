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

const tenantNameStopWords = new Set([
  "abdul",
  "ahmad",
  "al",
  "anak",
  "bin",
  "binti",
  "bt",
  "haji",
  "hj",
  "mohamad",
  "mohammad",
  "mohd",
  "muhammad",
  "nur",
  "siti",
]);

function searchableNameTokens(value: string | null | undefined) {
  return Array.from(
    new Set(
      String(value ?? "")
        .toUpperCase()
        .normalize("NFKD")
        .match(/[A-Z]+/g)
        ?.map((token) => token.toLowerCase())
        .filter((token) => token.length >= 2 && !tenantNameStopWords.has(token)) ?? [],
    ),
  );
}

/**
 * Scores only meaningful tenant-name words found in the bank text. Property
 * codes, room numbers, QR references and common name particles cannot raise
 * this score, so an exact room alone is never mistaken for a name match.
 */
export function bankTenantNameMatchScore(
  bankText: string | null | undefined,
  tenantName: string | null | undefined,
) {
  const bankTokens = new Set(searchableNameTokens(bankText));
  const tenantTokens = searchableNameTokens(tenantName);
  return tenantTokens.filter((token) => bankTokens.has(token)).length;
}

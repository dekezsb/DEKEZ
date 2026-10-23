/** Marketplace amounts only. No invoicing, project collection or ledger side effects. */
export type QuotationLineInput = {
  description: string;
  quantity: string;
  unitPrice: string;
};
export type QuotationTotals = {
  lineTotalsCents: number[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

// Use decimal strings from inputs and integer arithmetic; do not accept exponent,
// negative, non-finite or silently rounded values. Quantity supports 3 decimals.
function scaledDecimal(value: string, places: number, name: string): bigint {
  if (typeof value !== "string" || value.length > 24 || !new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(value)) {
    throw new Error(`Enter a valid ${name}.`);
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(10 ** places) + BigInt(fraction.padEnd(places, "0"));
}
function safeAmount(value: bigint): number {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Quotation amount is too large.");
  return Number(value);
}
function roundPositive(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

/** Round each line to cents, sum rounded lines, then round tax once on subtotal. */
export function calculateQuotationTotals(lines: readonly QuotationLineInput[], taxPercent: string): QuotationTotals {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 200) throw new Error("Add between 1 and 200 quotation items.");
  const rate = scaledDecimal(taxPercent, 2, "tax percentage");
  if (rate > BigInt(10000)) throw new Error("Tax percentage cannot exceed 100%.");
  const lineTotals = lines.map(line => {
    if (!line || typeof line.description !== "string" || !line.description.trim() || line.description.length > 2000) {
      throw new Error("Add a description for each quotation item (maximum 2,000 characters).");
    }
    const quantity = scaledDecimal(line.quantity, 3, "quantity");
    if (quantity === BigInt(0)) throw new Error("Quantity must be greater than zero.");
    const price = scaledDecimal(line.unitPrice, 2, "unit price");
    return roundPositive(quantity * price, BigInt(1000));
  });
  const subtotal = lineTotals.reduce((sum, amount) => sum + amount, BigInt(0));
  if (subtotal === BigInt(0)) throw new Error("Quotation total must be greater than zero.");
  const tax = roundPositive(subtotal * rate, BigInt(10000));
  return {
    lineTotalsCents: lineTotals.map(safeAmount), subtotalCents: safeAmount(subtotal),
    taxCents: safeAmount(tax), totalCents: safeAmount(subtotal + tax),
  };
}

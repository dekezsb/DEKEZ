export type WorkLine = { description: string; quantity: number; unit: string; rate: number };
export type PaymentStage = { label: string; percent: number };
export type RenovationClient = { id: string; name: string; phone: string; email: string; address: string };
export type CatalogueItem = { id: string; description: string; unit: string; rate: number };
export type RenovationPayment = { id: string; invoice_id: string; amount: number; payment_date: string; reference_number: string; status: "pending" | "verified" | "rejected"; bank_transaction_id: string | null; bank_account_id: string; proof_path: string; rejection_reason: string | null; proofUrl?: string; matched?: number };
export function paymentSummary(total: number, payments: RenovationPayment[]) {
  const verified = payments.filter(p => p.status === "verified").reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
  const pending = payments.filter(p => p.status === "pending").reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
  return { verified: verified / 100, pending: pending / 100, outstanding: (Math.round(total * 100) - verified) / 100 };
}
export type RenovationDocument = {
  id: string; company_id: string; kind: "quotation" | "invoice";
  status: "draft" | "issued" | "approved" | "superseded"; document_number: string | null;
  client_id: string; client_snapshot: Omit<RenovationClient, "id">;
  project: string; site_address: string; document_date: string; due_date: string;
  items: WorkLine[]; stages: PaymentStage[]; terms: string; total: number;
  discount_kind: "amount" | "percent"; discount_value: number; discount_amount: number; revision_of_id: string | null;
  source_quotation_id: string | null; approval_name: string | null;
  approval_evidence: string | null; approved_at: string | null;
  journal_entry_id: string | null; version: number; created_at: string;
};

export const defaultStages: PaymentStage[] = [
  { label: "Down payment - before commencement", percent: 50 },
  { label: "Progress payment - approximately 50% completion", percent: 30 },
  { label: "Final payment - completion, final check and handover", percent: 20 },
];
export const defaultTerms = [
  "All materials, labour, normal tools, equipment and installation required for the listed scope are included.",
  "Final paint colours and the agreed scope shall be confirmed by the Client before work begins.",
  "Additional or changed works outside this quotation require an agreed Variation Order and will be charged separately.",
  "Payments are due according to the payment stages above. Work and material preparation commence upon confirmation and receipt of the down payment.",
  "Final measurements and quantities are subject to site verification and the agreed layout.",
  "This quotation is valid until the validity date shown above.",
].join("\n");

// Reusable scope suggestions, not Michelle's job or approved prices.
export const starterItems = [
  ["9mm gypsum board partition, both sides", "SQ FT"],
  ["Metal stud framing and support system", "LOT"],
  ["Plywood doors and door frames", "SET"],
  ["Door locks, handles and accessories", "SET"],
  ["Joint tape, compound, sanding and surface preparation", "LOT"],
  ["Paint to new partition walls", "LOT"],
  ["Paint to existing wall surfaces within renovation area", "LOT"],
  ["Floor paint / coating to renovation area", "LOT"],
  ["LED light points including wiring", "POINT"],
  ["Double power points including wiring and sockets", "POINT"],
  ["Wall fan power points including wiring", "POINT"],
  ["Wall-mounted fan and LED light supply", "UNIT"],
  ["Wall fan installation, connection and testing", "UNIT"],
  ["Transportation and delivery of materials", "LOT"],
  ["Dismantling partitions and cleaning", "LOT"],
  ["Consumables, fasteners, sealant and accessories", "LOT"],
  ["Renovation debris collection and disposal", "LOT"],
  ["Roller bin for waste material", "LOT"],
].map(([description, unit]) => ({ description, unit, rate: 0 }));

export function lineCents(line: WorkLine) {
  // Quantity: 3 decimal places; rate: 2. Match PostgreSQL numeric rounding.
  return Math.round(Math.round(line.quantity * 1000) * Math.round(line.rate * 100) / 1000);
}
export function totalCents(lines: WorkLine[]) {
  return lines.reduce((sum, line) => sum + lineCents(line), 0);
}
export function stageAmounts(cents: number, stages: PaymentStage[]) {
  let allocated = 0;
  return stages.map((stage, index) => {
    const amount = index === stages.length - 1 ? cents - allocated : Math.round(cents * stage.percent / 100);
    allocated += amount;
    return amount / 100;
  });
}
export function discountCents(subtotal: number, kind: "amount" | "percent", value: number) {
  return kind === "percent" ? Math.round(subtotal * Math.round(value * 100) / 10000) : Math.round(value * 100);
}
export function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const money = (value: number) => new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);

// Filing is a view rule only: retain quotation IDs, approval and invoice links.
export function renovationWorkspaceDocuments(documents: RenovationDocument[], clientId = "") {
  if (clientId) return documents.filter(d => d.client_id === clientId);
  const converted = new Set(documents.filter(d => d.kind === "invoice" && d.status === "issued")
    .map(d => d.source_quotation_id).filter(Boolean));
  return documents.filter(d => !(d.kind === "quotation" && (d.status === "approved" || converted.has(d.id))));
}

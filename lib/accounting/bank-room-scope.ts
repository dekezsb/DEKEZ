export type BankRoom = { propertyCode: string; roomCode: string };
type Bank = { reference: string; description: string; date: string };
export const normalizeRoomCode = (value: string) => value.trim().toUpperCase().replace(/^ROOM\s*/i, '').replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
const propertyCode = (value: string) => value.toUpperCase().match(/\b(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\b/)?.[1] ?? '';

// Never silently pick the first room when reference and description disagree.
export function bankRoomScope(bank: Pick<Bank, 'reference' | 'description'>) {
  const locations = new Map<string, BankRoom>();
  for (const text of [bank.reference, bank.description]) {
    const pattern = /\b(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*[-–—:/]?\s*(?:ROOM\s*)?([A-Z]?\d+[A-Z]?)\b/gi;
    for (const match of text.matchAll(pattern)) {
      const room = { propertyCode: match[1].toUpperCase(), roomCode: normalizeRoomCode(match[2]) };
      locations.set(`${room.propertyCode}:${room.roomCode}`, room);
    }
  }
  return { hint: locations.size === 1 ? [...locations.values()][0] : null, conflict: locations.size > 1 };
}

export function paymentInBankScope(bank: Bank, payment: { property: string; propertyCode?: string; room: string; date: string; invoiceMonth?: string | null; allocationParts?: {invoiceMonth?:string|null}[] }) {
  const { hint, conflict } = bankRoomScope(bank);
  if (conflict || !/^\d{4}-\d{2}-\d{2}$/.test(bank.date)) return false;
  const month = bank.date.slice(0, 7);
  if (payment.date.slice(0, 7) !== month || (payment.invoiceMonth && payment.invoiceMonth.slice(0, 7) !== month)) return false;
  if (payment.allocationParts?.some(part=>part.invoiceMonth && part.invoiceMonth.slice(0,7)!==month)) return false;
  return !hint || ((payment.propertyCode?.trim().toUpperCase() || propertyCode(payment.property)) === hint.propertyCode
    && normalizeRoomCode(payment.room) === hint.roomCode);
}

export type RoomInvoiceOption = {
  id: string; invoiceNumber: string | null; billMonth: string; tenantName: string;
  propertyCode: string; roomCode: string; rentOutstanding: number;
  invoiceAmount: number; paidAmount: number;
};

// Paid invoices stay visible. An invoice alone is not proof of a new payment.
export function roomInvoicesForBank(bank: Bank, invoices: RoomInvoiceOption[]) {
  const { hint } = bankRoomScope(bank);
  if (!hint) return [];
  return invoices.filter(invoice => invoice.billMonth.slice(0, 7) === bank.date.slice(0, 7)
    && invoice.propertyCode.toUpperCase() === hint.propertyCode
    && normalizeRoomCode(invoice.roomCode) === hint.roomCode);
}

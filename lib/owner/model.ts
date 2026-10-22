// Owner-safe DTOs: never add tenant identity, staff notes, or raw storage paths.
export type OwnerProperty = { id: string; name: string; address: string | null; city: string | null };
export type OwnerRoom = { id: string; property_id: string; name: string; status: string; rent: number };
export type OwnerDocument = { id: string; property_id: string | null; share_id: string | null; title: string; category: string; mime: string; date: string };
export type OwnerStatement = { id: string; property_id: string; document_id: string; period: string; income: number; collected: number; outstanding: number; expenses: number; maintenance: number; fee: number; net: number; paid: number };
export type OwnerSnapshot = {
 profile: { name: string; identity: string | null; phone: string | null; tin: string | null; address: string | null; bank_name: string | null; bank_holder: string | null; bank_number: string | null };
 properties: OwnerProperty[]; rooms: OwnerRoom[];
 collections: { id: string; property_id: string; room_id: string | null; date: string; amount: number; paid: number; outstanding: number }[];
 receipts: { id: string; property_id: string; room_id: string | null; bill_id: string | null; amount: number; date: string }[];
 expenses: { id: string; property_id: string; room_id: string | null; title: string; summary: string; amount: number; date: string; status: string }[];
 claims: { id: string; property_id: string; room_id: string | null; title: string; summary: string; amount: number; claimed: number; chargeable: boolean; reported: string | null; completed: string | null; status: string }[];
 documents: OwnerDocument[];
 agreements: { id: string; property_id: string; document_id: string; start: string; end: string; fee: string; terminated: string | null }[];
 statements: OwnerStatement[];
 payouts: { id: string; statement_id: string; property_id: string; amount: number; date: string; reference: string | null; proof_document_id: string | null }[];
};
export const ownerMoney = (value: number) => `RM${Number(value).toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
export function malaysiaDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function ownerMonth(value?: string) { return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : malaysiaDate().slice(0,7); }
export function occupancy(rooms: OwnerRoom[]) {
 const total = rooms.length, occupied = rooms.filter(r=>r.status==='occupied').length, vacant = rooms.filter(r=>r.status==='vacant').length;
 const sum = (rows: OwnerRoom[]) => Math.round(rows.reduce((n,r)=>n+Number(r.rent),0)*100)/100;
 return { total, occupied, vacant, other: total-occupied-vacant, percent: total ? Math.round(occupied/total*1000)/10 : 0,
  potential: sum(rooms), occupiedValue: sum(rooms.filter(r=>r.status==='occupied')), vacancy: sum(rooms.filter(r=>r.status==='vacant')) };
}
export function ownerTotals(data: OwnerSnapshot, property = '') {
 const sum = <T,>(rows: T[], pick: (row:T)=>number) => Math.round(rows.reduce((n,r)=>n+Number(pick(r)),0)*100)/100;
 const scope=data.properties.filter(p=>!property||p.id===property);
 const fullyIssued=scope.length>0&&scope.every(p=>data.statements.some(s=>s.property_id===p.id));
 return { collected: sum(data.receipts,r=>r.amount), outstanding: sum(data.collections,r=>r.outstanding),
  expenses: sum(data.expenses,r=>r.amount), net: fullyIssued ? sum(data.statements,r=>r.net) : null,
  fees: fullyIssued ? sum(data.statements,r=>r.fee) : null };
}
export function agreementStatus(a: OwnerSnapshot['agreements'][number], today = malaysiaDate()) {
 if (a.terminated && a.terminated<=today) return 'Terminated';
 if (a.end<today) return 'Expired';
 if (a.start>today) return 'Upcoming';
 return (Date.parse(a.end)-Date.parse(today))/86400000<=60 ? 'Expiring soon' : 'Active';
}
export function paymentStatus(row: OwnerSnapshot['collections'][number], today=malaysiaDate()) {
 return row.outstanding<=0 ? 'Paid' : row.paid>0 ? 'Partial' : row.date<today ? 'Overdue' : 'Outstanding';
}
export function payoutStatus(s: OwnerStatement) { return s.net<=0 ? 'No payout due' : s.paid>=s.net ? 'Paid' : s.paid>0 ? 'Partially paid' : 'Pending'; }
export function ownerHref(path: string, month: string, property = '') {
 const params = new URLSearchParams({month}); if(property) params.set('property',property); return `/owner/${path}?${params}`;
}

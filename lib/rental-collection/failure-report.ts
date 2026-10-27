import type { CollectionPreviewItem } from "./model";

export const COLLECTION_FAILURE_REPORT_RECIPIENT = "60188702371";
// Use the existing portal entry point, not an Admin-only route that a scoped
// Management account may not be allowed to open. No permissions are widened.
export const COLLECTION_FAILURE_REPORT_PORTAL = "https://dekez.vercel.app/";

type ConfirmedReason = "recipient_invalid" | "recipient_not_on_whatsapp" | "recipient_blocked" | "delivery_failed";
export type CollectionFailureEvidence = {
  attempt_id: string;
  company_id: string;
  tenant_id: string;
  state: "pending" | "sending" | "accepted" | "delivered" | "uncertain" | "rejected" | "failed";
  confirmed_failure: boolean;
  confirmation: "none" | "provider_delivery_receipt" | "authorized_management_review";
  failure_code: ConfirmedReason | "provider_rejected" | "rate_limited" | "channel_error" | null;
  provider_message_id: string | null;
  resolved_at: string | null;
};

// Evidence must come from a fresh, trusted server-side account/permission lookup,
// never a form checkbox. This pure formatter does not itself authenticate anyone.
export type FailureReportRecipientAuthorization = {
  verified: boolean;
  company_id: string;
  recipient: string;
  management_profile_id: string;
  approved_management_account: boolean;
  active_company_membership: boolean;
  rent_due_tracker_manage: boolean;
  whatsapp_ownership_verified: boolean;
  whatsapp_consent: "unknown" | "opted_in" | "opted_out";
};

export type CollectionFailureReportInput = {
  company_id: string;
  report_date: string;
  current_items: readonly CollectionPreviewItem[];
  evidence: readonly CollectionFailureEvidence[];
  all_history_loaded: boolean;
  daily_outcomes_complete: boolean;
  recipient_authorization: FailureReportRecipientAuthorization | null;
  daily_reservation: "unknown" | "not_reserved" | "reserved" | "sent";
};

const reasonLabels: Record<ConfirmedReason, string> = {
  recipient_invalid: "Nombor penerima tidak sah (disahkan)",
  recipient_not_on_whatsapp: "Nombor tidak berdaftar di WhatsApp (disahkan)",
  recipient_blocked: "Penghantaran kepada penerima disekat (disahkan)",
  delivery_failed: "Penghantaran mesej gagal (disahkan)",
};
const label = (value: string | null | undefined) => value?.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim() || "Tidak tersedia — semak Portal Admin";
const cents = (value: number | null) => typeof value === "number" && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
  ? Math.round(value * 100) : null;
const money = (value: number) => `RM ${(value / 100).toLocaleString("ms-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function confirmedUnresolved(record: CollectionFailureEvidence): record is CollectionFailureEvidence & { failure_code: ConfirmedReason } {
  return (record.state === "failed" || record.state === "rejected") && record.confirmed_failure === true
    && record.resolved_at === null && record.failure_code !== null && Object.hasOwn(reasonLabels, record.failure_code)
    && (record.confirmation === "authorized_management_review"
      || (record.confirmation === "provider_delivery_receipt" && !!record.provider_message_id?.trim()));
}

// Use one current authoritative snapshot, not balances copied from historical
// attempts. Identical invoice duplicates count once; conflicts stay unavailable.
function currentBalance(item: CollectionPreviewItem | null, sharedInvoiceIds: Set<string>): number | null {
  if (!item || item.outstanding === null || item.exceptions.length > 0) return null;
  const invoices = new Map<string, CollectionPreviewItem["invoices"][number]>();
  for (const invoice of item.invoices) {
    if (!invoice.collectible) continue;
    const previous = invoices.get(invoice.id);
    if (!invoice.id || sharedInvoiceIds.has(invoice.id) || (previous && JSON.stringify(previous) !== JSON.stringify(invoice))) return null;
    invoices.set(invoice.id, invoice);
  }
  let total = 0;
  for (const invoice of invoices.values()) {
    const balance = cents(invoice.outstanding), paid = cents(invoice.paid_amount), verified = cents(invoice.verified_paid);
    if (balance === null || paid === null || paid !== verified || invoice.exceptions.length > 0) return null;
    total += balance;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total === cents(item.collectible_outstanding) ? total : null;
}

/** Read-only candidate text only. No claim, send, account changes or live cases.
 * The proposed key is NOT durable idempotency; production delivery needs a
 * reviewed database reservation and fresh permission check before transport.
 */
export function buildCollectionFailureReportPreview(input: CollectionFailureReportInput) {
  if (!/^[0-9a-f-]{36}$/i.test(input.company_id) || !/^\d{4}-\d{2}-\d{2}$/.test(input.report_date)
    || new Date(`${input.report_date}T00:00:00Z`).toISOString().slice(0, 10) !== input.report_date) throw new Error("Invalid report scope.");
  if (input.current_items.some(item => item.company_id !== input.company_id || item.report_date !== input.report_date)
    || input.evidence.some(record => record.company_id !== input.company_id || !record.attempt_id || !record.tenant_id)) throw new Error("Inconsistent report scope.");

  const attempts = new Map<string, CollectionFailureEvidence[]>();
  for (const record of input.evidence) attempts.set(record.attempt_id, [...(attempts.get(record.attempt_id) ?? []), record]);
  const failures = [...attempts.values()].filter(records => records.every(confirmedUnresolved)
    && records.every(record => record.tenant_id === records[0].tenant_id)).map(records => records[0]);
  const byTenant = new Map<string, CollectionFailureEvidence[]>();
  for (const record of failures) byTenant.set(record.tenant_id, [...(byTenant.get(record.tenant_id) ?? []), record]);
  const current = new Map<string, CollectionPreviewItem | null>();
  const invoiceOwners = new Map<string, Set<string>>();
  for (const item of input.current_items) {
    if (!item.tenant_id || !byTenant.has(item.tenant_id)) continue;
    const prior = current.get(item.tenant_id);
    current.set(item.tenant_id, current.has(item.tenant_id) && JSON.stringify(prior) !== JSON.stringify(item) ? null : item);
    for (const invoice of item.invoices) {
      const owners = invoiceOwners.get(invoice.id) ?? new Set<string>();
      owners.add(item.tenant_id); invoiceOwners.set(invoice.id, owners);
    }
  }
  const sharedInvoices = new Set([...invoiceOwners].filter(([, owners]) => owners.size > 1).map(([id]) => id));
  const rows = [...byTenant].sort(([left], [right]) => left.localeCompare(right)).map(([tenantId, records]) => {
    const item = current.get(tenantId) ?? null;
    return { item, records, balance: currentBalance(item, sharedInvoices) };
  });
  const unknownBalances = rows.filter(row => row.balance === null).length;
  const total = rows.reduce((sum, row) => sum + (row.balance ?? 0), 0);
  const auth = input.recipient_authorization;
  const recipientVerified = auth?.verified === true && auth.approved_management_account === true
    && auth.active_company_membership === true && auth.rent_due_tracker_manage === true
    && auth.whatsapp_ownership_verified === true && auth.whatsapp_consent === "opted_in"
    && !!auth.management_profile_id.trim() && auth.company_id === input.company_id && auth.recipient === COLLECTION_FAILURE_REPORT_RECIPIENT;
  const complete = input.all_history_loaded && input.daily_outcomes_complete;
  const alreadyReserved = input.daily_reservation === "reserved" || input.daily_reservation === "sent";
  const header = `DEKEZ MANAGEMENT\nLAPORAN PENYEWA GAGAL DIHUBUNGI MELALUI WHATSAPP\nTarikh: ${input.report_date} (Malaysia)`;
  const generic = `${header}\n\nSemakan susulan tersedia melalui Portal Admin yang selamat. Maklumat penyewa tidak disertakan. Akses memerlukan kebenaran akaun pengurusan.\n${COLLECTION_FAILURE_REPORT_PORTAL}`;
  const roster = rows.map(({ item, records, balance }, index) => {
    const locations = item ? [...new Set(item.invoices.map(invoice => `${label(invoice.property_code || invoice.property)} / ${label(invoice.room)}`))] : [];
    const phone = item?.recipient_source === "tenant_portal_login" && item.phone && /^[1-9][0-9]{8,14}$/.test(item.phone) ? item.phone : null;
    const reasons = [...new Set(records.map(record => reasonLabels[record.failure_code as ConfirmedReason]))];
    return [
      `${index + 1}. Nama: ${label(item?.name)}`,
      `Hartanah/Bilik: ${locations.length ? locations.join("; ") : label(null)}`,
      `Telefon log masuk: ${label(phone)}`,
      `Baki invois boleh dituntut yang disahkan: ${balance === null ? "Tidak dapat disahkan — semak pengecualian" : money(balance)}`,
      `Sebab gagal: ${reasons.join("; ")}`,
      `Percubaan gagal belum selesai: ${records.length}`,
    ].join("\n");
  }).join("\n\n");
  const countLine = `Kegagalan disahkan belum selesai: ${rows.length} penyewa; ${failures.length} percubaan unik.`;
  const full = [header, "Rosley, berikut ialah senarai kes penghantaran peringatan WhatsApp yang disahkan gagal dan masih memerlukan tindakan.", countLine, "Termasuk semua rekod terdahulu yang masih belum selesai.",
    `Jumlah baki invois boleh dituntut yang disahkan: ${unknownBalances || !Number.isSafeInteger(total) ? "Tidak tersedia sepenuhnya — semak Portal Admin" : money(total)}.`,
    unknownBalances ? `${unknownBalances} baki penyewa memerlukan semakan.` : "",
    "Status diterima, menunggu dan tidak pasti bukan kegagalan disahkan.",
    !input.daily_outcomes_complete ? "Sebahagian keputusan penghantaran hari ini masih menunggu pengesahan. Senarai ini merangkumi kegagalan yang telah disahkan; draf dalam portal akan dikemas kini apabila keputusan baharu diterima, tanpa mesej WhatsApp kedua pada tarikh yang sama." : "", roster,
    "TINDAKAN DIPERLUKAN:",
    "Rosley, sila hubungi semua penyewa dalam senarai ini melalui panggilan telefon atau kaedah lain yang dibenarkan. Hormati sebarang sekatan komunikasi atau pertikaian yang direkodkan.",
    "Sila dapatkan nombor telefon atau WhatsApp mereka yang terkini dan aktif, kemudian maklumkan nombor baharu kepada pihak pengurusan DEKEZ untuk pengesahan.",
    "Jangan ubah nombor log masuk penyewa secara automatik. Sebarang kemas kini rekod pengesahan akaun mesti disahkan oleh Admin yang diberi kuasa.",
    "Pastikan setiap kes disusuli dan laporkan status tindakan kepada pihak pengurusan.",
    "Susulan melalui Portal Admin; laporan ini tidak mengubah rekod atau membuat percubaan penghantaran semula.", COLLECTION_FAILURE_REPORT_PORTAL,
    "Terima kasih.\nDEKEZ MANAGEMENT",
  ].filter(Boolean).join("\n\n");
  const oversized = full.length > 4000;
  const body = !recipientVerified ? generic : !input.all_history_loaded
    ? `${header}\n\nDRAF — semakan sejarah atau keputusan penghantaran harian belum lengkap. Kemas kini draf yang sama selepas semakan lengkap; jangan hantar laporan susulan kedua.\n${COLLECTION_FAILURE_REPORT_PORTAL}`
    : oversized ? `${header}\n\n${countLine}\nSenarai penuh melebihi had satu mesej. Semua butiran dan baki perlu disemak dalam Portal Admin yang selamat. Tiada senarai dipotong atau dipecahkan kepada mesej berasingan.\n${COLLECTION_FAILURE_REPORT_PORTAL}` : full;
  return {
    readOnlyPreview: true as const, canSend: false as const,
    recipient: COLLECTION_FAILURE_REPORT_RECIPIENT, body,
    containsPersonalDetails: recipientVerified && input.all_history_loaded && !oversized && rows.length > 0,
    failureTenants: rows.length, confirmedUnresolvedAttempts: failures.length,
    excludedAttempts: attempts.size - failures.length, unknownBalances,
    completeRosterRequiresPortal: oversized || !complete,
    readiness: !recipientVerified ? "recipient_unverified" : !complete ? "awaiting_complete_outcomes"
      : alreadyReserved ? "existing_daily_report_only" : input.daily_reservation === "unknown" ? "reservation_unverified" : "ready_for_review",
    updatedDraftOnly: alreadyReserved,
    createAdditionalDailyAlert: false as const,
    durableReservationImplemented: false as const,
    proposedReservationKey: `collection-failures:${input.company_id}:${input.report_date}:${COLLECTION_FAILURE_REPORT_RECIPIENT}`,
  };
}

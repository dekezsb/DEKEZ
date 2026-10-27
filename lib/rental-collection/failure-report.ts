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
  state: "pending" | "sending" | "accepted" | "delivered" | "uncertain" | "unknown" | "rejected" | "failed";
  confirmed_failure: boolean;
  confirmation: "none" | "provider_delivery_receipt" | "authorized_management_review";
  failure_code: ConfirmedReason | "provider_rejected" | "rate_limited" | "channel_error" | null;
  provider_message_id: string | null;
  resolved_at: string | null;
};

export type CollectionContactCategory = "confirmed_failure" | "invalid_login_phone" | "awaiting_delivery"
  | "delivery_unknown" | "unconfirmed_rejection" | "communications_hold" | "source_exception" | "evidence_conflict";
// All unresolved historical cases must be loaded, not only today's attempts.
// An unlinked case stays visible without inventing a tenant identity.
export type CollectionContactCaseEvidence = {
  case_id: string; company_id: string; tenant_id: string | null; tenant_key: string;
  category: Exclude<CollectionContactCategory, "confirmed_failure">;
  reason_code: string; resolved_at: string | null;
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
  contact_cases?: readonly CollectionContactCaseEvidence[];
  all_history_loaded: boolean;
  daily_outcomes_complete: boolean;
  recipient_authorization: FailureReportRecipientAuthorization | null;
  // Trusted server-only viewer authorization, established by fresh Admin RBAC
  // and company scope. This grants portal display, never WhatsApp disclosure.
  portal_authorized?: boolean;
  daily_reservation: "unknown" | "not_reserved" | "reserved" | "sent";
};

const reasonLabels: Record<ConfirmedReason, string> = {
  recipient_invalid: "Nombor penerima tidak sah (disahkan)",
  recipient_not_on_whatsapp: "Nombor tidak berdaftar di WhatsApp (disahkan)",
  recipient_blocked: "Penghantaran kepada penerima disekat (disahkan)",
  delivery_failed: "Penghantaran mesej gagal (disahkan)",
};
export const collectionContactCategoryLabels: Record<CollectionContactCategory, string> = {
  confirmed_failure: "Kegagalan penghantaran disahkan",
  invalid_login_phone: "Nombor log masuk tidak sah atau belum disahkan",
  awaiting_delivery: "Menunggu pengesahan penghantaran — bukan kegagalan disahkan",
  delivery_unknown: "Keputusan penghantaran tidak diketahui — jangan cuba semula secara membuta tuli",
  unconfirmed_rejection: "Penolakan penyedia belum membuktikan kegagalan menghubungi penyewa",
  communications_hold: "Sekatan komunikasi — semakan pengurusan diperlukan",
  source_exception: "Pengecualian data — semakan pengurusan diperlukan",
  evidence_conflict: "Bukti bercanggah — jangan anggap berjaya atau gagal",
};
const holdLabels: Record<string, string> = {
  invalid_phone: "Nombor telefon log masuk tidak sah", recipient_requires_review: "Penerima memerlukan semakan",
  login_phone_missing: "Nombor telefon log masuk tiada", login_recipient_unverified: "Sumber nombor log masuk belum disahkan",
  whatsapp_ownership_unverified: "Pemilikan WhatsApp belum disahkan", consent_missing: "Persetujuan WhatsApp belum disahkan",
  consent_number_mismatch: "Nombor tidak sepadan dengan bukti persetujuan", opted_out: "Penyewa memilih keluar — hormati sekatan hubungan",
  blocked_contact: "Hubungan disekat", communication_hold: "Hubungan ditangguhkan untuk semakan",
  pending_verification: "Bukti bayaran menunggu pengesahan — bukan kegagalan penghantaran",
  allocation_mismatch: "Baki dan peruntukan bayaran memerlukan semakan", shared_phone: "Nombor dikongsi — identiti perlu disahkan",
  previous_tenant_or_room_mismatch: "Identiti penyewa atau bilik tidak sepadan", unlinked_tenant: "Rekod belum dipautkan kepada akaun penyewa",
  policy_disabled: "Polisi penghantaran belum diaktifkan", compliance_not_approved: "Semakan pematuhan belum diluluskan",
  opt_out_not_ready: "Pengendalian permintaan berhenti belum tersedia", provider_rejected: "Permintaan ditolak penyedia; sebab perlu disahkan",
  rate_limited: "Had kadar penyedia dicapai", channel_error: "Masalah saluran penyedia",
  message_review_required: "Mesej peringatan tidak dapat disediakan dengan selamat — semakan Admin diperlukan; tiada penghantaran dicuba",
};
const invalidPhoneCodes = new Set(["invalid_phone", "recipient_requires_review", "login_phone_missing", "login_recipient_unverified"]);
const communicationCodes = new Set(["whatsapp_ownership_unverified", "consent_missing", "consent_number_mismatch", "opted_out", "blocked_contact", "communication_hold", "shared_phone", "previous_tenant_or_room_mismatch", "policy_disabled", "compliance_not_approved", "opt_out_not_ready"]);
const caseReason = (code: string) => holdLabels[code] ?? "Pengecualian lain direkodkan — semak butiran selamat dalam Portal Admin";
const categoryForCode = (code: string): CollectionContactCategory => invalidPhoneCodes.has(code) ? "invalid_login_phone"
  : communicationCodes.has(code) ? "communications_hold" : "source_exception";
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
  if (!item || item.outstanding === null || item.exceptions.some(code => !invalidPhoneCodes.has(code) && !communicationCodes.has(code))) return null;
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
  // No invoice evidence is not proof of a zero balance.
  return item.invoices.length > 0 && total === cents(item.collectible_outstanding) ? total : null;
}

type ContactGroup = {
  tenantId: string | null; categories: Set<CollectionContactCategory>; reasons: Set<string>;
  attempts: Set<string>; confirmed: Set<string>; cases: Set<string>;
};
const groupKey = (tenantId: string | null, key: string) => tenantId ? `tenant:${tenantId}` : `unlinked:${key}`;

/** Read-only candidate text only. No claim, send, account changes or live cases.
 * The proposed key is NOT durable idempotency; production delivery needs a
 * reviewed database reservation and fresh permission check before transport.
 */
export function buildCollectionFailureReportPreview(input: CollectionFailureReportInput) {
  if (!/^[0-9a-f-]{36}$/i.test(input.company_id) || !/^\d{4}-\d{2}-\d{2}$/.test(input.report_date)
    || new Date(`${input.report_date}T00:00:00Z`).toISOString().slice(0, 10) !== input.report_date) throw new Error("Invalid report scope.");
  const contactCases = input.contact_cases ?? [];
  if (input.current_items.some(item => item.company_id !== input.company_id || item.report_date !== input.report_date || (!item.tenant_id && !item.key))
    || input.evidence.some(record => record.company_id !== input.company_id || !record.attempt_id || !record.tenant_id)
    || contactCases.some(record => record.company_id !== input.company_id || !record.case_id || (!record.tenant_id && !record.tenant_key))) throw new Error("Inconsistent report scope.");

  const groups = new Map<string, ContactGroup>();
  const add = (key: string, tenantId: string | null, category: CollectionContactCategory, reason: string, attempt?: string, caseId?: string) => {
    const group = groups.get(key) ?? { tenantId, categories: new Set<CollectionContactCategory>(), reasons: new Set<string>(), attempts: new Set<string>(), confirmed: new Set<string>(), cases: new Set<string>() };
    group.categories.add(category); group.reasons.add(reason);
    if (attempt) group.attempts.add(attempt);
    if (attempt && category === "confirmed_failure") group.confirmed.add(attempt);
    if (caseId) group.cases.add(caseId);
    groups.set(key, group);
  };
  const attempts = new Map<string, CollectionFailureEvidence[]>();
  for (const record of input.evidence) attempts.set(record.attempt_id, [...(attempts.get(record.attempt_id) ?? []), record]);
  const includedAttempts = new Set<string>(), confirmedAttempts = new Set<string>();
  for (const [attemptId, records] of attempts) {
    const open = records.filter(record => record.resolved_at === null && record.state !== "delivered");
    if (!open.length) continue;
    includedAttempts.add(attemptId);
    const signature = (record: CollectionFailureEvidence) => JSON.stringify([record.tenant_id, record.state, record.confirmed_failure, record.confirmation, record.failure_code, record.provider_message_id, record.resolved_at]);
    const conflict = records.some(record => signature(record) !== signature(records[0]));
    for (const record of open) {
      const key = groupKey(record.tenant_id, record.tenant_id);
      if (conflict) { add(key, record.tenant_id, "evidence_conflict", collectionContactCategoryLabels.evidence_conflict, attemptId); continue; }
      if (confirmedUnresolved(record)) {
        confirmedAttempts.add(attemptId); add(key, record.tenant_id, "confirmed_failure", reasonLabels[record.failure_code], attemptId);
      } else if (["pending", "sending", "accepted"].includes(record.state)) {
        add(key, record.tenant_id, "awaiting_delivery", record.state === "accepted" ? "Diterima penyedia, tetapi belum disahkan sampai kepada penyewa" : "Penghantaran sedang menunggu keputusan", attemptId);
      } else if (["rejected", "failed"].includes(record.state)) {
        add(key, record.tenant_id, "unconfirmed_rejection", caseReason(record.failure_code ?? "unknown"), attemptId);
      } else add(key, record.tenant_id, "delivery_unknown", collectionContactCategoryLabels.delivery_unknown, attemptId);
    }
  }
  const savedCases = new Map<string, CollectionContactCaseEvidence[]>();
  for (const record of contactCases) savedCases.set(record.case_id, [...(savedCases.get(record.case_id) ?? []), record]);
  for (const [caseId, records] of savedCases) {
    const signature = (record: CollectionContactCaseEvidence) => JSON.stringify([record.tenant_id, record.tenant_key, record.category, record.reason_code, record.resolved_at]);
    const conflict = records.some(record => signature(record) !== signature(records[0]));
    for (const record of records.filter(record => record.resolved_at === null)) {
      const category = conflict ? "evidence_conflict" : Object.hasOwn(collectionContactCategoryLabels, record.category)
        && record.category !== ("confirmed_failure" as string) ? record.category : "source_exception";
      add(groupKey(record.tenant_id, record.tenant_key), record.tenant_id, category,
        conflict ? collectionContactCategoryLabels.evidence_conflict : caseReason(record.reason_code), undefined, caseId);
    }
  }
  // A current blocker may prevent an attempt altogether. Retain it as a review
  // item, without claiming the provider tried or failed to deliver anything.
  for (const item of input.current_items) {
    const key = groupKey(item.tenant_id, item.key);
    if (!groups.has(key) && item.outstanding !== null && item.outstanding <= 0 && !item.exceptions.length) continue;
    const codes = new Set([...(item.delivery_blocks ?? []), ...item.exceptions]);
    if (!item.phone || !/^[1-9][0-9]{8,14}$/.test(item.phone) || item.phone_valid === false) codes.add("invalid_phone");
    if (item.recipient_source !== "tenant_portal_login") codes.add("login_recipient_unverified");
    if (item.whatsapp_ownership_verified === false) codes.add("whatsapp_ownership_unverified");
    if (item.policy?.consent === "opted_out") codes.add("opted_out");
    else if (item.policy?.consent && item.policy.consent !== "opted_in") codes.add("consent_missing");
    if (item.policy?.hold && item.policy.hold !== "none") codes.add("communication_hold");
    if (item.pending_verification) codes.add("pending_verification");
    if (!item.tenant_id) codes.add("unlinked_tenant");
    for (const code of codes) add(key, item.tenant_id, categoryForCode(code), caseReason(code));
  }
  const current = new Map<string, CollectionPreviewItem | null>();
  const invoiceOwners = new Map<string, Set<string>>();
  for (const item of input.current_items) {
    const key = groupKey(item.tenant_id, item.key);
    if (!groups.has(key)) continue;
    const prior = current.get(key);
    const conflict = current.has(key) && JSON.stringify(prior) !== JSON.stringify(item);
    if (conflict) add(key, item.tenant_id, "evidence_conflict", "Bukti semasa penyewa bercanggah — semak Portal Admin");
    current.set(key, conflict ? null : item);
    for (const invoice of item.invoices) {
      const owners = invoiceOwners.get(invoice.id) ?? new Set<string>();
      owners.add(key); invoiceOwners.set(invoice.id, owners);
    }
  }
  const sharedInvoices = new Set([...invoiceOwners].filter(([, owners]) => owners.size > 1).map(([id]) => id));
  const rows = [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => {
    const item = current.get(key) ?? null;
    return { item, group, key, balance: currentBalance(item, sharedInvoices) };
  });
  const unknownBalances = rows.filter(row => row.balance === null).length;
  const total = rows.reduce((sum, row) => sum + (row.balance ?? 0), 0);
  const auth = input.recipient_authorization;
  const managementVerified = auth?.verified === true && auth.approved_management_account === true
    && auth.active_company_membership === true && auth.rent_due_tracker_manage === true
    && !!auth.management_profile_id.trim() && auth.company_id === input.company_id && auth.recipient === COLLECTION_FAILURE_REPORT_RECIPIENT;
  const recipientVerified = managementVerified && auth.whatsapp_ownership_verified === true && auth.whatsapp_consent === "opted_in";
  const complete = input.all_history_loaded && input.daily_outcomes_complete;
  const alreadyReserved = input.daily_reservation === "reserved" || input.daily_reservation === "sent";
  const header = `DEKEZ MANAGEMENT\nLAPORAN SUSULAN PERINGATAN PEMBAYARAN WHATSAPP\nTarikh: ${input.report_date} (Malaysia)`;
  const generic = `${header}\n\nSemakan susulan tersedia melalui Portal Admin yang selamat. Maklumat penyewa tidak disertakan. Akses memerlukan kebenaran akaun pengurusan.\n${COLLECTION_FAILURE_REPORT_PORTAL}`;
  const actionList = rows.map(({ item, group, key, balance }) => {
    const locations = item ? [...new Set(item.invoices.map(invoice => `${label(invoice.property_code || invoice.property)} / ${label(invoice.room)}`))] : [];
    const phone = item?.recipient_source === "tenant_portal_login" && item.phone && /^[1-9][0-9]{8,14}$/.test(item.phone) ? item.phone : null;
    return {
      key, tenant_id: group.tenantId, name: label(item?.name), propertyRooms: locations,
      loginPhone: phone, verifiedCollectibleBalance: balance === null ? null : balance / 100,
      categories: [...group.categories].sort(), reasons: [...group.reasons].sort(),
      confirmedAttempts: group.confirmed.size, unresolvedAttempts: group.attempts.size,
      existingCaseIds: [...group.cases].sort(),
    };
  });
  const roster = actionList.map((row, index) => {
    return [
      `${index + 1}. Nama: ${row.name}${row.tenant_id === null ? " (rekod belum dipautkan)" : ""}`,
      `Hartanah/Bilik: ${row.propertyRooms.length ? row.propertyRooms.join("; ") : label(null)}`,
      `Telefon log masuk: ${label(row.loginPhone)}`,
      `Baki invois boleh dituntut yang disahkan: ${row.verifiedCollectibleBalance === null ? "Tidak dapat disahkan — semak pengecualian" : money(Math.round(row.verifiedCollectibleBalance * 100))}`,
      `Kategori: ${row.categories.map(category => collectionContactCategoryLabels[category]).join("; ")}`,
      `Sebab / tindakan semakan: ${row.reasons.join("; ")}`,
      `Percubaan belum selesai: ${row.unresolvedAttempts}; kegagalan disahkan: ${row.confirmedAttempts}`,
    ].join("\n");
  }).join("\n\n");
  const failureTenants = rows.filter(row => row.group.confirmed.size > 0).length;
  const followUpTenants = rows.filter(row => row.group.tenantId !== null).length;
  const unlinkedCases = rows.length - followUpTenants;
  const categories = (Object.keys(collectionContactCategoryLabels) as CollectionContactCategory[]).map(category => ({
    category, label: collectionContactCategoryLabels[category],
    groups: rows.filter(row => row.group.categories.has(category)).length,
    tenants: rows.filter(row => row.group.tenantId !== null && row.group.categories.has(category)).length,
  })).filter(category => category.groups > 0);
  const countLine = `Susulan belum selesai: ${followUpTenants} penyewa; ${unlinkedCases} rekod belum dipautkan.\nKegagalan disahkan belum selesai: ${failureTenants} penyewa; ${confirmedAttempts.size} percubaan unik.`;
  const full = [header, "Rosley, berikut ialah SEMUA kes hubungan peringatan pembayaran yang belum selesai dan memerlukan semakan; bukan semuanya kegagalan penghantaran yang disahkan.", countLine, "Termasuk semua rekod terdahulu yang masih belum selesai.",
    ...categories.map(category => `${category.label}: ${category.groups} kes.`),
    categories.length > 1 ? "Satu penyewa boleh berada dalam beberapa kategori; senarai dan jumlah baki dikira sekali sahaja bagi setiap penyewa." : "",
    `Jumlah baki invois boleh dituntut yang disahkan: ${unknownBalances || !Number.isSafeInteger(total) ? "Tidak tersedia sepenuhnya — semak Portal Admin" : money(total)}.`,
    unknownBalances ? `${unknownBalances} baki kes memerlukan semakan; nilai yang tidak diketahui bukan RM 0.00.` : "",
    "Status diterima, menunggu dan tidak pasti bukan kegagalan disahkan.",
    !input.daily_outcomes_complete ? "Sebahagian keputusan penghantaran hari ini masih menunggu pengesahan. Semua kes belum selesai kekal dalam senarai; draf dalam portal akan dikemas kini apabila keputusan baharu diterima, tanpa mesej WhatsApp kedua pada tarikh yang sama." : "", roster,
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
    failureTenants, confirmedUnresolvedAttempts: confirmedAttempts.size,
    followUpTenants, unlinkedCases, followUpGroups: rows.length, categories,
    unresolvedAttempts: includedAttempts.size, excludedAttempts: attempts.size - includedAttempts.size, unknownBalances,
    // Portal rendering still requires its existing authenticated company/module
    // gate. WhatsApp consent is not used to grant or remove portal permission.
    actionList: (managementVerified || input.portal_authorized === true) && input.all_history_loaded ? actionList : [],
    fullPortalReport: (managementVerified || input.portal_authorized === true) && input.all_history_loaded ? full : null,
    completeRosterRequiresPortal: oversized || !complete || !recipientVerified,
    readiness: !recipientVerified ? "recipient_unverified" : !complete ? "awaiting_complete_outcomes"
      : alreadyReserved ? "existing_daily_report_only" : input.daily_reservation === "unknown" ? "reservation_unverified" : "ready_for_review",
    updatedDraftOnly: alreadyReserved,
    createAdditionalDailyAlert: false as const,
    durableReservationImplemented: false as const,
    proposedReservationKey: `collection-failures:${input.company_id}:${input.report_date}:${COLLECTION_FAILURE_REPORT_RECIPIENT}`,
  };
}

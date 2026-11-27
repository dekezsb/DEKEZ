import type { SupabaseClient } from "@supabase/supabase-js";
import { allReportRows } from "@/lib/accounting/report-data";
import {
  journalEditability,
  type RegisterHistoryItem,
  type RegisterRow,
  type VoucherFormLine,
  type VoucherStatus,
  type VoucherType,
} from "@/lib/accounting/vouchers";

type VoucherRecord = {
  id: string; root_voucher_id: string; revision: number; voucher_type: VoucherType; voucher_number: string;
  voucher_date: string; party_name: string | null; property_id: string | null; payment_account_id: string | null;
  reference_number: string | null; description: string; total_amount: number | string; status: VoucherStatus;
  origin: string; journal_entry_id: string; change_reason: string | null; void_reason: string | null;
  voided_at: string | null; created_at: string;
};
type VoucherLineRecord = {
  id: string; voucher_id: string; line_no: number; account_id: string; property_id: string | null;
  description: string | null; debit: number | string; credit: number | string;
};
type BankVoucherRow = {
  id: string; bank_account_id: string; offset_account_id: string; property_id: string | null; transaction_date: string;
  amount: number | string; description: string; reference_number: string; voucher_revision: number;
  reversal_of_id: string | null; superseded_at: string | null; superseded_reason: string | null; created_at: string;
};

const num = (value: unknown) => {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
};
const unique = (values: Array<string | null | undefined>) => Array.from(new Set(values.filter((value): value is string => Boolean(value))));

export function splitBankDescription(description: string) {
  const index = description.indexOf(" · ");
  return index > 0
    ? { party: description.slice(0, index).trim(), detail: description.slice(index + 3).trim() }
    : { party: "", detail: description.trim() };
}

export const voucherSelect = "id, root_voucher_id, revision, voucher_type, voucher_number, voucher_date, party_name, property_id, payment_account_id, reference_number, description, total_amount, status, origin, journal_entry_id, change_reason, void_reason, voided_at, created_at";
export const bankVoucherSelect = "id, bank_account_id, offset_account_id, property_id, transaction_date, amount, description, reference_number, voucher_revision, reversal_of_id, superseded_at, superseded_reason, created_at";

/** Groups voucher revisions into one register row per voucher number (latest revision wins). */
export function voucherRegisterRows(vouchers: VoucherRecord[], lines: VoucherLineRecord[], aliases: Map<string, string>): RegisterRow[] {
  const linesByVoucher = new Map<string, VoucherLineRecord[]>();
  for (const line of lines) linesByVoucher.set(line.voucher_id, [...(linesByVoucher.get(line.voucher_id) ?? []), line]);
  const byRoot = new Map<string, VoucherRecord[]>();
  for (const voucher of vouchers) byRoot.set(voucher.root_voucher_id, [...(byRoot.get(voucher.root_voucher_id) ?? []), voucher]);
  return Array.from(byRoot.values()).map((revisions) => {
    revisions.sort((left, right) => left.revision - right.revision);
    const latest = revisions[revisions.length - 1];
    const history: RegisterHistoryItem[] = revisions.map((revision) => ({
      revision: revision.revision,
      status: revision.status,
      date: revision.voucher_date,
      amount: num(revision.total_amount),
      at: revision.created_at,
      reason: revision.revision > 1 ? revision.change_reason : null,
      label: revision.revision === 1 ? (revision.origin === "voucher" ? "Posted" : "Original journal") : `Edited (revision ${revision.revision})`,
    }));
    if (latest.status === "voided") {
      history.push({ revision: latest.revision, status: "voided", date: latest.voucher_date, amount: 0, at: latest.voided_at ?? latest.created_at, reason: latest.void_reason, label: "Voided (auto reversal posted)" });
    }
    const latestLines = linesByVoucher.get(latest.id) ?? [];
    return {
      key: `voucher:${latest.root_voucher_id}`,
      kind: "voucher" as const,
      id: latest.id,
      type: latest.voucher_type,
      number: latest.voucher_number,
      aliasNumber: aliases.get(latest.voucher_number) ?? null,
      revision: latest.revision,
      date: latest.voucher_date,
      party: latest.party_name ?? "",
      description: latest.description,
      reference: latest.reference_number,
      propertyIds: unique([latest.property_id, ...latestLines.map((line) => line.property_id)]),
      amount: num(latest.total_amount),
      status: latest.status,
      sourceLabel: latest.origin === "tenant_deposit_settlement" ? "Checkout deposit settlement" : latest.voucher_type === "JV" ? "Journal" : "Voucher",
      editable: latest.status === "posted",
      notEditableReason: latest.status === "voided" ? "Voided" : null,
      history,
    };
  });
}

/** Groups Bank Reconciliation payment-voucher rows by voucher number. */
export function bankVoucherRegisterRows(rows: BankVoucherRow[], aliases: Map<string, string>): RegisterRow[] {
  const byNumber = new Map<string, BankVoucherRow[]>();
  for (const row of rows) byNumber.set(row.reference_number, [...(byNumber.get(row.reference_number) ?? []), row]);
  return Array.from(byNumber.entries()).map(([number, group]) => {
    const originals = group.filter((row) => !row.reversal_of_id);
    const current = originals.filter((row) => !row.superseded_at);
    const revisions = Array.from(new Set(originals.map((row) => row.voucher_revision))).sort((a, b) => a - b);
    const latestRevision = revisions[revisions.length - 1] ?? 1;
    const latestRows = current.length ? current : originals.filter((row) => row.voucher_revision === latestRevision);
    const first = latestRows[0] ?? group[0];
    const history: RegisterHistoryItem[] = revisions.map((revision) => {
      const revisionRows = originals.filter((row) => row.voucher_revision === revision);
      const previous = originals.filter((row) => row.voucher_revision === revision - 1);
      return {
        revision,
        status: (revisionRows.some((row) => !row.superseded_at) ? "posted" : "amended") as VoucherStatus,
        date: revisionRows[0]?.transaction_date ?? first.transaction_date,
        amount: -revisionRows.reduce((total, row) => total + num(row.amount), 0),
        at: revisionRows[0]?.created_at ?? first.created_at,
        reason: revision > 1 ? previous[0]?.superseded_reason?.replace(/^edited - /, "") ?? null : null,
        label: revision === 1 ? "Recorded from bank reconciliation" : `Edited (revision ${revision})`,
      };
    });
    const voided = !current.length;
    if (voided) {
      const last = latestRows[0];
      history.push({ revision: latestRevision, status: "voided", date: first.transaction_date, amount: 0, at: last?.superseded_at ?? first.created_at, reason: last?.superseded_reason?.replace(/^voided - /, "") ?? null, label: "Voided (reversing rows posted, bank line re-opened)" });
      for (const item of history) if (item.revision === latestRevision && item.status !== "voided") item.status = "voided";
    }
    const { party } = splitBankDescription(first.description);
    return {
      key: `bank:${number}`,
      kind: "bank" as const,
      id: number,
      type: "PV" as const,
      number,
      aliasNumber: aliases.get(number) ?? null,
      revision: latestRevision,
      date: first.transaction_date,
      party: party || "Bank payment",
      description: latestRows.map((row) => splitBankDescription(row.description).detail).filter(Boolean).join("; "),
      reference: null,
      propertyIds: unique(latestRows.map((row) => row.property_id)),
      amount: -latestRows.reduce((total, row) => total + num(row.amount), 0),
      status: voided ? "voided" as const : "posted" as const,
      sourceLabel: "Bank reconciliation voucher",
      editable: !voided,
      notEditableReason: voided ? "Voided" : null,
      history,
    };
  });
}

export async function loadVoucherRegister(supabase: SupabaseClient, companyId: string) {
  const [vouchersResult, journalsResult, bankRowsResult, aliasesResult] = await Promise.all([
    allReportRows(supabase.from("accounting_vouchers").select(voucherSelect).eq("company_id", companyId)),
    allReportRows(supabase.from("accounting_journal_entries").select("id, entry_date, entry_number, source_type, reference_number, description, created_at")
      .eq("company_id", companyId).eq("status", "posted").in("source_type", ["manual_journal", "tenant_deposit_settlement"])),
    allReportRows(supabase.from("bank_manual_transactions").select(bankVoucherSelect).eq("company_id", companyId).like("reference_number", "PV%")),
    allReportRows(supabase.from("document_number_aliases").select("legacy_number, new_number").in("source_table", ["accounting_journal_entries", "bank_payment_voucher"])),
  ]);
  const failed = [vouchersResult, journalsResult, bankRowsResult, aliasesResult].find((result) => result.error);
  if (failed) throw new Error("Unable to load the voucher register. Please retry; a partial list is not shown.");
  const vouchers = vouchersResult.data as VoucherRecord[];
  const voucherIds = vouchers.map((voucher) => voucher.id);
  const linesResult = voucherIds.length
    ? await allReportRows(supabase.from("accounting_voucher_lines").select("id, voucher_id, line_no, account_id, property_id, description, debit, credit").in("voucher_id", voucherIds))
    : { data: [], error: null };
  if (linesResult.error) throw new Error("Unable to load voucher lines.");
  const aliases = new Map((aliasesResult.data as Array<{ legacy_number: string; new_number: string }>).map((alias) => [alias.legacy_number, alias.new_number]));
  const adoptedJournalIds = new Set(vouchers.map((voucher) => voucher.journal_entry_id));
  const plainJournals = (journalsResult.data as Array<{ id: string; entry_date: string; entry_number: string; source_type: string; reference_number: string | null; description: string; created_at: string }>)
    .filter((entry) => !adoptedJournalIds.has(entry.id));
  const journalLinesResult = plainJournals.length
    ? await allReportRows(supabase.from("accounting_journal_lines").select("id, journal_entry_id, property_id, debit").in("journal_entry_id", plainJournals.map((entry) => entry.id)))
    : { data: [], error: null };
  if (journalLinesResult.error) throw new Error("Unable to load journal lines.");
  const journalLines = journalLinesResult.data as Array<{ journal_entry_id: string; property_id: string | null; debit: number | string }>;
  const journalRows: RegisterRow[] = plainJournals.map((entry) => {
    const entryLines = journalLines.filter((line) => line.journal_entry_id === entry.id);
    const editability = journalEditability(entry.source_type);
    return {
      key: `journal:${entry.id}`,
      kind: "journal",
      id: entry.id,
      type: "JV",
      number: entry.entry_number,
      aliasNumber: aliases.get(entry.entry_number) ?? null,
      revision: 1,
      date: entry.entry_date,
      party: "",
      description: entry.description,
      reference: entry.reference_number,
      propertyIds: unique(entryLines.map((line) => line.property_id)),
      amount: entryLines.reduce((total, line) => total + num(line.debit), 0),
      status: "posted",
      sourceLabel: entry.source_type === "tenant_deposit_settlement" ? "Checkout deposit settlement" : "Journal",
      editable: editability.editable,
      notEditableReason: editability.reason,
      history: [{ revision: 1, status: "posted", date: entry.entry_date, amount: entryLines.reduce((total, line) => total + num(line.debit), 0), at: entry.created_at, reason: null, label: "Posted" }],
    };
  });
  return [
    ...voucherRegisterRows(vouchers, linesResult.data as VoucherLineRecord[], aliases),
    ...journalRows,
    ...bankVoucherRegisterRows(bankRowsResult.data as BankVoucherRow[], aliases),
  ].sort((left, right) => right.date.localeCompare(left.date) || right.number.localeCompare(left.number));
}

export type VoucherEditModel = {
  kind: "voucher" | "journal" | "bank";
  id: string;
  type: VoucherType;
  number: string;
  revision: number;
  date: string;
  party: string;
  propertyId: string;
  paymentAccountId: string;
  bankAccountId: string | null;
  reference: string;
  description: string;
  lines: VoucherFormLine[];
  total: number;
  status: VoucherStatus;
  sourceLabel: string;
  lockedTotal: boolean;
  journalEntryId: string | null;
};

export async function loadVoucherForEdit(supabase: SupabaseClient, companyId: string, kind: string, id: string): Promise<VoucherEditModel | null> {
  if (!id) return null;
  if (kind === "bank") {
    const { data, error } = await supabase.from("bank_manual_transactions").select(bankVoucherSelect).eq("company_id", companyId).eq("reference_number", id);
    if (error || !data?.length) return null;
    const rows = data as BankVoucherRow[];
    const current = rows.filter((row) => !row.reversal_of_id && !row.superseded_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const shown = current.length ? current : rows.filter((row) => !row.reversal_of_id);
    const first = shown[0];
    return {
      kind: "bank", id, type: "PV", number: id,
      revision: Math.max(...rows.map((row) => row.voucher_revision ?? 1)),
      date: first.transaction_date,
      party: splitBankDescription(first.description).party,
      propertyId: "", paymentAccountId: "", bankAccountId: first.bank_account_id, reference: "",
      description: "",
      lines: shown.map((row) => ({ accountId: row.offset_account_id, propertyId: row.property_id ?? "office", description: splitBankDescription(row.description).detail, amount: String(-num(row.amount)) })),
      total: -shown.reduce((total, row) => total + num(row.amount), 0),
      status: current.length ? "posted" : "voided",
      sourceLabel: "Bank reconciliation voucher",
      lockedTotal: true,
      journalEntryId: null,
    };
  }
  let voucher: VoucherRecord | null = null;
  if (kind === "journal") {
    const { data } = await supabase.from("accounting_vouchers").select(voucherSelect).eq("company_id", companyId).eq("journal_entry_id", id).maybeSingle();
    voucher = (data as VoucherRecord | null) ?? null;
    if (!voucher) {
      const { data: entry } = await supabase.from("accounting_journal_entries").select("id, entry_date, entry_number, source_type, reference_number, description, status").eq("company_id", companyId).eq("id", id).maybeSingle();
      if (!entry || entry.status !== "posted") return null;
      const { data: lines } = await supabase.from("accounting_journal_lines").select("id, account_id, property_id, description, debit, credit, created_at").eq("journal_entry_id", id).order("created_at");
      const total = (lines ?? []).reduce((sum, line) => sum + num(line.debit), 0);
      return {
        kind: "journal", id, type: "JV", number: entry.entry_number, revision: 1, date: entry.entry_date, party: "",
        propertyId: "", paymentAccountId: "", bankAccountId: null, reference: entry.reference_number ?? "", description: entry.description,
        lines: (lines ?? []).map((line) => ({ accountId: line.account_id, propertyId: line.property_id ?? "", description: line.description ?? "", debit: num(line.debit) ? String(num(line.debit)) : "", credit: num(line.credit) ? String(num(line.credit)) : "" })),
        total, status: "posted",
        sourceLabel: entry.source_type === "tenant_deposit_settlement" ? "Checkout deposit settlement" : "Journal",
        lockedTotal: false, journalEntryId: entry.id,
      };
    }
  } else {
    const { data } = await supabase.from("accounting_vouchers").select(voucherSelect).eq("company_id", companyId).eq("id", id).maybeSingle();
    voucher = (data as VoucherRecord | null) ?? null;
  }
  if (!voucher) return null;
  // Always edit the latest revision of the chain.
  const { data: chain } = await supabase.from("accounting_vouchers").select(voucherSelect).eq("root_voucher_id", voucher.root_voucher_id).order("revision", { ascending: false }).limit(1);
  const latest = ((chain ?? [])[0] as VoucherRecord | undefined) ?? voucher;
  const { data: lines } = await supabase.from("accounting_voucher_lines").select("id, voucher_id, line_no, account_id, property_id, description, debit, credit").eq("voucher_id", latest.id).order("line_no");
  const typed = (lines ?? []) as VoucherLineRecord[];
  return {
    kind: "voucher", id: latest.id, type: latest.voucher_type, number: latest.voucher_number, revision: latest.revision,
    date: latest.voucher_date, party: latest.party_name ?? "", propertyId: latest.property_id ?? "",
    paymentAccountId: latest.payment_account_id ?? "", bankAccountId: null, reference: latest.reference_number ?? "",
    description: latest.description,
    lines: typed.map((line) => latest.voucher_type === "JV"
      ? { accountId: line.account_id, propertyId: line.property_id ?? "", description: line.description ?? "", debit: num(line.debit) ? String(num(line.debit)) : "", credit: num(line.credit) ? String(num(line.credit)) : "" }
      : { accountId: line.account_id, propertyId: line.property_id ?? "", description: line.description ?? "", amount: String(num(line.debit) || num(line.credit)) }),
    total: num(latest.total_amount), status: latest.status,
    sourceLabel: latest.origin === "tenant_deposit_settlement" ? "Checkout deposit settlement" : latest.voucher_type === "JV" ? "Journal" : "Voucher",
    lockedTotal: false, journalEntryId: latest.journal_entry_id,
  };
}

export async function loadVoucherAudit(supabase: SupabaseClient, companyId: string, model: VoucherEditModel) {
  let query = supabase.from("accounting_audit_logs").select("id, action, reason, performed_by, performed_at, before_data, after_data").eq("company_id", companyId);
  if (model.kind === "bank") query = query.in("entity_type", ["bank_payment_voucher", "bank_statement_line"]).contains("after_data", { voucher_number: model.number });
  else {
    const { data: chain } = await supabase.from("accounting_vouchers").select("root_voucher_id").eq("id", model.id).maybeSingle();
    const ids = unique([model.id, chain?.root_voucher_id]);
    query = query.eq("entity_type", "accounting_voucher").in("entity_id", ids);
  }
  const { data } = await query.order("performed_at", { ascending: false }).limit(50);
  const userIds = unique((data ?? []).map((row) => row.performed_by));
  const { data: people } = userIds.length ? await supabase.from("profiles").select("id, full_name").in("id", userIds) : { data: [] };
  const names = new Map((people ?? []).map((person) => [person.id, person.full_name ?? "User"]));
  return (data ?? []).map((row) => ({ ...row, performedByName: names.get(row.performed_by) ?? "User" }));
}

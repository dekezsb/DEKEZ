"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { voucherErrorCode, voucherLinesPayload, type VoucherFormLine, type VoucherType } from "@/lib/accounting/vouchers";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function voucherPath(path: string, params: Record<string, string>) {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

async function voucherContext() {
  await requireRole(["super_admin", "owner", "admin"], { module: "reports", level: "manage" });
  const [user, company] = await Promise.all([getCurrentUser(), getFirstCompany()]);
  if (!user || !company) redirect(voucherPath("/reports/vouchers", { error: "voucher_not_allowed" }));
  return { user, company, supabase: createAdminClient() };
}

function parseLines(formData: FormData): VoucherFormLine[] {
  try {
    const parsed = JSON.parse(text(formData, "linesJson"));
    return Array.isArray(parsed) ? parsed.slice(0, 101).map((line) => ({
      accountId: String(line?.accountId ?? ""),
      propertyId: String(line?.propertyId ?? ""),
      description: String(line?.description ?? "").slice(0, 300),
      amount: line?.amount == null ? undefined : String(line.amount),
      debit: line?.debit == null ? undefined : String(line.debit),
      credit: line?.credit == null ? undefined : String(line.credit),
    })) : [];
  } catch {
    return [];
  }
}

function voucherType(value: string): VoucherType | null {
  return value === "PV" || value === "RV" || value === "JV" ? value : null;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : "";
}

function finish(error: { message?: string; code?: string } | null, failPath: string, failParams: Record<string, string>, label: string) {
  if (!error) return;
  console.error(`[accounting] ${label} rejected`, { code: error.code, message: error.message });
  redirect(voucherPath(failPath, { ...failParams, error: voucherErrorCode(error.message) }));
}

/** New PV / RV / JV. */
export async function postVoucher(formData: FormData) {
  const { user, company, supabase } = await voucherContext();
  const type = voucherType(text(formData, "voucherType"));
  const date = validDate(text(formData, "voucherDate"));
  const back = { new: type ?? "PV" };
  if (!type || !date) redirect(voucherPath("/reports/vouchers", { ...back, error: "voucher_details" }));
  const payload = voucherLinesPayload(type, parseLines(formData));
  if ("error" in payload) redirect(voucherPath("/reports/vouchers", { ...back, error: payload.error ?? "voucher_details" }));
  const { data, error } = await supabase.rpc("post_accounting_voucher", {
    p_company: company.id, p_actor: user.id, p_type: type, p_date: date,
    p_party: text(formData, "party") || null, p_property: text(formData, "propertyId") || null,
    p_payment_account: type === "JV" ? null : text(formData, "paymentAccountId") || null,
    p_reference: text(formData, "reference") || null, p_description: text(formData, "description"),
    p_lines: payload.lines,
  });
  finish(error, "/reports/vouchers", back, "voucher post");
  revalidatePath("/reports");
  revalidatePath("/reports/vouchers");
  redirect(voucherPath("/reports/vouchers", { saved: String(data) }));
}

/** Edit = automatic reversal of the current revision + corrected repost. */
export async function amendVoucher(formData: FormData) {
  const { user, company, supabase } = await voucherContext();
  const kind = text(formData, "kind");
  const id = text(formData, "id");
  const reason = text(formData, "reason");
  const back = { kind, id };
  if (reason.length < 5) redirect(voucherPath("/reports/vouchers/edit", { ...back, error: "voucher_reason_required" }));
  if (kind === "bank") {
    const lines = parseLines(formData).map((line) => ({ accountId: line.accountId, propertyId: line.propertyId || "office", description: line.description, amount: line.amount ?? "" }));
    const check = voucherLinesPayload("PV", lines.map((line) => ({ ...line, propertyId: "" })));
    if ("error" in check) redirect(voucherPath("/reports/vouchers/edit", { ...back, error: check.error ?? "voucher_details" }));
    const cleaned = lines.map((line, index) => ({ ...line, amount: (check.lines[index] as { amount: string }).amount }));
    const { error } = await supabase.rpc("amend_bank_payment_voucher", {
      p_company: company.id, p_actor: user.id, p_number: id, p_payee: text(formData, "party"), p_lines: cleaned, p_reason: reason,
    });
    finish(error, "/reports/vouchers/edit", back, "bank voucher edit");
    revalidatePath("/reports");
    revalidatePath("/reports/vouchers");
    redirect(voucherPath("/reports/vouchers", { amended: id }));
  }
  const type = voucherType(text(formData, "voucherType"));
  const date = validDate(text(formData, "voucherDate"));
  if (!type || !date) redirect(voucherPath("/reports/vouchers/edit", { ...back, error: "voucher_details" }));
  const payload = voucherLinesPayload(type, parseLines(formData));
  if ("error" in payload) redirect(voucherPath("/reports/vouchers/edit", { ...back, error: payload.error ?? "voucher_details" }));
  const common = {
    p_company: company.id, p_actor: user.id, p_date: date,
    p_reference: text(formData, "reference") || null, p_description: text(formData, "description"),
    p_lines: payload.lines, p_reason: reason,
  };
  const { data, error } = kind === "journal"
    ? await supabase.rpc("amend_journal_entry", { ...common, p_entry: id })
    : await supabase.rpc("amend_accounting_voucher", {
      ...common, p_voucher: id, p_party: text(formData, "party") || null, p_property: text(formData, "propertyId") || null,
      p_payment_account: type === "JV" ? null : text(formData, "paymentAccountId") || null,
    });
  finish(error, "/reports/vouchers/edit", back, "voucher edit");
  revalidatePath("/reports");
  revalidatePath("/reports/vouchers");
  redirect(voucherPath("/reports/vouchers", { amended: String(data) }));
}

/** Void (delete) = automatic reversal + reason. Nothing is physically deleted. */
export async function voidVoucher(formData: FormData) {
  const { user, company, supabase } = await voucherContext();
  const kind = text(formData, "kind");
  const id = text(formData, "id");
  const reason = text(formData, "reason");
  const back = { kind, id };
  if (reason.length < 5) redirect(voucherPath("/reports/vouchers/edit", { ...back, error: "voucher_reason_required" }));
  const base = { p_company: company.id, p_actor: user.id, p_reason: reason };
  const { error } = kind === "bank"
    ? await supabase.rpc("void_bank_payment_voucher", { ...base, p_number: id })
    : kind === "journal"
      ? await supabase.rpc("void_journal_entry", { ...base, p_entry: id })
      : await supabase.rpc("void_accounting_voucher", { ...base, p_voucher: id });
  finish(error, "/reports/vouchers/edit", back, "voucher void");
  revalidatePath("/reports");
  revalidatePath("/reports/vouchers");
  redirect(voucherPath("/reports/vouchers", { voided: id }));
}

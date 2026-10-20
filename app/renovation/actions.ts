"use server";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { renovationContext } from "@/lib/renovation/server";
import { requireRole } from "@/lib/auth/session";
import { renovationWorkflowReturnTo } from "@/lib/renovation/model";
import { renovationPaymentData } from "@/lib/renovation/payments";
import { renovationBulkCandidates } from "@/lib/renovation/reconciliation";
import { validateTranslationReview } from '@/lib/renovation/saved-translations';
import type { RenovationDocument } from '@/lib/renovation/model';

export async function savePdfTranslations(form: FormData): Promise<RenovationActionState> {
  const { db, company, user } = await renovationContext(true);
  const id = String(form.get('id') ?? ''), language = String(form.get('language') ?? '');
  const version = Number(form.get('version')), payload = String(form.get('review') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['ms','zh'].includes(language) || !Number.isSafeInteger(version) || version < 1 || payload.length > 250000 || form.get('reviewed') !== 'yes') return { error: 'Review the wording and select Malay or Chinese before saving.' };
  const { data: document, error: readError } = await db.from('renovation_documents').select('*').eq('company_id', company.id).eq('id', id).eq('version', version).maybeSingle();
  if (readError || !document) return { error: 'This document changed. Refresh before saving translations.' };
  let review;
  try { review = validateTranslationReview(document as RenovationDocument, JSON.parse(payload)); }
  catch (error) { return { error: error instanceof Error ? error.message : 'Invalid translation wording.' }; }
  // Append-only export metadata. No document, payment, receipt, journal or amount is updated.
  const { error } = await db.from('accounting_audit_logs').insert({ company_id: company.id, entity_type: 'renovation_translation', entity_id: id,
    action: 'export_translation_saved', after_data: { document_version: version, language, review }, performed_by: user.id,
    reason: 'Reviewed PDF translation saved separately; original document and financial records unchanged.' });
  if (error) return { error: 'Could not save translations. Your original document is unchanged.' };
  revalidatePath(`/renovation/${id}`);
  return { success: 'Translations saved for future downloads. Original document and amounts unchanged.' };
}

export type RenovationActionState = { error?: string; success?: string };
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
function message(error: { message: string } | null) {
  const value = error?.message ?? "";
  if (/tax_account_required/.test(value)) return "Select an active tax liability account when applying tax.";
  if (/below_received/.test(value)) return "The corrected total cannot be less than payments already received. No payment history has been changed.";
  if (/customer_has_payments/.test(value)) return "Existing receipts must remain attached to this client. This invoice cannot be voided or reassigned while it has payments.";
  if (/issued_date_fixed/.test(value)) return "The original issue date is preserved. Use the correction posting date for this adjustment.";
  if (/correction_reason/.test(value)) return "Enter a correction reason of at least 10 characters and an adjustment date.";
  if (/changed_or_issued/.test(value)) return "This document changed or was issued. Refresh before editing again.";
  if (/period_locked/.test(value)) return "That accounting period is locked. Choose an open invoice date.";
  if (/income_account_required/.test(value)) return "An active Renovation Service Income account (4050) is required. Ask your accountant to check it.";
  if (/invalid_stages/.test(value)) return "Payment-stage percentages must be positive and total exactly 100%.";
  if (/approval_required/.test(value)) return "Enter the client's name, approval evidence, invoice date and due date.";
  if (/overpayment/.test(value)) return "This payment exceeds the remaining renovation invoice balance. Check other verified payments first.";
  if (/already_recorded|duplicate key/.test(value)) return "This payment proof or bank reference is already recorded. Check the existing payment instead of submitting it again.";
  if (/match_exhausted|bank_line_invalid|wrong_bank|verified_payment_required/.test(value)) return "The selected bank line or verified payment is no longer available, or belongs to a different bank account. Refresh and check again.";
  if (/invalid_lines|invalid_total|renovation_invalid|check constraint|not-null/.test(value)) return "Check the client, project, dates, quantities, prices and payment stages. The total must be positive.";
  return "Could not save. No partial invoice or accounting entry was committed. Please retry or ask your administrator to check the setup.";
}
export async function saveDraft(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  const { db, company, user } = await renovationContext(true);
  let payload: unknown;
  try { payload = JSON.parse(text(form, "payload")); } catch { return { error: "Invalid document. Please refresh and try again." }; }
  const correcting = text(form, "correction") === "yes";
  if (correcting && text(form,"confirm") !== "yes") return {error:"Confirm the controlled correction before saving."};
  const { data, error } = await db.rpc(correcting ? "correct_renovation_invoice" : "save_renovation_draft", { p_company: company.id, p_actor: user.id,
    p_id: text(form, "id"), p_version: Number(text(form, "version")), p_data: payload,
    ...(correcting ? {p_reason:text(form,"reason"),p_posting_date:text(form,"posting_date")} : {}) });
  if (error) return { error: message(error) };
  revalidatePath("/renovation");
  revalidatePath(`/renovation/${data}`);
  if (correcting) revalidatePath("/reports");
  redirect(`/renovation/${data}`);
}
export async function issueDocument(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  const { db, company, user } = await renovationContext(true);
  const approving = text(form, "approve") === "yes";
  if (text(form, "confirm") !== "yes") return { error: "Please confirm the action before continuing." };
  const { data, error } = await db.rpc("issue_renovation_document", {
    p_company: company.id, p_actor: user.id, p_id: text(form, "id"), p_version: Number(text(form, "version")),
    p_approval_name: approving ? text(form, "approval_name") : null,
    p_approval_evidence: approving ? text(form, "approval_evidence") : null,
    p_invoice_date: approving ? text(form, "invoice_date") : null,
    p_due_date: approving ? text(form, "due_date") : null,
  });
  if (error) return { error: message(error) };
  revalidatePath("/renovation"); revalidatePath(`/renovation/${text(form, "id")}`); revalidatePath("/reports");
  redirect(`/renovation/${data}`);
}
export async function saveClient(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  const { db, company } = await renovationContext(true);
  const name = text(form, "name"), phone = text(form, "phone"), email = text(form, "email"), address = text(form, "address");
  if (!name || name.length > 200 || phone.length > 50 || email.length > 254 || address.length > 2000) return { error: "Check the client details." };
  const { error } = await db.from("renovation_clients").insert({ id: text(form, "id"), company_id: company.id, name, phone, email, address });
  if (error && error.code !== "23505") return { error: "Could not save this client." };
  revalidatePath("/renovation"); redirect("/renovation/new");
}
export async function saveCatalogueItem(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  const { db, company, user } = await renovationContext(true);
  const description = text(form, "description"), unit = text(form, "unit"), rate = Number(text(form, "rate"));
  if (!description || description.length > 1000 || !unit || unit.length > 30 || !Number.isFinite(rate) || rate < 0 || rate >= 10000000 || Math.abs(rate * 100 - Math.round(rate * 100)) > 0.000001) return { error: "Enter a description, unit and valid price (up to two decimal places)." };
  const version=Number(text(form,"version")||0);
  if(version>0 && text(form,"confirm_update")!=="yes") return {error:"Confirm that you want to update this master item."};
  const translations={en:description,ms:text(form,"description_ms"),zh:text(form,"description_zh")};
  const { error } = await db.rpc("save_renovation_catalogue",{p_company:company.id,p_actor:user.id,p_id:text(form,"id")||randomUUID(),p_version:version,
    p_data:{description,unit,rate,item_code:text(form,"item_code"),category:text(form,"category"),cost_price:text(form,"cost_price")||null,active:text(form,"active")!=="false",translations}});
  if (error) return { error: /duplicate key/.test(error.message)?"That item code or description/unit already exists. Open the existing item to update it explicitly.":message(error) };
  revalidatePath("/renovation"); revalidatePath("/renovation/items"); revalidatePath("/renovation/new");
  return {success:"Item library saved. Existing document descriptions and prices are unchanged."};
}

export async function closeRenovationDocument(_previous:RenovationActionState,form:FormData):Promise<RenovationActionState> {
  const {db,company,user}=await renovationContext(true);
  if(text(form,"confirm")!=="yes")return {error:"Confirm this action first."};
  const {data,error}=await db.rpc("close_renovation_document",{p_company:company.id,p_actor:user.id,p_id:text(form,"id"),p_version:Number(text(form,"version")),p_reason:text(form,"reason"),p_date:text(form,"posting_date")});
  if(error)return {error:message(error)};
  revalidatePath("/renovation");revalidatePath(`/renovation/${data}`);revalidatePath("/reports");redirect(`/renovation/${data}`);
}
export async function submitRenovationPayment(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  const { db, company, user } = await renovationContext(true);
  const invoiceId = text(form, "invoice_id"), bankId = text(form, "bank_account_id"), reference = text(form, "reference_number");
  const amount = Number(text(form, "amount")), date = text(form, "payment_date"), file = form.get("proof");
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (reference && (reference.length < 3 || reference.length > 120 || !/[a-z0-9]{3}/i.test(reference.replace(/[^a-z0-9]/gi, ""))))) return { error: "Enter a valid amount, payment date and bank reference." };
  if (!(file instanceof File) || !file.size || file.size > 3 * 1024 * 1024) return { error: "Attach a JPG, PNG or PDF bank-in slip, maximum 3 MB." };
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = bytes.subarray(0, 5).toString() === "%PDF-" ? "application/pdf" : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : null;
  if (!mime) return { error: "That file is not a supported JPG, PNG or PDF." };
  const [{ data: invoice }, { data: bank }] = await Promise.all([
    db.from("renovation_documents").select("id,total").eq("id", invoiceId).eq("company_id", company.id).eq("kind", "invoice").eq("status", "issued").maybeSingle(),
    db.from("bank_accounts").select("id").eq("id", bankId).eq("company_id", company.id).maybeSingle(),
  ]);
  if (!invoice || !bank || amount > Number(invoice.total)) return { error: "Check the issued invoice, receiving bank account and amount." };
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { data: duplicate, error: checkError } = await db.from("renovation_payment_submissions").select("id").eq("company_id", company.id).eq("proof_sha256", hash).neq("status", "rejected").limit(1);
  if (checkError) return { error: "Could not check for duplicate proof. Nothing has been submitted." };
  if (duplicate?.length) return { error: "This slip has already been submitted. Check the existing payment." };
  const id = randomUUID(), path = `${company.id}/${invoiceId}/${id}.${mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg"}`;
  const upload = await db.storage.from("renovation-proofs").upload(path, bytes, { contentType: mime, upsert: false });
  if (upload.error) return { error: "Could not upload the slip. No payment was recorded." };
  const { error } = await db.rpc("record_admin_renovation_payment", {p_company:company.id,p_actor:user.id,p_id:id,p_invoice:invoiceId,p_bank:bankId,p_amount:amount,p_date:date,p_reference:reference,p_path:path,p_hash:hash});
  // Retain a failed-upload orphan rather than delete proof after an ambiguous network response.
  if (error) return { error: message(error) };
  revalidatePath("/renovation"); revalidatePath(`/renovation/${invoiceId}`); revalidatePath("/verification"); revalidatePath("/payment-verification"); revalidatePath("/reports");
  redirect(`/renovation/${invoiceId}`);
}
export async function verifyRenovationPayment(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  await requireRole(["super_admin", "admin"], { module: "verification", level: "manage" });
  const { db, company, user } = await renovationContext(true);
  if (!["verify", "reject"].includes(text(form, "decision"))) return { error: "Choose Verify or Reject." };
  const accept = text(form, "decision") === "verify";
  if (accept && text(form, "confirm") !== "yes") return { error: "Confirm that you have checked the bank-in slip and amount received." };
  const { data: payment, error: readError } = await db.from("renovation_payment_submissions").select("invoice_id,admin_uploaded").eq("id", text(form, "payment_id")).eq("company_id", company.id).maybeSingle();
  if (readError || !payment) return { error: "This renovation payment could not be loaded. Refresh and try again." };
  if (payment.admin_uploaded) return {error:"Admin-uploaded receipts are already recorded. No verification is required."};
  const { error } = await db.rpc("verify_renovation_payment", { p_company: company.id, p_actor: user.id, p_id: text(form, "payment_id"), p_accept: accept, p_reason: text(form, "reason") || null });
  if (error) return { error: message(error) };
  revalidatePath("/renovation"); revalidatePath("/reports"); revalidatePath(`/renovation/${payment.invoice_id}`); revalidatePath("/verification"); revalidatePath("/payment-verification");
  redirect(renovationWorkflowReturnTo(text(form, "return_to"), "verification"));
}

export async function saveRenovationReference(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  const {db,company,user}=await renovationContext(true);
  const {data:payment,error:lookup}=await db.from("renovation_payment_submissions").select("invoice_id").eq("id",text(form,"payment_id")).eq("company_id",company.id).maybeSingle();
  if (lookup || !payment) return {error:"Payment not found."};
  const {error}=await db.rpc("save_renovation_payment_reference",{p_company:company.id,p_actor:user.id,p_id:text(form,"payment_id"),p_reference:text(form,"reference")});
  if(error) return {error:message(error)};
  revalidatePath(`/renovation/${payment.invoice_id}`);revalidatePath("/reports");
  return {};
}

export async function bulkReconcileRenovation(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  const {db,company,user}=await renovationContext(true);
  const statements=text(form,"statements").split(",").filter(s=>/^[0-9a-f-]{36}$/i.test(s));
  if(!statements.length || statements.length>100) return {error:"Select an active bank statement first."};
  const data=await renovationPaymentData(undefined,statements);
  const requested=new Set(text(form,"pairs").split(","));
  const candidates=renovationBulkCandidates(data.payments,data.lines).filter(c=>requested.has(`${c.transactionId}:${c.lineId}`));
  for(const candidate of candidates) {
    const {error}=await db.rpc("match_renovation_payment_by_reference",{p_company:company.id,p_actor:user.id,p_transaction:candidate.transactionId,p_line:candidate.lineId});
    if(error) {revalidatePath("/reports");return {error:"Matching stopped because a balance or reference changed. Completed matches are retained; refresh before retrying."};}
  }
  revalidatePath("/reports");revalidatePath("/renovation");
  redirect(renovationWorkflowReturnTo(text(form,"return_to"),"bank"));
}
export async function matchRenovationPayment(_previous: RenovationActionState, form: FormData): Promise<RenovationActionState> {
  const { db, company, user } = await renovationContext(true);
  const { data: payment, error: readError } = await db.from("renovation_payment_submissions").select("invoice_id").eq("bank_transaction_id", text(form, "transaction_id")).eq("company_id", company.id).eq("status", "verified").maybeSingle();
  if (readError || !payment) return { error: "A verified renovation receipt is required. Refresh and check again." };
  const { error } = await db.rpc("match_renovation_payment", { p_company: company.id, p_actor: user.id, p_transaction: text(form, "transaction_id"), p_line: text(form, "line_id") });
  if (error) return { error: message(error) };
  revalidatePath("/renovation"); revalidatePath("/reports"); revalidatePath(`/renovation/${payment.invoice_id}`); revalidatePath("/verification"); revalidatePath("/payment-verification");
  redirect(renovationWorkflowReturnTo(text(form, "return_to"), "bank"));
}

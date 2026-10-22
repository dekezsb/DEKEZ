"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => text(form, key) || null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fields(form: FormData) {
  return {
    expense_date: text(form, "expenseDate"), amount: Number(text(form, "amount")),
    tax_amount: Number(text(form, "taxAmount") || 0), category_id: optional(form, "categoryId"),
    property_id: optional(form, "propertyId"), unit_id: optional(form, "unitId"), room_id: optional(form, "roomId"),
    maintenance_ticket_id: optional(form, "maintenanceTicketId"), claim_id: optional(form, "claimId"),
    paid_by: optional(form, "paidBy"), funding_source: text(form, "fundingSource"),
    payment_method: text(form, "paymentMethod") || "cash", charge_to: text(form, "chargeTo") || "company",
    supplier: optional(form, "supplier"), description: optional(form, "description"),
    receipt_number: optional(form, "receiptNumber"), tax_claimable: text(form, "taxClaimable") === "on",
  };
}
function refresh() {
  for (const path of ["/expenses", "/reports", "/dashboard", "/claims"]) revalidatePath(path);
}
export async function submitExpenseBill(form: FormData) {
  await requireRole(["super_admin", "owner", "admin", "technician", "maintenance_staff", "cleaning_staff"], { module: "expenses", level: "manage" });
  const [user, company] = await Promise.all([getCurrentUser(), getFirstCompany()]);
  const id = text(form, "submissionId"), bill = fields(form), receipt = form.get("receipt");
  if (!user || !company || !uuid.test(id) || !(receipt instanceof File) || !receipt.size || receipt.size > 3 * 1024 * 1024
    || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(receipt.type)
    || !/^\d{4}-\d{2}-\d{2}$/.test(bill.expense_date) || !Number.isFinite(bill.amount) || bill.amount <= 0
    || (bill.funding_source === "staff_personal" && !bill.paid_by)) redirect("/expenses?error=missing");
  const db = createAdminClient();
  const { data: existing } = await db.from("expenses").select("id").eq("id", id).eq("uploaded_by", user.id).eq("company_id", company.id).maybeSingle();
  if (existing) redirect("/expenses?created=expense");
  const path = `${user.id}/${id}/${crypto.randomUUID()}-${receipt.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const upload = await db.storage.from("expense-receipts").upload(path, Buffer.from(await receipt.arrayBuffer()), { contentType: receipt.type, upsert: false });
  if (upload.error) redirect("/expenses?error=upload");
  const { error } = await db.rpc("submit_expense_bill", { p_id: id, p_company: company.id, p_actor: user.id, p_bill: bill,
    p_receipt: { file_path: path, file_name: receipt.name, content_type: receipt.type } });
  if (error) {
    // Only the unattached file from this failed request is removed; no financial record is deleted.
    await db.storage.from("expense-receipts").remove([path]);
    redirect("/expenses?error=create");
  }
  refresh(); redirect("/expenses?created=expense");
}
export async function verifyExpenseBill(form: FormData) {
  await requireRole(["super_admin", "owner", "admin"], { module: "expenses", level: "manage" });
  const user = await getCurrentUser(), id = text(form, "expenseId"), decision = text(form, "decision");
  if (!user || !uuid.test(id) || !["verified", "rejected"].includes(decision)) redirect("/expenses?error=review_missing");
  if (decision === "verified" && (!text(form, "categoryId") || Number(text(form, "amount")) <= 0)) redirect("/expenses?error=review_category");
  const { error } = await createAdminClient().rpc("review_expense_bill", {
    p_id: id, p_actor: user.id, p_version: text(form, "version"), p_decision: decision,
    p_bill: fields(form), p_reason: text(form, "rejectionReason"),
  });
  if (error) redirect("/expenses?error=review");
  refresh(); redirect("/expenses?reviewed=1");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

const expenseRoles = [
  "super_admin",
  "owner",
  "admin",
  "technician",
  "maintenance_staff",
  "cleaning_staff",
] as const;

export async function createExpenseCategory(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"], {
    module: "expenses",
    level: "manage",
  });
  const user = await getCurrentUser();
  const name = textValue(formData, "categoryName");
  const description = textValue(formData, "categoryDescription");

  if (!user || !name) {
    redirect("/expenses?error=category_missing");
  }

  const supabase = await getAdmin();
  const { error } = await supabase.from("expense_categories").insert({
    name,
    description: description || null,
    is_default: false,
    created_by: user.id,
  });

  if (error) {
    redirect("/expenses?error=category_create");
  }

  revalidatePath("/expenses");
  redirect("/expenses?created=category");
}

export async function createExpense(formData: FormData) {
  const role = await requireRole([...expenseRoles], {
    module: "expenses",
    level: "manage",
  });
  const user = await getCurrentUser();
  const amount = numberValue(formData, "amount");
  const categoryId = textValue(formData, "categoryId");
  const receipt = fileValue(formData, "receipt");
  const fundingSource = textValue(formData, "fundingSource") || "company_cash";

  if (
    !user
    || amount <= 0
    || !categoryId
    || !["company_cash", "company_bank", "staff_personal"].includes(fundingSource)
  ) {
    redirect("/expenses?error=missing");
  }

  const supabase = await getAdmin();
  const maintenanceTicketId = textValue(formData, "maintenanceTicketId");
  let propertyId = textValue(formData, "propertyId") || null;
  let unitId = textValue(formData, "unitId") || null;
  let roomId = textValue(formData, "roomId") || null;
  let companyId: string | null = null;
  let organizationId: string | null = null;

  if (maintenanceTicketId) {
    const { data: ticket } = await supabase
      .from("maintenance_tickets")
      .select("property_id, unit_id, room_id, organization_id")
      .eq("id", maintenanceTicketId)
      .maybeSingle();

    propertyId = ticket?.property_id ?? propertyId;
    unitId = ticket?.unit_id ?? unitId;
    roomId = ticket?.room_id ?? roomId;
    organizationId = ticket?.organization_id ?? organizationId;
  }

  if (propertyId) {
    const { data: property } = await supabase
      .from("properties")
      .select("company_id, organization_id")
      .eq("id", propertyId)
      .maybeSingle();
    companyId = property?.company_id ?? null;
    organizationId = property?.organization_id ?? organizationId;
  }

  const { data: expense, error } = await supabase
    .from("expenses")
    .insert({
      organization_id: organizationId,
      company_id: companyId,
      property_id: propertyId,
      unit_id: unitId,
      room_id: roomId,
      maintenance_ticket_id: maintenanceTicketId || null,
      claim_id: textValue(formData, "claimId") || null,
      category_id: categoryId,
      expense_date: textValue(formData, "expenseDate") || new Date().toISOString().slice(0, 10),
      amount,
      tax_amount: numberValue(formData, "taxAmount"),
      supplier: textValue(formData, "supplier") || null,
      description: textValue(formData, "description") || null,
      paid_by: textValue(formData, "paidBy") || user.id,
      payment_method: textValue(formData, "paymentMethod") || "cash",
      funding_source: fundingSource,
      charge_to: textValue(formData, "chargeTo") || "company",
      status: role === "admin" || role === "super_admin" ? "verified" : "pending_verification",
      tax_claimable: textValue(formData, "taxClaimable") === "on",
      receipt_number: textValue(formData, "receiptNumber") || null,
      uploaded_by: user.id,
      verified_by: role === "admin" || role === "super_admin" ? user.id : null,
      verified_at: role === "admin" || role === "super_admin" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error || !expense) {
    redirect("/expenses?error=create");
  }

  if (receipt) {
    const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${user.id}/${expense.id}/${Date.now()}-${safeName}`;
    const bytes = Buffer.from(await receipt.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from("expense-receipts").upload(path, bytes, {
      contentType: receipt.type || "application/octet-stream",
      upsert: true,
    });

    if (uploadError) {
      redirect("/expenses?error=upload");
    }

    await supabase.from("expense_attachments").insert({
      expense_id: expense.id,
      file_path: path,
      file_name: receipt.name,
      content_type: receipt.type || null,
      uploaded_by: user.id,
    });
  }

  revalidatePath("/expenses");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
  redirect("/expenses?created=expense");
}

export async function reviewExpense(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"], {
    module: "expenses",
    level: "manage",
  });
  const user = await getCurrentUser();
  const expenseId = textValue(formData, "expenseId");
  const decision = textValue(formData, "decision");
  const fundingSource = textValue(formData, "fundingSource") || "company_cash";
  const reimbursementSource = textValue(formData, "reimbursementSource");
  const expenseDate = textValue(formData, "expenseDate");

  if (
    !user
    || !expenseId
    || !["verified", "rejected", "reimbursed"].includes(decision)
    || !["company_cash", "company_bank", "staff_personal"].includes(fundingSource)
    || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)
    || (decision === "reimbursed" && !["company_cash", "company_bank"].includes(reimbursementSource))
  ) {
    redirect("/expenses?error=review_missing");
  }

  const supabase = await getAdmin();
  const { data: existingExpense } = await supabase
    .from("expenses")
    .select("claim_id, funding_source")
    .eq("id", expenseId)
    .maybeSingle();

  if (
    !existingExpense ||
    (decision === "reimbursed" &&
      existingExpense.claim_id &&
      existingExpense.funding_source === "staff_personal")
  ) {
    redirect(
      `/expenses?error=${
        existingExpense ? "use_claim_payout" : "review_missing"
      }`,
    );
  }

  const { error } = await supabase
    .from("expenses")
    .update({
      status: decision,
      expense_date: expenseDate,
      category_id: textValue(formData, "categoryId") || null,
      amount: numberValue(formData, "amount"),
      property_id: textValue(formData, "propertyId") || null,
      funding_source: fundingSource,
      reimbursement_source: decision === "reimbursed" ? reimbursementSource : null,
      reimbursed_at: decision === "reimbursed" ? new Date().toISOString() : null,
      charge_to: textValue(formData, "chargeTo") || "company",
      rejection_reason: textValue(formData, "rejectionReason") || null,
      verified_by: decision === "verified" || decision === "reimbursed" ? user.id : null,
      verified_at: decision === "verified" || decision === "reimbursed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", expenseId);

  if (error) {
    redirect("/expenses?error=review");
  }

  revalidatePath("/expenses");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
  redirect("/expenses?reviewed=1");
}

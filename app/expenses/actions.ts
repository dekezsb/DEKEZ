"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { submitExpenseBill, verifyExpenseBill } from "./bill-actions";

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

export async function createExpense(formData: FormData) { return submitExpenseBill(formData); }
export async function reviewExpense(formData: FormData) { return verifyExpenseBill(formData); }

export async function recordExpensePaymentBatch(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "expenses",
    level: "manage",
  });
  const user = await getCurrentUser();
  const expenseIds = [
    ...new Set(
      formData
        .getAll("expenseIds")
        .filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value),
        ),
    ),
  ];
  const paymentMethod = textValue(formData, "paymentMethod");
  const paidOn = textValue(formData, "paidOn");
  const referenceNumber = textValue(formData, "referenceNumber");
  const notes = textValue(formData, "notes");
  const proof = fileValue(formData, "paymentProof");

  if (
    !user ||
    !expenseIds.length ||
    ![
      "company_bank",
      "company_card",
      "company_cash",
      "cheque",
      "other",
    ].includes(paymentMethod) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) ||
    !referenceNumber ||
    !proof ||
    proof.size > 3 * 1024 * 1024 ||
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ].includes(proof.type)
  ) {
    redirect("/expenses?error=payment_missing#payment-knockoff");
  }

  const supabase = createAdminClient();
  const { data: payableExpenses } = await supabase
    .from("expenses")
    .select("id")
    .in("id", expenseIds)
    .eq("status", "verified")
    .eq("payment_status", "unpaid")
    .in("funding_source", ["company_cash", "company_bank"]);

  if ((payableExpenses ?? []).length !== expenseIds.length) {
    redirect("/expenses?error=payment_changed#payment-knockoff");
  }

  const safeName = proof.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const proofPath =
    `${user.id}/${paidOn}/${Date.now()}-expense-payment-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("expense-payment-proofs")
    .upload(proofPath, Buffer.from(await proof.arrayBuffer()), {
      contentType: proof.type,
      upsert: false,
    });

  if (uploadError) {
    redirect("/expenses?error=payment_proof#payment-knockoff");
  }

  const { error: batchError } = await supabase.rpc(
    "record_expense_payment_batch",
    {
      target_expense_ids: expenseIds,
      batch_payment_method: paymentMethod,
      batch_paid_on: paidOn,
      batch_reference: referenceNumber,
      batch_notes: notes,
      batch_proof_bucket: "expense-payment-proofs",
      batch_proof_path: proofPath,
      batch_proof_file_name: proof.name,
      batch_proof_content_type: proof.type,
      batch_recorded_by: user.id,
    },
  );

  if (batchError) {
    await supabase.storage.from("expense-payment-proofs").remove([proofPath]);
    redirect("/expenses?error=payment_changed#payment-knockoff");
  }

  revalidatePath("/expenses");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
  redirect("/expenses?payment_recorded=1#payment-knockoff");
}

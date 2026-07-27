"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";

const utilityTypes = new Set(["water", "electricity", "sewerage", "internet", "other"]);
const maximumDocumentSize = 10 * 1024 * 1024;

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

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function billStatus(amount: number, paidAmount: number, dueDate: string | null) {
  if (paidAmount >= amount) return "paid";
  if (paidAmount > 0) return "partially_paid";
  if (dueDate && dueDate < malaysiaDate()) return "overdue";
  return "unpaid";
}

function formBillState(
  formData: FormData,
  amount: number,
  paidAmount: number,
  dueDate: string | null,
) {
  const requestedStatus = textValue(formData, "paymentStatus");
  if (requestedStatus === "paid") {
    return { paidAmount: amount, status: "paid" };
  }
  const finalPaidAmount = Math.min(paidAmount, amount);
  if (requestedStatus === "overdue" && finalPaidAmount === 0) {
    return { paidAmount: 0, status: "overdue" };
  }
  return {
    paidAmount: finalPaidAmount,
    status: billStatus(amount, finalPaidAmount, dueDate),
  };
}

function monthStart(month: string) {
  return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : "";
}

function documentError(file: File | null) {
  if (!file) return null;
  if (file.size > maximumDocumentSize) return "file_size";
  if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
    return "file_type";
  }
  return null;
}

async function uploadDocument({
  billId,
  propertyId,
  file,
  kind,
}: {
  billId: string;
  propertyId: string;
  file: File;
  kind: "bill" | "receipt";
}) {
  const supabase = await createClient();
  const path = `${propertyId}/${billId}/${kind}`;
  const { error: uploadError } = await supabase.storage
    .from("utility-bill-documents")
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

  if (uploadError) return uploadError;

  const columns =
    kind === "bill"
      ? {
          bill_attachment_path: path,
          bill_attachment_name: file.name,
          bill_attachment_type: file.type || null,
        }
      : {
          receipt_path: path,
          receipt_name: file.name,
          receipt_type: file.type || null,
        };
  const { error } = await supabase
    .from("utility_bills")
    .update(columns)
    .eq("id", billId)
    .eq("property_id", propertyId)
    .eq("billing_scope", "property");
  return error;
}

function revalidateUtilityPaths(propertyId?: string) {
  revalidatePath("/utility-bills");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  if (propertyId) revalidatePath(`/properties/${propertyId}`);
}

async function getManagedProperty(propertyId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("id, company_id")
    .eq("id", propertyId)
    .maybeSingle();
  return data;
}

export async function createUtilityBill(formData: FormData) {
  await requireRole(["super_admin", "admin", "owner"], {
    module: "utility_bills",
    level: "manage",
  });

  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const utilityType = textValue(formData, "utilityType").toLowerCase();
  const billMonth = monthStart(textValue(formData, "billMonth"));
  const amount = numberValue(formData, "amount");
  const paidAmount = Math.max(numberValue(formData, "paidAmount"), 0);
  const dueDate = textValue(formData, "dueDate") || null;
  const paymentDate = textValue(formData, "paymentDate") || null;
  const billFile = fileValue(formData, "billFile");
  const receiptFile = fileValue(formData, "receiptFile");
  const fileError = documentError(billFile) ?? documentError(receiptFile);

  if (
    !user ||
    !propertyId ||
    !utilityTypes.has(utilityType) ||
    !billMonth ||
    amount <= 0 ||
    paidAmount > amount
  ) {
    redirect("/utility-bills?error=missing#utility-form");
  }
  if (fileError) {
    redirect(`/utility-bills?error=${fileError}#utility-form`);
  }

  const property = await getManagedProperty(propertyId);
  if (!property) {
    redirect("/utility-bills?error=property#utility-form");
  }

  const supabase = await createClient();
  const { data: duplicate } = await supabase
    .from("utility_bills")
    .select("id")
    .eq("property_id", propertyId)
    .eq("utility_type", utilityType)
    .eq("bill_month", billMonth)
    .eq("billing_scope", "property")
    .maybeSingle();

  if (duplicate) {
    redirect(`/utility-bills?error=duplicate&existing=${duplicate.id}#bill-${duplicate.id}`);
  }

  const state = formBillState(formData, amount, paidAmount, dueDate);
  const { data: bill, error } = await supabase
    .from("utility_bills")
    .insert({
      organization_id: property.company_id,
      property_id: property.id,
      tenant_id: null,
      unit_id: null,
      room_id: null,
      billing_scope: "property",
      utility_type: utilityType,
      bill_month: billMonth,
      amount,
      paid_amount: state.paidAmount,
      account_number: textValue(formData, "accountNumber") || null,
      reference_number: textValue(formData, "referenceNumber") || null,
      due_date: dueDate,
      payment_date: state.paidAmount > 0 ? paymentDate : null,
      status: state.status,
      notes: textValue(formData, "notes") || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    redirect("/utility-bills?error=duplicate#utility-form");
  }
  if (error || !bill) {
    redirect("/utility-bills?error=create#utility-form");
  }

  if (billFile) {
    const uploadError = await uploadDocument({
      billId: bill.id,
      propertyId,
      file: billFile,
      kind: "bill",
    });
    if (uploadError) {
      redirect(`/utility-bills?error=upload&edit=${bill.id}#utility-form`);
    }
  }
  if (receiptFile) {
    const uploadError = await uploadDocument({
      billId: bill.id,
      propertyId,
      file: receiptFile,
      kind: "receipt",
    });
    if (uploadError) {
      redirect(`/utility-bills?error=upload&edit=${bill.id}#utility-form`);
    }
  }

  revalidateUtilityPaths(propertyId);
  redirect("/utility-bills?created=1");
}

export async function updateUtilityBill(formData: FormData) {
  await requireRole(["super_admin", "admin", "owner"], {
    module: "utility_bills",
    level: "manage",
  });

  const billId = textValue(formData, "billId");
  const propertyId = textValue(formData, "propertyId");
  const utilityType = textValue(formData, "utilityType").toLowerCase();
  const billMonth = monthStart(textValue(formData, "billMonth"));
  const amount = numberValue(formData, "amount");
  const paidAmount = Math.max(numberValue(formData, "paidAmount"), 0);
  const dueDate = textValue(formData, "dueDate") || null;
  const paymentDate = textValue(formData, "paymentDate") || null;
  const billFile = fileValue(formData, "billFile");
  const receiptFile = fileValue(formData, "receiptFile");
  const fileError = documentError(billFile) ?? documentError(receiptFile);

  if (
    !billId ||
    !propertyId ||
    !utilityTypes.has(utilityType) ||
    !billMonth ||
    amount <= 0 ||
    paidAmount > amount
  ) {
    redirect(`/utility-bills?error=missing&edit=${billId}#utility-form`);
  }
  if (fileError) {
    redirect(`/utility-bills?error=${fileError}&edit=${billId}#utility-form`);
  }

  const property = await getManagedProperty(propertyId);
  if (!property) {
    redirect(`/utility-bills?error=property&edit=${billId}#utility-form`);
  }

  const state = formBillState(formData, amount, paidAmount, dueDate);
  const supabase = await createClient();
  const { error } = await supabase
    .from("utility_bills")
    .update({
      organization_id: property.company_id,
      property_id: property.id,
      tenant_id: null,
      unit_id: null,
      room_id: null,
      utility_type: utilityType,
      bill_month: billMonth,
      amount,
      paid_amount: state.paidAmount,
      account_number: textValue(formData, "accountNumber") || null,
      reference_number: textValue(formData, "referenceNumber") || null,
      due_date: dueDate,
      payment_date: state.paidAmount > 0 ? paymentDate : null,
      status: state.status,
      notes: textValue(formData, "notes") || null,
    })
    .eq("id", billId)
    .eq("billing_scope", "property");

  if (error?.code === "23505") {
    redirect(`/utility-bills?error=duplicate&edit=${billId}#utility-form`);
  }
  if (error) {
    redirect(`/utility-bills?error=update&edit=${billId}#utility-form`);
  }

  if (billFile) {
    const uploadError = await uploadDocument({
      billId,
      propertyId,
      file: billFile,
      kind: "bill",
    });
    if (uploadError) {
      redirect(`/utility-bills?error=upload&edit=${billId}#utility-form`);
    }
  }
  if (receiptFile) {
    const uploadError = await uploadDocument({
      billId,
      propertyId,
      file: receiptFile,
      kind: "receipt",
    });
    if (uploadError) {
      redirect(`/utility-bills?error=upload&edit=${billId}#utility-form`);
    }
  }

  revalidateUtilityPaths(propertyId);
  redirect(`/utility-bills?updated=1#bill-${billId}`);
}

export async function markUtilityBillPaid(formData: FormData) {
  await requireRole(["super_admin", "admin", "owner"], {
    module: "utility_bills",
    level: "manage",
  });

  const billId = textValue(formData, "billId");
  const propertyId = textValue(formData, "propertyId");
  const paymentDate = textValue(formData, "paymentDate") || malaysiaDate();
  const receiptFile = fileValue(formData, "receiptFile");
  const fileError = documentError(receiptFile);
  if (!billId || !propertyId || fileError) {
    redirect(`/utility-bills?error=${fileError ?? "missing"}#bill-${billId}`);
  }

  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("utility_bills")
    .select("amount")
    .eq("id", billId)
    .eq("property_id", propertyId)
    .eq("billing_scope", "property")
    .maybeSingle();
  if (!bill) redirect(`/utility-bills?error=missing#bill-${billId}`);

  const { error } = await supabase
    .from("utility_bills")
    .update({
      paid_amount: Number(bill.amount ?? 0),
      payment_date: paymentDate,
      reference_number: textValue(formData, "referenceNumber") || null,
      status: "paid",
    })
    .eq("id", billId)
    .eq("billing_scope", "property");
  if (error) redirect(`/utility-bills?error=update#bill-${billId}`);

  if (receiptFile) {
    const uploadError = await uploadDocument({
      billId,
      propertyId,
      file: receiptFile,
      kind: "receipt",
    });
    if (uploadError) redirect(`/utility-bills?error=upload#bill-${billId}`);
  }

  revalidateUtilityPaths(propertyId);
  redirect(`/utility-bills?paid=1#bill-${billId}`);
}

export async function uploadUtilityReceipt(formData: FormData) {
  await requireRole(["super_admin", "admin", "owner"], {
    module: "utility_bills",
    level: "manage",
  });

  const billId = textValue(formData, "billId");
  const propertyId = textValue(formData, "propertyId");
  const receiptFile = fileValue(formData, "receiptFile");
  const fileError = documentError(receiptFile);
  if (!billId || !propertyId || !receiptFile || fileError) {
    redirect(`/utility-bills?error=${fileError ?? "missing"}#bill-${billId}`);
  }

  const uploadError = await uploadDocument({
    billId,
    propertyId,
    file: receiptFile,
    kind: "receipt",
  });
  if (uploadError) redirect(`/utility-bills?error=upload#bill-${billId}`);

  revalidateUtilityPaths(propertyId);
  redirect(`/utility-bills?receipt=1#bill-${billId}`);
}

export async function cancelUtilityBill(formData: FormData) {
  await requireRole(["super_admin", "admin", "owner"], {
    module: "utility_bills",
    level: "manage",
  });

  const user = await getCurrentUser();
  const billId = textValue(formData, "billId");
  const propertyId = textValue(formData, "propertyId");
  const reason = textValue(formData, "reason");
  if (!user || !billId || !propertyId || !reason) {
    redirect(`/utility-bills?error=cancel_reason#bill-${billId}`);
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("utility_bills")
    .select("notes")
    .eq("id", billId)
    .eq("property_id", propertyId)
    .eq("billing_scope", "property")
    .maybeSingle();
  if (!current) redirect(`/utility-bills?error=missing#bill-${billId}`);

  const notes = [current.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n");
  const { error } = await supabase
    .from("utility_bills")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
      notes,
    })
    .eq("id", billId)
    .eq("billing_scope", "property");
  if (error) redirect(`/utility-bills?error=update#bill-${billId}`);

  revalidateUtilityPaths(propertyId);
  redirect(`/utility-bills?cancelled=1#bill-${billId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import {
  getVerifiedDepositPaymentMaps,
  verifiedDepositPaid,
} from "@/lib/invoices/deposit-payments";
import {
  isPaymentPurpose,
  type PaymentPurpose,
} from "@/lib/payments/payment-purpose";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

export async function createPayment(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "payments",
    level: "manage",
  });

  const user = await getCurrentUser();
  const tenantId = textValue(formData, "tenantId");
  const tenancyId = textValue(formData, "tenancyId");
  const category = textValue(formData, "category");
  const amount = numberValue(formData, "amount");
  const paymentDate = textValue(formData, "paymentDate") || new Date().toISOString().slice(0, 10);
  const paymentMethod = textValue(formData, "paymentMethod") || "cash";
  const referenceNumber = textValue(formData, "referenceNumber");
  const notes = textValue(formData, "notes");

  if (!user || !tenantId || !category || amount <= 0) {
    redirect("/payments?error=missing");
  }

  const supabase = await createClient();
  let tenancy:
    | {
        id: string;
        company_id: string;
        organization_id: string | null;
        tenant_id: string;
        property_id: string;
        unit_id: string | null;
        room_id: string;
        deposit: number | null;
      }
    | null = null;

  if (tenancyId) {
    const { data } = await supabase
      .from("tenancies")
      .select("id, company_id, organization_id, tenant_id, property_id, unit_id, room_id, deposit")
      .eq("id", tenancyId)
      .maybeSingle();
    tenancy = data;
  } else {
    const { data } = await supabase
      .from("tenancies")
      .select("id, company_id, organization_id, tenant_id, property_id, unit_id, room_id, deposit")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle();
    tenancy = data;
  }

  if (!tenancy) {
    redirect("/payments?error=tenancy");
  }

  if (category === "deposit") {
    const { data: existingDeposits } = await supabase
      .from("payments")
      .select("amount")
      .eq("tenancy_id", tenancy.id)
      .eq("category", "deposit")
      .eq("status", "confirmed");
    const received = (existingDeposits ?? []).reduce(
      (total, payment) => total + Number(payment.amount ?? 0),
      0,
    );
    const remainingDeposit = Math.max(Number(tenancy.deposit ?? 0) - received, 0);

    if (amount > remainingDeposit + 0.005) {
      redirect("/payments?error=deposit_amount");
    }
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("profile_id")
    .eq("id", tenancy.tenant_id)
    .maybeSingle();

  const { error } = await supabase.from("payments").insert({
    company_id: tenancy.company_id,
    organization_id: tenancy.organization_id ?? null,
    tenant_id: tenant?.profile_id ?? null,
    tenancy_id: tenancy.id,
    property_id: tenancy.property_id,
    unit_id: tenancy.unit_id,
    room_id: tenancy.room_id,
    category,
    amount,
    payment_date: paymentDate,
    payment_method: paymentMethod,
    reference_number: referenceNumber || null,
    notes: notes || null,
    status: "confirmed",
    recorded_by: user.id,
    verified_by: user.id,
    verified_at: new Date().toISOString(),
  });

  if (error) {
    redirect("/payments?error=create");
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/properties");
  redirect("/payments?created=1");
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

export async function uploadMonthlyPaymentProof(formData: FormData) {
  await requireRole(["tenant"], {
    module: "payments",
    level: "manage",
  });

  const user = await getCurrentUser();
  const rentBillId = textValue(formData, "rentBillId");
  const amount = numberValue(formData, "amount");
  const requestedPurpose = textValue(formData, "paymentPurpose");
  const paymentPurpose: PaymentPurpose = isPaymentPurpose(requestedPurpose)
    ? requestedPurpose
    : "monthly_rent";
  const receipt = fileValue(formData, "receipt");

  if (!user || !rentBillId || amount <= 0 || !receipt) {
    redirect("/payments?error=proof_missing");
  }

  const supabase = await getAdmin();
  const { data: tenantRecords } = await supabase
    .from("tenants")
    .select("id")
    .eq("profile_id", user.id);
  const tenantIds = (tenantRecords ?? []).map((tenant) => tenant.id);

  if (!tenantIds.length) {
    redirect("/payments?error=proof_missing");
  }

  const { data: tenancies } = await supabase
    .from("tenancies")
    .select("id")
    .in("tenant_id", tenantIds);
  const tenancyIds = (tenancies ?? []).map((tenancy) => tenancy.id);

  if (!tenancyIds.length) {
    redirect("/payments?error=proof_missing");
  }

  const { data: bill } = await supabase
    .from("rent_bills")
    .select("id, tenancy_id, tenant_id, property_id, unit_id, room_id, bill_month, amount, deposit_amount, paid_amount, status")
    .eq("id", rentBillId)
    .in("tenancy_id", tenancyIds)
    .maybeSingle();

  if (!bill) {
    redirect("/payments?error=proof_missing");
  }

  if (["cancelled", "waived"].includes(String(bill.status))) {
    redirect("/payments?error=proof_closed");
  }

  const rentOutstanding = Math.max(
    Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0),
    0,
  );
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("deposit")
    .eq("id", bill.tenancy_id)
    .maybeSingle();
  const depositRequired = Math.max(
    Number(bill.deposit_amount ?? 0),
    Number(tenancy?.deposit ?? 0),
  );
  const depositMaps = await getVerifiedDepositPaymentMaps(
    supabase,
    [bill.tenancy_id],
    [],
  );
  const depositOutstanding = Math.max(
    depositRequired -
      verifiedDepositPaid(depositMaps, {
        tenancyId: bill.tenancy_id,
        tenantRecordId: null,
        depositAmount: depositRequired,
      }),
    0,
  );
  const purposeAvailable =
    (paymentPurpose === "monthly_rent" && rentOutstanding > 0.005) ||
    (paymentPurpose === "deposit" && depositOutstanding > 0.005) ||
    (paymentPurpose === "rent_and_deposit" &&
      rentOutstanding > 0.005 &&
      depositOutstanding > 0.005) ||
    paymentPurpose === "other";
  if (!purposeAvailable) {
    redirect("/payments?error=proof_closed");
  }

  const { data: existingSubmission } = await supabase
    .from("payment_submissions")
    .select("id")
    .eq("rent_bill_id", bill.id)
    .eq("verification_status", "pending_verification")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSubmission) {
    redirect("/payments?proof=1");
  }

  const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${user.id}/${bill.id}/${paymentPurpose}-${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await receipt.arrayBuffer());
  const { error: uploadError } = await supabase.storage.from("payment-receipts").upload(path, bytes, {
    contentType: receipt.type || "application/octet-stream",
    upsert: true,
  });

  if (uploadError) {
    redirect("/payments?error=proof_upload");
  }

  const { data: submission, error } = await supabase
    .from("payment_submissions")
    .insert({
      tenant_id: user.id,
      tenancy_id: bill.tenancy_id,
      rent_bill_id: bill.id,
      property_id: bill.property_id,
      unit_id: bill.unit_id,
      room_id: bill.room_id,
      bill_month: bill.bill_month,
      bill_type:
        paymentPurpose === "deposit"
          ? "deposit"
          : paymentPurpose === "other"
            ? "other"
            : "monthly_rent",
      payment_type: paymentPurpose,
      amount,
      payment_date: textValue(formData, "paymentDate") || new Date().toISOString().slice(0, 10),
      payment_method: textValue(formData, "paymentMethod") || "bank_transfer",
      reference_number: textValue(formData, "referenceNumber") || null,
      receipt_url: path,
      verification_status: "pending_verification",
    })
    .select("id")
    .single();

  if (error || !submission) {
    await supabase.storage.from("payment-receipts").remove([path]);
    if (error?.code === "23505") {
      redirect("/payments?proof=1");
    }
    redirect("/payments?error=proof_create");
  }

  await supabase.from("payment_attachments").insert({
    payment_submission_id: submission.id,
    tenant_id: user.id,
    file_path: path,
    file_name: receipt.name,
    content_type: receipt.type || null,
  });

  if (
    paymentPurpose === "monthly_rent" ||
    paymentPurpose === "rent_and_deposit"
  ) {
    await supabase
      .from("rent_bills")
      .update({ status: "payment_submitted", updated_at: new Date().toISOString() })
      .eq("id", bill.id);
  }

  revalidatePath("/payments");
  revalidatePath("/payment-verification");
  revalidatePath("/rent-due-tracker");
  revalidatePath("/dashboard");
  redirect("/payments?proof=1");
}

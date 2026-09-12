import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AccountType = "owner" | "tenant";
type UploadKey =
  | "companyDocument"
  | "commercialSupportingDocument"
  | "icBack"
  | "icFront"
  | "passportPhoto"
  | "paymentSlip"
  | "tradingLicense";

type CompletedUpload = {
  bucket: "payment-receipts" | "tenant-documents";
  contentType: string;
  fileName: string;
  key: UploadKey;
  path: string;
};

const documentTypes: Partial<Record<UploadKey, string>> = {
  companyDocument: "company_document",
  commercialSupportingDocument: "commercial_supporting_document",
  icBack: "ic_back",
  icFront: "ic_front",
  passportPhoto: "passport_photo_page",
  tradingLicense: "trading_license",
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function moneyValue(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function checkInPaymentNote({
  rentPaid,
  depositPaid,
  note,
}: {
  rentPaid: number;
  depositPaid: number;
  note: string;
}) {
  const declaration = `Registration payment declaration — rent received: RM ${rentPaid.toFixed(2)}; deposit received: RM ${depositPaid.toFixed(2)}.`;
  return note ? `${declaration}\nNote: ${note}` : declaration;
}

async function objectExists(
  admin: ReturnType<typeof createAdminClient>,
  upload: CompletedUpload,
) {
  const parts = upload.path.split("/");
  const fileName = parts.pop();
  const folder = parts.join("/");
  if (!fileName || !folder) return false;

  const { data, error } = await admin.storage
    .from(upload.bucket)
    .list(folder, { limit: 10, search: fileName });

  return !error && Boolean(data?.some((item) => item.name === fileName));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Your registration session expired. Please sign in again." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const accountType = cleanText(body?.accountType) as AccountType;
  const applicationId = cleanText(body?.applicationId) || null;
  const uploads = Array.isArray(body?.uploads)
    ? (body.uploads as CompletedUpload[])
    : [];

  if (
    !["owner", "tenant"].includes(accountType) ||
    uploads.some(
      (upload) =>
        !upload ||
        !["payment-receipts", "tenant-documents"].includes(upload.bucket) ||
        !upload.path.startsWith(`${user.id}/self-registration/`) ||
        !upload.fileName ||
        !upload.contentType ||
        !upload.key,
    )
  ) {
    return NextResponse.json(
      { error: "The uploaded registration files are incomplete." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select(
      "id, requested_role, identity_type, registration_completed_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.requested_role !== accountType) {
    return NextResponse.json(
      { error: "The registration record could not be found." },
      { status: 404 },
    );
  }

  const uniqueKeys = new Set(uploads.map((upload) => upload.key));
  if (uniqueKeys.size !== uploads.length) {
    return NextResponse.json(
      { error: "Duplicate registration uploads were received." },
      { status: 400 },
    );
  }


  const existence = await Promise.all(
    uploads.map((upload) => objectExists(admin, upload)),
  );
  if (accountType === "owner" && existence.some((exists) => !exists)) {
    return NextResponse.json(
      { error: "One or more files did not finish uploading." },
      { status: 400 },
    );
  }
  const confirmedUploads = uploads.filter((_, index) => existence[index]);
  if (confirmedUploads.length !== uploads.length) {
    console.info("[register/complete] missing uploads left for Admin review", {
      accountType,
      missingKeys: uploads
        .filter((_, index) => !existence[index])
        .map((upload) => upload.key),
      userId: user.id,
    });
  }

  if (accountType === "tenant") {
    const { data: application } = await admin
      .from("tenant_applications")
      .select(
        "id, tenant_id, property_id, unit_id, room_id, monthly_rent, deposit, utility_deposit, status, registration_mode",
      )
      .eq("id", applicationId)
      .eq("tenant_id", user.id)
      .maybeSingle();

    if (!application || !["draft", "submitted"].includes(application.status)) {
      return NextResponse.json(
        { error: "The tenant registration record could not be found." },
        { status: 404 },
      );
    }
    const rentPaid = moneyValue(body?.rentPaid);
    const depositPaid = moneyValue(body?.depositPaid);
    const paymentDate = cleanText(body?.paymentDate);
    const paymentSlip = confirmedUploads.find(
      (upload) => upload.key === "paymentSlip",
    );
    const totalPaid = (rentPaid ?? 0) + (depositPaid ?? 0);
    const requiredDeposit =
      Number(application.deposit ?? 0) + Number(application.utility_deposit ?? 0);
    if (
      rentPaid === null ||
      depositPaid === null ||
      rentPaid > Number(application.monthly_rent ?? 0) + 0.005 ||
      depositPaid > requiredDeposit + 0.005 ||
      (totalPaid > 0 && (!paymentSlip || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate))) ||
      (paymentSlip && totalPaid <= 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Enter valid rent and deposit amounts within the agreed terms, plus the payment date and slip for money received.",
        },
        { status: 400 },
      );
    }

    const tenantDocuments = confirmedUploads.filter(
      (upload) => upload.bucket === "tenant-documents",
    );
    for (const upload of tenantDocuments) {
      const type =
        upload.key === "companyDocument"
          ? "commercial_supporting_document"
          : documentTypes[upload.key];
      if (!type) continue;
      const { data: existing } = await admin
        .from("tenant_documents")
        .select("id")
        .eq("file_path", upload.path)
        .maybeSingle();
      if (!existing) {
        const { error } = await admin.from("tenant_documents").insert({
          tenant_application_id: application.id,
          tenant_id: user.id,
          document_type: type,
          file_path: upload.path,
          file_name: upload.fileName,
          content_type: upload.contentType,
          uploaded_by: user.id,
        });
        if (error) {
          console.error("[register/complete] document left for Admin review", {
            applicationId: application.id,
            documentType: type,
            error: error.message,
            filePath: upload.path,
          });
        }
      }
    }

    let paymentRecorded = false;

    if (paymentSlip) {
      const paymentNote = checkInPaymentNote({
        rentPaid: rentPaid ?? 0,
        depositPaid: depositPaid ?? 0,
        note: cleanText(body?.paymentNote),
      });
      const paymentRows = [
        rentPaid && rentPaid > 0
          ? {
              tenant_id: user.id,
              tenant_application_id: application.id,
              property_id: application.property_id,
              unit_id: application.unit_id,
              room_id: application.room_id,
              bill_type: "check_in",
              payment_type: "monthly_rent",
              amount: rentPaid,
              payment_date: paymentDate,
              payment_note: paymentNote,
              payment_method: "online_payment",
              receipt_url: paymentSlip.path,
              verification_status: "pending_verification",
            }
          : null,
        depositPaid && depositPaid > 0
          ? {
              tenant_id: user.id,
              tenant_application_id: application.id,
              property_id: application.property_id,
              unit_id: application.unit_id,
              room_id: application.room_id,
              bill_type: "check_in",
              payment_type: "deposit",
              amount: depositPaid,
              payment_date: paymentDate,
              payment_note: paymentNote,
              payment_method: "online_payment",
              receipt_url: paymentSlip.path,
              verification_status: "pending_verification",
            }
          : null,
      ].filter((row): row is NonNullable<typeof row> => row !== null);
      const { data: paymentSubmissions, error: paymentError } = await admin
        .from("payment_submissions")
        .insert(paymentRows)
        .select("id");

      if (paymentError || !paymentSubmissions?.length) {
        console.error("[register/complete] payment left for Admin review", {
          applicationId: application.id,
          error: paymentError?.message ?? "Payment rows were not returned.",
          filePath: paymentSlip.path,
        });
      } else {
        paymentRecorded = true;
        const { error: attachmentError } = await admin
          .from("payment_attachments")
          .insert(
            paymentSubmissions.map((paymentSubmission) => ({
              payment_submission_id: paymentSubmission.id,
              tenant_id: user.id,
              file_path: paymentSlip.path,
              file_name: paymentSlip.fileName,
              content_type: paymentSlip.contentType,
            })),
          );
        if (attachmentError) {
          console.error("[register/complete] payment attachment left for Admin review", {
            applicationId: application.id,
            error: attachmentError.message,
            filePath: paymentSlip.path,
          });
        }
      }
    }

    const paymentNote = checkInPaymentNote({
      rentPaid: rentPaid ?? 0,
      depositPaid: depositPaid ?? 0,
      note: cleanText(body?.paymentNote),
    });
    await admin
      .from("tenant_applications")
      .update({
        admin_notes: `Registration terms declared — room rent to collect: RM ${Number(application.monthly_rent ?? 0).toFixed(2)}; security deposit to collect: RM ${requiredDeposit.toFixed(2)}.\n${paymentNote}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", application.id);

    const { error: applicationError } = application.registration_mode === "reservation"
      ? await admin.rpc("submit_public_reservation", { p_application: application.id, p_tenant: user.id, p_payment_recorded: paymentRecorded })
      : await admin
      .from("tenant_applications")
      .update({
        status: "submitted",
        verification_status: "pending_verification",
        payment_status: paymentRecorded ? "pending_verification" : "unpaid",
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", application.id);
    if (applicationError) {
      return NextResponse.json(
        { error: "Tenant registration could not be submitted." },
        { status: 500 },
      );
    }
  } else {
    for (const upload of uploads) {
      const type = documentTypes[upload.key];
      if (!type) continue;
      const { data: existing } = await admin
        .from("profile_documents")
        .select("id")
        .eq("file_path", upload.path)
        .maybeSingle();
      if (!existing) {
        const { error } = await admin.from("profile_documents").insert({
          profile_id: user.id,
          document_type: type,
          file_path: upload.path,
          file_name: upload.fileName,
          content_type: upload.contentType,
        });
        if (error) {
          return NextResponse.json(
            { error: "Owner documents could not be saved." },
            { status: 500 },
          );
        }
      }
    }
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      registration_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (profileError) {
    console.error("[register/complete] profile completion needs Admin review", {
      error: profileError.message,
      userId: user.id,
    });
  }

  return NextResponse.json({ redirectTo: "/registration-status" });
}

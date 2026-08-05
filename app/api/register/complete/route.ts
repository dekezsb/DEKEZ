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
    !uploads.length ||
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

  const required =
    profile.identity_type === "ic"
      ? ["icFront", "icBack"]
      : ["passportPhoto"];
  if (
    required.some((key) => !uniqueKeys.has(key as UploadKey)) ||
    (accountType === "tenant" && !uniqueKeys.has("paymentSlip"))
  ) {
    return NextResponse.json(
      { error: "Required identity or payment files are missing." },
      { status: 400 },
    );
  }

  const existence = await Promise.all(
    uploads.map((upload) => objectExists(admin, upload)),
  );
  if (existence.some((exists) => !exists)) {
    return NextResponse.json(
      { error: "One or more files did not finish uploading." },
      { status: 400 },
    );
  }

  if (accountType === "tenant") {
    const { data: application } = await admin
      .from("tenant_applications")
      .select(
        "id, tenant_id, property_id, unit_id, room_id, monthly_rent, status, properties(is_commercial)",
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

    const property = Array.isArray(application.properties)
      ? application.properties[0]
      : application.properties;
    if (
      property?.is_commercial &&
      !uniqueKeys.has("commercialSupportingDocument")
    ) {
      return NextResponse.json(
        {
          error:
            "This commercial property requires a supporting business document.",
        },
        { status: 400 },
      );
    }

    const tenantDocuments = uploads.filter(
      (upload) => upload.bucket === "tenant-documents",
    );
    for (const upload of tenantDocuments) {
      const type = documentTypes[upload.key];
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
          return NextResponse.json(
            { error: "Identity documents could not be saved." },
            { status: 500 },
          );
        }
      }
    }

    const paymentSlip = uploads.find(
      (upload) => upload.key === "paymentSlip",
    );
    if (!paymentSlip) {
      return NextResponse.json(
        { error: "Payment slip is required." },
        { status: 400 },
      );
    }

    let { data: paymentSubmission } = await admin
      .from("payment_submissions")
      .select("id")
      .eq("tenant_application_id", application.id)
      .eq("receipt_url", paymentSlip.path)
      .maybeSingle();

    if (!paymentSubmission) {
      const result = await admin
        .from("payment_submissions")
        .insert({
          tenant_id: user.id,
          tenant_application_id: application.id,
          property_id: application.property_id,
          unit_id: application.unit_id,
          room_id: application.room_id,
          bill_type: "check_in",
          payment_type: "monthly_rent",
          amount: Number(application.monthly_rent ?? 0),
          payment_date: new Date().toISOString().slice(0, 10),
          payment_method: "online_payment",
          receipt_url: paymentSlip.path,
          verification_status: "pending_verification",
        })
        .select("id")
        .single();
      paymentSubmission = result.data;
      if (result.error || !paymentSubmission) {
        return NextResponse.json(
          { error: "Payment proof could not be saved." },
          { status: 500 },
        );
      }
    }

    const { data: existingAttachment } = await admin
      .from("payment_attachments")
      .select("id")
      .eq("payment_submission_id", paymentSubmission.id)
      .eq("file_path", paymentSlip.path)
      .maybeSingle();
    if (!existingAttachment) {
      await admin.from("payment_attachments").insert({
        payment_submission_id: paymentSubmission.id,
        tenant_id: user.id,
        file_path: paymentSlip.path,
        file_name: paymentSlip.fileName,
        content_type: paymentSlip.contentType,
      });
    }

    const { error: applicationError } = await admin
      .from("tenant_applications")
      .update({
        status: "submitted",
        verification_status: "pending_verification",
        payment_status: "pending_verification",
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
    return NextResponse.json(
      { error: "Registration could not be completed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ redirectTo: "/registration-status" });
}

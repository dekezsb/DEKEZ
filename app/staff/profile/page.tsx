import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import { getCurrentUserAccess } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateManagementBankDetails,
  uploadManagementIdentityDocument,
} from "./actions";

type PageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    uploaded?: string;
  }>;
};

const errors: Record<string, string> = {
  bank_required: "Complete all bank account fields.",
  bank_save: "The bank details could not be saved.",
  document_required: "Choose a document type and file.",
  document_invalid: "Use a JPG, PNG, WebP or PDF file up to 10 MB.",
  document_upload: "The document could not be uploaded.",
  document_save: "The uploaded document could not be recorded.",
};

const documentLabels: Record<string, string> = {
  ic_front: "IC - Front",
  ic_back: "IC - Back",
  passport_photo_page: "Passport",
};

export default async function ManagementProfilePage({
  searchParams,
}: PageProps) {
  const { role, user } = await getCurrentUserAccess();

  if (role !== "admin") {
    return null;
  }

  const params = await searchParams;
  const admin = createAdminClient();
  const [{ data: profile }, { data: documents }] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, full_name, phone, identity_type, identity_number, bank_name, bank_account_holder, bank_account_number",
      )
      .eq("id", user.id)
      .maybeSingle(),
    admin
      .from("profile_documents")
      .select(
        "id, document_type, file_path, file_name, content_type, verification_status, uploaded_at",
      )
      .eq("profile_id", user.id)
      .order("uploaded_at", { ascending: false }),
  ]);

  const documentItems = await Promise.all(
    (documents ?? []).map(async (document) => {
      const { data } = await admin.storage
        .from("tenant-documents")
        .createSignedUrl(document.file_path, 60 * 10);
      return { ...document, signedUrl: data?.signedUrl ?? null };
    }),
  );

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#b98a2c]">
          Management Account
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">My Profile</h1>
        <p className="mt-2 text-sm text-gray-600">
          Keep your identity and reimbursement account details up to date.
        </p>
      </div>

      {params.error && errors[params.error] ? (
        <div className="rounded-md border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600">
          {errors[params.error]}
        </div>
      ) : null}
      {params.saved ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Bank details saved.
        </div>
      ) : null}
      {params.uploaded ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Identity document uploaded for Admin review.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal Details</CardTitle>
            <CardDescription>
              These details identify your Management Team account.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Detail label="Full name" value={profile?.full_name} />
            <Detail label="Phone number" value={profile?.phone ?? user.phone} />
            <Detail
              label="Identity type"
              value={profile?.identity_type?.toUpperCase()}
            />
            <Detail
              label="IC / Passport"
              value={profile?.identity_number}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bank Information</CardTitle>
            <CardDescription>
              Approved personal-money claims can be reimbursed to this account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={updateManagementBankDetails}
              className="grid gap-4"
            >
              <Field
                defaultValue={profile?.bank_name}
                label="Bank name"
                name="bankName"
              />
              <Field
                defaultValue={profile?.bank_account_holder}
                label="Account holder name"
                name="accountHolder"
              />
              <Field
                defaultValue={profile?.bank_account_number}
                inputMode="numeric"
                label="Bank account number"
                name="accountNumber"
              />
              <Button className="mt-1 w-full sm:w-fit" type="submit">
                Save bank details
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identity Documents</CardTitle>
          <CardDescription>
            Upload your IC front and back, or your passport photo page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            action={uploadManagementIdentityDocument}
            className="grid gap-4 rounded-md border border-[#d7dde5] p-4 sm:grid-cols-[minmax(0,220px)_1fr_auto] sm:items-end"
          >
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="documentType">
                Document type
              </label>
              <select
                className="h-10 rounded-md border border-[#cfd7e3] bg-white px-3 text-sm"
                id="documentType"
                name="documentType"
                required
              >
                <option value="">Choose type</option>
                <option value="ic_front">IC - Front</option>
                <option value="ic_back">IC - Back</option>
                <option value="passport_photo_page">Passport</option>
              </select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="document">
                Photo or PDF
              </label>
              <input
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="min-h-10 rounded-md border border-[#cfd7e3] bg-white px-3 py-2 text-sm"
                id="document"
                name="document"
                required
                type="file"
              />
            </div>
            <Button type="submit">Upload</Button>
          </form>

          {documentItems.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {documentItems.map((document) => (
                <div
                  className="rounded-md border border-[#d7dde5] bg-white p-4"
                  key={document.id}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <p className="font-semibold">
                      {documentLabels[document.document_type] ??
                        document.document_type}
                    </p>
                    <Badge>{document.verification_status.replaceAll("_", " ")}</Badge>
                  </div>
                  {document.signedUrl ? (
                    <DocumentPreview
                      contentType={document.content_type}
                      fileName={document.file_name ?? "Identity document"}
                      label={
                        documentLabels[document.document_type] ??
                        "Identity document"
                      }
                      url={document.signedUrl}
                    />
                  ) : (
                    <p className="text-sm text-gray-500">Preview unavailable.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No identity documents uploaded yet.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 font-medium">{value || "-"}</p>
    </div>
  );
}

function Field({
  defaultValue,
  inputMode,
  label,
  name,
}: {
  defaultValue?: string | null;
  inputMode?: "numeric";
  label: string;
  name: string;
}) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        className="h-10 rounded-md border border-[#cfd7e3] bg-white px-3 text-sm"
        defaultValue={defaultValue ?? ""}
        id={name}
        inputMode={inputMode}
        name={name}
        required
      />
    </div>
  );
}

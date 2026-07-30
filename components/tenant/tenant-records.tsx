import { Link } from "@/components/app-link";
import { FileLock2, FileText, Upload } from "lucide-react";
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
import { uploadTenantDocument } from "@/app/tenants/[id]/actions";
import {
  formatMalaysiaDate,
  formatMalaysiaDateTime,
} from "@/lib/date-format";
import type {
  TenantAgreementHistoryView,
  TenantDocumentView,
} from "@/lib/data/property-details";
import { statusBadgeClass } from "@/lib/status-styles";

type TenantRecordsProps = {
  tenantKey: string;
  tenantRecordId: string | null;
  propertyId: string;
  roomId: string;
  returnView: "tenant" | "room";
  canManageDocuments: boolean;
  documentResult?: string;
  documents: TenantDocumentView[];
  agreements: TenantAgreementHistoryView[];
};

const documentLabels: Record<string, string> = {
  ic_front: "IC Front",
  ic_back: "IC Back",
  passport_photo_page: "Passport Photo Page",
  commercial_supporting_document: "Trading Licence / Supporting Document",
};

const resultMessages: Record<string, { className: string; message: string }> = {
  uploaded: {
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    message: "Document uploaded and stored securely.",
  },
  invalid: {
    className: "border-red-200 bg-red-50 text-red-700",
    message: "Choose a document type and file before uploading.",
  },
  file_type: {
    className: "border-red-200 bg-red-50 text-red-700",
    message: "Use a JPG, PNG, WebP or PDF file no larger than 10 MB.",
  },
  upload: {
    className: "border-red-200 bg-red-50 text-red-700",
    message: "The document could not be uploaded. Please try again.",
  },
};

function agreementStatus(agreement: TenantAgreementHistoryView) {
  if (agreement.adminVerifiedAt) {
    return { label: "Verified", style: "verified" };
  }

  if (
    agreement.signedAt ||
    ["signed", "renewal_signed"].includes(agreement.status)
  ) {
    return {
      label: "Pending Admin Verification",
      style: "pending_verification",
    };
  }

  if (agreement.status === "pending_signature") {
    return { label: "Pending Signature", style: "pending_signature" };
  }

  if (agreement.status === "renewal_pending") {
    return { label: "Renewal Pending", style: "renewal_pending" };
  }

  return {
    label: agreement.status.replaceAll("_", " "),
    style: agreement.status,
  };
}

export function TenantDocuments({
  tenantKey,
  tenantRecordId,
  propertyId,
  roomId,
  returnView,
  canManageDocuments,
  documentResult,
  documents,
}: Omit<TenantRecordsProps, "agreements">) {
  const result = documentResult ? resultMessages[documentResult] : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileLock2 className="h-5 w-5 text-[#126b5f]" />
          <CardTitle>Tenant Documents</CardTitle>
        </div>
        <CardDescription>
          Private IC, passport and commercial supporting files. New uploads are
          stored as separate records and do not replace earlier files.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {result ? (
          <p className={`rounded-md border px-3 py-2 text-sm ${result.className}`}>
            {result.message}
          </p>
        ) : null}

        {canManageDocuments && tenantRecordId ? (
          <form
            action={uploadTenantDocument}
            className="grid gap-3 rounded-md border border-[#d7dde5] bg-[#f8fafb] p-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] md:items-end"
          >
            <input name="tenantKey" type="hidden" value={tenantKey} />
            <input name="tenantRecordId" type="hidden" value={tenantRecordId} />
            <input name="propertyId" type="hidden" value={propertyId} />
            <input name="roomId" type="hidden" value={roomId} />
            <input name="returnView" type="hidden" value={returnView} />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Document type
              </span>
              <select
                className="mt-2 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm"
                name="documentType"
                required
              >
                <option value="">Choose type</option>
                <option value="ic_front">IC Front</option>
                <option value="ic_back">IC Back</option>
                <option value="passport_photo_page">Passport Photo Page</option>
                <option value="commercial_supporting_document">
                  Trading Licence / Supporting Document
                </option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Photo or PDF
              </span>
              <input
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="mt-2 block h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
                name="document"
                required
                type="file"
              />
            </label>
            <Button className="h-10" type="submit">
              <Upload className="h-4 w-4" />
              Upload
            </Button>
          </form>
        ) : canManageDocuments ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This tenant needs a tenant record before documents can be uploaded.
          </p>
        ) : (
          <p className="text-sm text-gray-500">
            Identity and business documents are restricted to Admin and Super
            Admin.
          </p>
        )}

        {canManageDocuments ? (
          documents.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {documents.map((document) => (
                <div
                  className="min-w-0 rounded-md border border-[#d7dde5] p-4"
                  key={document.id}
                >
                  {document.signedUrl ? (
                    <DocumentPreview
                      contentType={document.contentType}
                      fileName={document.fileName}
                      label={
                        documentLabels[document.documentType]
                        ?? document.documentType.replaceAll("_", " ")
                      }
                      url={document.signedUrl}
                    />
                  ) : null}
                  <div className="mt-3 min-w-0">
                    <p className="font-medium text-gray-950">
                      {documentLabels[document.documentType] ??
                        document.documentType.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 truncate text-xs text-gray-500">
                      {document.fileName}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatMalaysiaDateTime(document.uploadedAt)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge
                        className={statusBadgeClass(
                          document.verificationStatus,
                        )}
                      >
                        {document.verificationStatus.replaceAll("_", " ")}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No identity or business documents have been uploaded yet.
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TenantAgreementHistory({
  agreements,
}: Pick<TenantRecordsProps, "agreements">) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#126b5f]" />
          <CardTitle>Tenancy Agreement History</CardTitle>
        </div>
        <CardDescription>
          Every term keeps its own agreement. Signed copies stay here
          permanently.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {agreements.length ? (
          <div className="space-y-3">
            {agreements.map((agreement, index) => {
              const displayStatus = agreementStatus(agreement);

              return (
                <div
                  className="flex flex-col justify-between gap-4 rounded-md border border-[#d7dde5] p-4 md:flex-row md:items-center"
                  key={agreement.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-950">
                        Term {agreements.length - index}
                      </p>
                      <Badge className={statusBadgeClass(displayStatus.style)}>
                        {displayStatus.label}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-gray-700">
                      {agreement.termStartDate
                        ? formatMalaysiaDate(agreement.termStartDate)
                        : "Start date not set"}{" "}
                      to{" "}
                      {agreement.termEndDate
                        ? formatMalaysiaDate(agreement.termEndDate)
                        : "Open-ended"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {agreement.propertyName ?? "Property"} /{" "}
                      {agreement.roomName ?? "Room"} /{" "}
                      {agreement.termType === "renewal"
                        ? "Renewal"
                        : "Original"}{" "}
                      v{agreement.versionNumber} /{" "}
                      {agreement.agreementType === "commercial_office"
                        ? "Commercial Office"
                        : "Residential Room"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Generated {formatMalaysiaDateTime(agreement.generatedAt)}
                      {agreement.signedAt
                        ? ` / Signed ${formatMalaysiaDateTime(agreement.signedAt)}`
                        : ""}
                      {agreement.adminVerifiedAt
                        ? ` / Verified ${formatMalaysiaDateTime(agreement.adminVerifiedAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/e-tenancy/${agreement.id}`}>
                        View Agreement
                      </Link>
                    </Button>
                    {agreement.signedPdfUrl ? (
                      <Button asChild size="sm">
                        <Link href={agreement.signedPdfUrl} target="_blank">
                          Signed PDF
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No tenancy agreement has been generated for this tenant yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgreementAppendixDocument } from "@/lib/tenancy/agreement-pdf";

type TenantDocumentRow = {
  id: string;
  document_type: string;
  file_path: string;
  file_name: string | null;
  content_type: string | null;
  verification_status: string;
  uploaded_at: string;
};

const documentLabels: Record<string, string> = {
  commercial_supporting_document: "Commercial Supporting Document",
  ic_back: "Identity Card - Back",
  ic_front: "Identity Card - Front",
  passport_photo_page: "Passport Photo Page",
  trading_license: "Trading Licence",
};

function inferredContentType(document: TenantDocumentRow) {
  if (document.content_type) {
    return document.content_type;
  }

  const extension = document.file_path.split(".").at(-1)?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "application/octet-stream";
}

export async function loadAgreementAppendixDocuments(
  supabase: SupabaseClient,
  {
    tenancyId,
    tenantProfileId,
  }: {
    tenancyId: string;
    tenantProfileId?: string | null;
  },
): Promise<AgreementAppendixDocument[]> {
  const { data: tenantRecords } = await supabase
    .from("tenant_records")
    .select("id")
    .eq("tenancy_id", tenancyId);
  const tenantRecordIds = (tenantRecords ?? []).map((record) => record.id);
  const documents: TenantDocumentRow[] = [];

  if (tenantRecordIds.length) {
    const { data } = await supabase
      .from("tenant_documents")
      .select(
        "id, document_type, file_path, file_name, content_type, verification_status, uploaded_at",
      )
      .in("tenant_record_id", tenantRecordIds)
      .neq("verification_status", "rejected")
      .order("uploaded_at", { ascending: true });
    documents.push(...((data ?? []) as TenantDocumentRow[]));
  }

  if (tenantProfileId) {
    const { data } = await supabase
      .from("tenant_documents")
      .select(
        "id, document_type, file_path, file_name, content_type, verification_status, uploaded_at",
      )
      .eq("tenant_id", tenantProfileId)
      .neq("verification_status", "rejected")
      .order("uploaded_at", { ascending: true });

    for (const document of (data ?? []) as TenantDocumentRow[]) {
      if (!documents.some((item) => item.file_path === document.file_path)) {
        documents.push(document);
      }
    }
  }

  const appendixDocuments: AgreementAppendixDocument[] = [];
  for (const document of documents) {
    const { data: file } = await supabase.storage
      .from("tenant-documents")
      .download(document.file_path);
    if (!file) {
      continue;
    }

    appendixDocuments.push({
      documentType: document.document_type,
      label:
        documentLabels[document.document_type] ??
        document.document_type.replaceAll("_", " "),
      fileName:
        document.file_name ??
        document.file_path.split("/").at(-1) ??
        "Tenant document",
      contentType: inferredContentType(document),
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }

  return appendixDocuments;
}

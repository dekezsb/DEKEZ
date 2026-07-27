import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantDocumentType =
  | "ic_front"
  | "ic_back"
  | "passport_photo_page"
  | "commercial_supporting_document";

export function formFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

export function isValidTenantDocument(file: File | null) {
  if (!file) return true;
  const allowedTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  return file.size <= 10 * 1024 * 1024 && allowedTypes.has(file.type);
}

export async function uploadTenantDocuments(
  supabase: SupabaseClient,
  actorId: string,
  batchId: string,
  documents: Array<{ documentType: TenantDocumentType; file: File }>,
) {
  const uploaded: Array<{
    content_type: string | null;
    document_type: TenantDocumentType;
    file_name: string;
    file_path: string;
  }> = [];

  for (const document of documents) {
    const safeName = document.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${actorId}/admin-registration/${batchId}/${document.documentType}-${safeName}`;
    const bytes = Buffer.from(await document.file.arrayBuffer());
    const { error } = await supabase.storage
      .from("tenant-documents")
      .upload(path, bytes, {
        contentType: document.file.type || "application/octet-stream",
        upsert: false,
      });

    if (error) {
      if (uploaded.length) {
        await supabase.storage
          .from("tenant-documents")
          .remove(uploaded.map((item) => item.file_path));
      }
      throw error;
    }

    uploaded.push({
      content_type: document.file.type || null,
      document_type: document.documentType,
      file_name: document.file.name,
      file_path: path,
    });
  }

  return uploaded;
}

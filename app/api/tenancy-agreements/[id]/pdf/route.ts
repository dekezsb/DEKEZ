import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { agreementPdfName } from "@/lib/tenancy/agreement-filename";
import { loadAgreementAppendixDocuments } from "@/lib/tenancy/agreement-appendix";
import { createAgreementPdf } from "@/lib/tenancy/agreement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  const role = await requireRole(
    ["super_admin", "admin", "owner", "tenant"],
    { module: "tenancy_agreements" },
  );
  const { id } = await params;
  const scopedClient =
    role === "super_admin" || role === "admin"
      ? createAdminClient()
      : await createClient();
  const { data: agreement, error: agreementError } = await scopedClient
    .from("tenancy_agreements")
    .select(
      "id, tenancy_id, rendered_content, status, signed_at, term_start_date, tenant_name_snapshot, property_name_snapshot, room_name_snapshot",
    )
    .eq("id", id)
    .maybeSingle();

  if (agreementError) {
    console.error("Unable to load tenancy agreement PDF.", {
      code: agreementError.code,
      message: agreementError.message,
    });
    return new Response("Unable to load agreement PDF.", { status: 500 });
  }

  if (!agreement) {
    return new Response("Agreement not found.", { status: 404 });
  }

  const admin = createAdminClient();
  const { data: tenancy } = await admin
    .from("tenancies")
    .select("tenant_id, property_id, room_id")
    .eq("id", agreement.tenancy_id)
    .maybeSingle();
  const [{ data: tenant }, { data: property }, { data: room }] =
    await Promise.all([
      tenancy?.tenant_id
        ? admin
            .from("tenants")
            .select("full_name, profile_id")
            .eq("id", tenancy.tenant_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      tenancy?.property_id
        ? admin
            .from("properties")
            .select("property_code, name")
            .eq("id", tenancy.property_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      tenancy?.room_id
        ? admin
            .from("rooms")
            .select("room_number, name")
            .eq("id", tenancy.room_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
  const { data: signatureRecord } = await admin
    .from("tenancy_agreement_signatures")
    .select("signature_url, signed_at")
    .eq("agreement_id", agreement.id)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let signatureBytes: Uint8Array | null = null;

  if (signatureRecord?.signature_url) {
    const { data: signatureFile } = await admin.storage
      .from("tenancy-signatures")
      .download(signatureRecord.signature_url);
    if (signatureFile) {
      signatureBytes = new Uint8Array(await signatureFile.arrayBuffer());
    }
  }
  const appendixDocuments = tenancy
    ? await loadAgreementAppendixDocuments(admin, {
        tenancyId: agreement.tenancy_id,
        tenantProfileId: tenant?.profile_id,
      })
    : [];

  const signerName =
    agreement.status === "signed" || agreement.status === "renewal_signed"
      ? agreement.tenant_name_snapshot ?? tenant?.full_name ?? "Tenant"
      : null;
  const pdfBytes = await createAgreementPdf({
    content: agreement.rendered_content,
    signerName,
    signedAt: signatureRecord?.signed_at ?? agreement.signed_at,
    tenantSignatureBytes: signatureBytes,
    appendixDocuments,
  });
  const filename = agreementPdfName({
    tenantName: agreement.tenant_name_snapshot ?? tenant?.full_name,
    propertyCode:
      property?.property_code ??
      agreement.property_name_snapshot ??
      property?.name,
    roomNumber:
      agreement.room_name_snapshot ?? room?.room_number ?? room?.name,
    termStartDate: agreement.term_start_date,
  });

  return new Response(Buffer.from(pdfBytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

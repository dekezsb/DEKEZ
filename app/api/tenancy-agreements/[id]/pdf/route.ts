import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { agreementPdfName } from "@/lib/tenancy/agreement-filename";
import { createAgreementPdf } from "@/lib/tenancy/agreement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }>;
};

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function GET(_request: Request, { params }: RouteProps) {
  const role = await requireRole(
    ["super_admin", "admin", "owner", "tenant"],
    { module: "tenancy_agreements" },
  );
  const { id } = await params;
  const scopedClient =
    role === "super_admin" ? createAdminClient() : await createClient();
  const { data: agreement } = await scopedClient
    .from("tenancy_agreements")
    .select(
      "id, rendered_content, status, signed_at, term_start_date, tenant_name_snapshot, property_name_snapshot, room_name_snapshot, tenancies(tenants(full_name), properties(property_code, name), rooms(room_number, name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!agreement) {
    return new Response("Agreement not found.", { status: 404 });
  }

  const tenancy = single(agreement.tenancies);
  const tenant = single(tenancy?.tenants);
  const property = single(tenancy?.properties);
  const room = single(tenancy?.rooms);
  const admin = createAdminClient();
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

  const signerName =
    agreement.status === "signed" || agreement.status === "renewal_signed"
      ? agreement.tenant_name_snapshot ?? tenant?.full_name ?? "Tenant"
      : null;
  const pdfBytes = await createAgreementPdf({
    content: agreement.rendered_content,
    signerName,
    signedAt: signatureRecord?.signed_at ?? agreement.signed_at,
    tenantSignatureBytes: signatureBytes,
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

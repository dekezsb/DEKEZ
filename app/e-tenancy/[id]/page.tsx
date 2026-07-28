import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import {
  formatMalaysiaDate,
  formatMalaysiaDateTime,
} from "@/lib/date-format";
import { statusBadgeClass } from "@/lib/status-styles";
import { agreementTypeLabel } from "@/lib/tenancy/agreement-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { signAgreement } from "../actions";
import { TenantSignatureForm } from "../tenant-signature-form";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; signed?: string; print?: string }>;
};

export default async function AgreementDetailPage({ params, searchParams }: PageProps) {
  const role = await requireRole(["super_admin", "owner", "admin", "tenant"]);
  const { id } = await params;
  const query = await searchParams;
  const supabase =
    role === "super_admin" || role === "admin"
      ? createAdminClient()
      : await createClient();
  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .select("id, tenancy_id, term_type, agreement_type, version_number, status, rendered_content, signed_at, pdf_url, generated_at, term_start_date, term_end_date, tenant_name_snapshot, property_name_snapshot, room_name_snapshot, retention_until")
    .eq("id", id)
    .single();

  if (!agreement) {
    return (
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Agreement not found</CardTitle>
            <CardDescription>This agreement is unavailable or you do not have access.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/e-tenancy">Back</Link></Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("tenant_id, tenancy_start_date, tenancy_end_date, contract_duration_months, properties(name), rooms!tenancies_room_id_fkey(name, room_number)")
    .eq("id", agreement.tenancy_id)
    .maybeSingle();
  const property = Array.isArray(tenancy?.properties) ? tenancy?.properties[0] : tenancy?.properties;
  const room = Array.isArray(tenancy?.rooms) ? tenancy?.rooms[0] : tenancy?.rooms;
  const canSign =
    role === "tenant" &&
    ["pending_signature", "renewal_pending", "renewal_sent"].includes(
      agreement.status,
    );
  const backPath =
    role === "tenant" ? "/e-tenancy" : "/tenancy-agreements";
  const pdfPath = `/api/tenancy-agreements/${agreement.id}/pdf`;
  const signingErrors: Record<string, string> = {
    agreement_unavailable:
      "This agreement is no longer available for signing. Please contact DEKEZ.",
    already_signed: "This agreement has already been signed.",
    configuration:
      "Signing is temporarily unavailable. Please contact DEKEZ support.",
    pdf_generation:
      "The signed PDF could not be prepared. Your agreement was not changed. Please try again.",
    save_failed:
      "Your signature could not be saved. Your agreement was not changed. Please try again.",
    signature_invalid:
      "The signature could not be read. Clear the box and sign again.",
    signature_missing:
      "Please accept the agreement and draw your signature before signing.",
    upload_failed:
      "The signature could not be uploaded. Please check your connection and try again.",
  };

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">E-Tenancy Agreement</p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">{agreement.property_name_snapshot ?? property?.name ?? "Tenancy Agreement"}</h1>
            <p className="mt-2 text-sm text-gray-600">
              Room {agreement.room_name_snapshot ?? room?.room_number ?? room?.name ?? "-"} -{" "}
              {agreement.term_type === "renewal" ? "Renewal" : "Original"}{" "}
              term v{agreement.version_number} -{" "}
              {agreementTypeLabel(agreement.agreement_type)}
            </p>
          </div>
          <Badge className={statusBadgeClass(agreement.status)}>{agreement.status}</Badge>
        </div>
      </div>

      {query.signed === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Agreement signed successfully.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {signingErrors[query.error] ??
            "The agreement could not be signed. Please try again."}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Agreement Summary</CardTitle>
          <CardDescription>Generated {formatMalaysiaDateTime(agreement.generated_at)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
          <p>Start: {formatMalaysiaDate(agreement.term_start_date ?? tenancy?.tenancy_start_date)}</p>
          <p>End: {formatMalaysiaDate(agreement.term_end_date ?? tenancy?.tenancy_end_date)}</p>
          <p>Signed: {formatMalaysiaDateTime(agreement.signed_at)}</p>
          <p>Keep until: {formatMalaysiaDate(agreement.retention_until)}</p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button asChild size="sm" variant="outline">
              <Link href={backPath}>Back to archive</Link>
            </Button>
            <Button asChild size="sm">
              <a href={pdfPath} rel="noreferrer" target="_blank">
                Open PDF / Print
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenancy Agreement PDF</CardTitle>
          <CardDescription>
            Professional A4 copy with the DEKEZ company details, authorised
            signature and company chop.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <iframe
            className="h-[76vh] min-h-[720px] w-full rounded-md border border-[#d7dde5] bg-white"
            src={`${pdfPath}#toolbar=1&navpanes=0`}
            title={`Tenancy agreement for ${agreement.tenant_name_snapshot ?? "tenant"}`}
          />
          <p className="text-xs text-gray-500">
            Use Open PDF / Print if your phone does not display the embedded
            preview.
          </p>
        </CardContent>
      </Card>

      {canSign ? (
        <Card>
          <CardHeader>
            <CardTitle>Tenant Digital Signature</CardTitle>
            <CardDescription>
              Read the agreement, confirm your acceptance, then sign using your
              finger. Your signed copy will be locked and stored permanently.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TenantSignatureForm
              agreementId={agreement.id}
              action={signAgreement}
            />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

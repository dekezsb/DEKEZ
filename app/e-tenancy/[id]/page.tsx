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
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { signAgreement } from "../actions";
import { SignaturePad } from "../signature-pad";

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
    .select("id, tenancy_id, agreement_type, version_number, status, rendered_content, signed_at, pdf_url, generated_at, term_start_date, term_end_date, tenant_name_snapshot, property_name_snapshot, room_name_snapshot, retention_until")
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

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">E-Tenancy Agreement</p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">{agreement.property_name_snapshot ?? property?.name ?? "Tenancy Agreement"}</h1>
            <p className="mt-2 text-sm text-gray-600">
              Room {agreement.room_name_snapshot ?? room?.room_number ?? room?.name ?? "-"} -{" "}
              {agreement.agreement_type === "renewal" ? "Renewal" : "Original"}{" "}
              term v{agreement.version_number}
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
          Please confirm the agreement and draw your signature before signing.
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
            <CardDescription>Your signed agreement will be locked and stored permanently.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={signAgreement} className="space-y-4">
              <input name="agreementId" type="hidden" value={agreement.id} />
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input className="mt-1" name="confirmAgreement" type="checkbox" />
                I confirm that I have read and agree to the tenancy agreement.
              </label>
              <SignaturePad />
              <Button type="submit">Sign agreement</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

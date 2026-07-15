import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { plainTextToHtml } from "@/lib/e-tenancy";
import { statusBadgeClass } from "@/lib/status-styles";
import { createClient } from "@/lib/supabase/server";
import { signAgreement } from "../actions";
import { SignaturePad } from "../signature-pad";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; signed?: string }>;
};

export default async function AgreementDetailPage({ params, searchParams }: PageProps) {
  const role = await requireRole(["super_admin", "owner", "admin", "tenant"]);
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .select("id, status, rendered_content, signed_at, pdf_url, generated_at, tenancies(tenant_id, tenancy_start_date, tenancy_end_date, contract_duration_months, properties(name), rooms(name))")
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

  const tenancy = Array.isArray(agreement.tenancies) ? agreement.tenancies[0] : agreement.tenancies;
  const property = Array.isArray(tenancy?.properties) ? tenancy?.properties[0] : tenancy?.properties;
  const room = Array.isArray(tenancy?.rooms) ? tenancy?.rooms[0] : tenancy?.rooms;
  const canSign = role === "tenant" && agreement.status === "pending_signature";

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">E-Tenancy Agreement</p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">{property?.name ?? "Tenancy Agreement"}</h1>
            <p className="mt-2 text-sm text-gray-600">
              {room?.name ?? "Room"} - {tenancy?.contract_duration_months ?? "-"} months
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
          <CardDescription>Generated {new Date(agreement.generated_at).toLocaleString("en-MY")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
          <p>Start: {tenancy?.tenancy_start_date ?? "-"}</p>
          <p>End: {tenancy?.tenancy_end_date ?? "-"}</p>
          <p>Signed: {agreement.signed_at ? new Date(agreement.signed_at).toLocaleString("en-MY") : "-"}</p>
          <p>PDF: {agreement.pdf_url ? agreement.pdf_url : "Not signed yet"}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review Agreement</CardTitle>
          <CardDescription>Read the full agreement before signing.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="prose max-w-none rounded-lg border border-[#d7dde5] bg-white p-5 text-sm leading-7"
            dangerouslySetInnerHTML={{ __html: plainTextToHtml(agreement.rendered_content) }}
          />
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

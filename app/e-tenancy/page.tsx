import { Link } from "@/components/app-link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import {
  formatMalaysiaDate,
  formatMalaysiaDateTime,
} from "@/lib/date-format";
import { loadTenancyAgreementArchive } from "@/lib/data/tenancy-agreements";
import { statusBadgeClass } from "@/lib/status-styles";
import { agreementTypeLabel } from "@/lib/tenancy/agreement-types";
import { createClient } from "@/lib/supabase/server";

export default async function ETenancyPage() {
  const role = await requireRole(["super_admin", "owner", "admin", "tenant"]);

  if (role !== "tenant") {
    redirect("/tenancy-agreements");
  }

  return <TenantAgreementList />;
}

async function TenantAgreementList() {
  const supabase = await createClient();
  const archive = await loadTenancyAgreementArchive(supabase);
  const agreements = archive.agreements;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">
          Tenant Portal
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          My Tenancy Agreements
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Every tenancy term keeps its own agreement. Signed copies remain in
          this history permanently.
        </p>
      </div>

      <div className="grid gap-4">
        {agreements.map((agreement) => {
          const signatureRejected = Boolean(agreement.admin_rejected_at);
          const tenancy = Array.isArray(agreement.tenancies)
            ? agreement.tenancies[0]
            : agreement.tenancies;
          const property = Array.isArray(tenancy?.properties)
            ? tenancy?.properties[0]
            : tenancy?.properties;
          const room = Array.isArray(tenancy?.rooms)
            ? tenancy?.rooms[0]
            : tenancy?.rooms;

          return (
            <Card
              className={signatureRejected ? "border-red-200 bg-red-50/40" : ""}
              key={agreement.id}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>
                      {agreement.property_name_snapshot ??
                        property?.name ??
                        "Tenancy Agreement"}
                    </CardTitle>
                    <CardDescription>
                      {agreement.room_name_snapshot ??
                        room?.room_number ??
                        room?.name ??
                        "Room"}{" "}
                      -{" "}
                      {agreement.term_type === "renewal"
                        ? "Renewal"
                        : "Original"}{" "}
                      term v{agreement.version_number} -{" "}
                      {agreementTypeLabel(agreement.agreement_type)}
                    </CardDescription>
                  </div>
                  <Badge
                    className={
                      signatureRejected
                        ? "bg-red-100 text-red-700"
                        : statusBadgeClass(agreement.status)
                    }
                  >
                    {signatureRejected
                      ? "signature rejected"
                      : agreement.status.replaceAll("_", " ")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
                <p>Start: {formatMalaysiaDate(agreement.term_start_date)}</p>
                <p>End: {formatMalaysiaDate(agreement.term_end_date)}</p>
                <p>
                  Generated: {formatMalaysiaDateTime(agreement.generated_at)}
                </p>
                <p>Signed: {formatMalaysiaDateTime(agreement.signed_at)}</p>
                {signatureRejected ? (
                  <div className="rounded-md border border-red-200 bg-white px-3 py-2 text-red-700 sm:col-span-2">
                    <p className="font-semibold">
                      Admin did not accept this signed copy.
                    </p>
                    <p className="mt-1">
                      Reason: {agreement.admin_rejection_reason}
                    </p>
                    {agreement.replacement_agreement_id ? (
                      <p className="mt-1">
                        Please open and sign the replacement agreement.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <Button asChild className="sm:col-span-2">
                  <Link
                    href={
                      signatureRejected && agreement.replacement_agreement_id
                        ? `/e-tenancy/${agreement.replacement_agreement_id}`
                        : `/e-tenancy/${agreement.id}`
                    }
                  >
                    {signatureRejected && agreement.replacement_agreement_id
                      ? "Open replacement and sign again"
                      : [
                            "pending_signature",
                            "renewal_pending",
                            "renewal_sent",
                          ].includes(agreement.status)
                        ? "Review and sign"
                        : "View agreement"}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}

        {!agreements.length ? (
          <Card>
            <CardHeader>
              <FileText className="h-5 w-5 text-[#126b5f]" />
              <CardTitle>No tenancy agreement yet</CardTitle>
              <CardDescription>
                Admin will prepare your agreement after your tenancy is ready.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>
    </section>
  );
}

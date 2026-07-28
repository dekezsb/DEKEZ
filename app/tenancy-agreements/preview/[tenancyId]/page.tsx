import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { agreementTypeForProperty } from "@/lib/tenancy/agreement-types";
import { loadPropertyTenancySettings } from "@/lib/tenancy/property-settings";
import { confirmAgreementGeneration } from "./actions";
import { AgreementPreviewForm } from "./agreement-preview-form";

type PageProps = {
  params: Promise<{ tenancyId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function AgreementPreviewPage({
  params,
  searchParams,
}: PageProps) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const { tenancyId } = await params;
  const query = await searchParams;
  const supabase = createAdminClient();
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, tenant_id, property_id, room_id")
    .eq("id", tenancyId)
    .maybeSingle();

  if (!tenancy) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tenancy not found</CardTitle>
          <CardDescription>
            This tenancy is unavailable or has already been removed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/verification?view=tenancy">Back to Verification</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const [tenantResult, propertyResult, roomResult] = await Promise.all([
    supabase
      .from("tenants")
      .select("full_name, tenant_type")
      .eq("id", tenancy.tenant_id)
      .maybeSingle(),
    supabase
      .from("properties")
      .select("name, is_commercial")
      .eq("id", tenancy.property_id)
      .maybeSingle(),
    tenancy.room_id
      ? supabase
          .from("rooms")
          .select("name, room_number")
          .eq("id", tenancy.room_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const tenant = tenantResult.data;
  const property = propertyResult.data;
  const room = roomResult.data;

  if (!tenant || !property) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agreement details incomplete</CardTitle>
          <CardDescription>
            The tenant or property record is missing from this tenancy.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const settings = await loadPropertyTenancySettings(
    supabase,
    tenancy.property_id,
    property.is_commercial,
  );

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <Button asChild className="px-0" variant="ghost">
        <Link href="/verification?view=tenancy">
          <ArrowLeft className="h-4 w-4" />
          Back to Verification
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Agreement Preview</CardTitle>
          <CardDescription>
            Confirm the agreement type selected from the property Commercial
            setting and review the property-specific wording before creating the
            PDF.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {query.error ? (
            <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {query.error === "confirm"
                ? "Confirm the agreement preview before generating it."
                : "The agreement could not be generated. Check the tenancy details and try again."}
            </div>
          ) : null}
          <AgreementPreviewForm
            action={confirmAgreementGeneration}
            agreementType={agreementTypeForProperty(property.is_commercial)}
            propertyName={property.name}
            roomName={room?.room_number ?? room?.name ?? "Room"}
            settings={settings}
            tenantName={tenant.full_name}
            tenantType={tenant.tenant_type ?? "individual"}
            tenancyId={tenancy.id}
          />
        </CardContent>
      </Card>
    </section>
  );
}

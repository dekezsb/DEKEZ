import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getProperties, getRooms } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { submitAdminTenantApplication } from "./actions";
import { RegistrationForm } from "./registration-form";

type PageProps = {
  searchParams: Promise<{
    error?: string;
    property?: string;
    room?: string;
    submitted?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Complete all required tenant, room and contract fields.",
  dates: "Contract end date cannot be earlier than the contract start date.",
  document: "Upload both IC sides, or upload the passport photo page.",
  commercial_document:
    "This commercial property requires a trading licence or supporting document.",
  upload: "One or more documents could not be uploaded. Check the file type and size.",
  property: "The selected property is not available to your account.",
  occupied: "That room is no longer vacant. Choose another room.",
  pending: "That room already has a tenant application awaiting review.",
  submit: "The tenant application could not be submitted.",
};

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export default async function RegisterTenantPage({ searchParams }: PageProps) {
  await requireRole(["super_admin", "admin"]);
  const params = await searchParams;
  const supabase = await getAdmin();
  const [properties, rooms, pendingResult] = await Promise.all([
    getProperties(),
    getRooms(),
    supabase
      .from("tenant_applications")
      .select("room_id")
      .in("status", ["submitted", "pending_verification", "approved"]),
  ]);
  const pendingRoomIds = new Set(
    (pendingResult.data ?? []).map((application) => application.room_id),
  );
  const availableRooms = rooms.filter(
    (room) => room.status === "vacant" && !pendingRoomIds.has(room.id),
  );

  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase text-[#8ba0bf]">
          Current Page
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[#07142f]">
          Register New Tenant
        </h1>
      </div>

      <Button
        asChild
        className="w-fit px-0 text-[#496386] hover:bg-transparent hover:text-[#07142f]"
        variant="ghost"
      >
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Back to Dashboard
        </Link>
      </Button>

      {params.submitted === "1" ? (
        <div className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" />
            <p>
              Tenant registration submitted. The room will be assigned after
              approval in Verification.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/verification?view=tenants">Open Verification</Link>
          </Button>
        </div>
      ) : null}

      {params.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMessages[params.error] ?? "Unable to submit the registration."}
        </div>
      ) : null}

      <Card className="rounded-lg border-[#d7dde5] shadow-sm">
        <CardHeader className="border-b border-[#e3e8ef]">
          <CardTitle className="text-xl">Register New Tenant</CardTitle>
          <p className="max-w-2xl text-sm leading-6 text-[#60708a]">
            Enter the tenant details and choose a vacant room. An Admin must
            approve the application in Verification before the room is
            assigned.
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {properties.length ? (
            <RegistrationForm
              action={submitAdminTenantApplication}
              initialPropertyId={params.property}
              initialRoomId={params.room}
              properties={properties.map((property) => ({
                id: property.id,
                label: property.name,
                isCommercial: property.is_commercial,
              }))}
              rooms={availableRooms.map((room) => ({
                id: room.id,
                propertyId: room.property_id,
                roomNumber: room.room_number || room.name,
                monthlyRent: room.monthly_rent,
              }))}
            />
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-[#60708a]">
                No properties are available to your account.
              </p>
              <Button asChild className="mt-4" variant="outline">
                <Link href="/properties">Open Properties</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

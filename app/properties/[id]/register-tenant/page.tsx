import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getPropertyDetails } from "@/lib/data/property-details";
import { registerTenant } from "../actions";
import { RegistrationForm } from "./registration-form";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string; error?: string }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please complete the required tenant and check-in information.",
  document: "Upload IC front and back, or upload the passport photo page.",
  commercial_document: "This commercial-title property requires a trading licence or supporting business document.",
  upload: "The tenant documents could not be uploaded.",
  occupied: "That room is no longer vacant. Choose another room.",
  tenant: "The tenant record could not be created.",
  tenancy: "The tenancy could not be created.",
};

export default async function RegisterTenantPage({ params, searchParams }: PageProps) {
  await requireRole(["super_admin", "admin"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const details = await getPropertyDetails(id);
  const vacantRooms = details.rooms
    .filter((room) => room.status === "vacant" && !room.tenantName)
    .map((room) => ({ id: room.id, roomNumber: room.roomNumber, monthlyRent: room.monthlyRent }));

  return (
    <section className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-500" aria-label="Breadcrumb">
        <Link href="/properties">Properties</Link>
        <ChevronRight className="h-4 w-4" />
        <Link href={`/properties/${id}`}>{details.property.name}</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-gray-950">Register New Tenant</span>
      </nav>

      <div>
        <p className="text-xs font-semibold uppercase text-[#b17f19]">Tenant Check-In</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Register New Tenant</h1>
        <p className="mt-2 text-sm text-gray-600">The property is fixed. Only vacant rooms can be selected.</p>
      </div>

      {query.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMessages[query.error] ?? "Tenant registration could not be completed."}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tenant and Tenancy</CardTitle>
          <CardDescription>Creates the tenancy, first recurring bill, room occupancy, and a draft agreement.</CardDescription>
        </CardHeader>
        <CardContent>
          {vacantRooms.length ? (
            <RegistrationForm
              action={registerTenant}
              isCommercial={details.property.isCommercial}
              propertyId={id}
              propertyName={details.property.name}
              rooms={vacantRooms}
              selectedRoomId={query.room}
            />
          ) : (
            <p className="text-sm text-gray-600">There are no vacant rooms in this property.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

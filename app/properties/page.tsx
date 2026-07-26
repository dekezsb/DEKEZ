import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import {
  getFirstCompany,
  getProperties,
  getPropertyOwnerData,
  getRooms,
} from "@/lib/data/organization";
import { createProperty } from "./actions";
import { PropertyOwnerSelect } from "./property-owner-select";

type PropertiesPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
    updated?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please enter the property name and address.",
  create: "Property could not be saved. Please try again.",
  owner_assign: "The Owner could not be assigned. Check that the account is an active Owner for this company.",
  owner_missing: "Please select an Owner.",
};

export default async function PropertiesPage({ searchParams }: PropertiesPageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const [properties, company, params] = await Promise.all([
    getProperties(),
    getFirstCompany(),
    searchParams,
  ]);
  const [rooms, ownerData] = await Promise.all([
    getRooms(),
    getPropertyOwnerData(properties),
  ]);
  const roomCounts = new Map<string, { total: number; occupied: number }>();
  const assignedOwners = new Map(
    ownerData.assignments.map((assignment) => [
      assignment.property_id,
      assignment.owner_id,
    ]),
  );

  for (const room of rooms) {
    const current = roomCounts.get(room.property_id) ?? { total: 0, occupied: 0 };
    current.total += 1;
    current.occupied += room.status === "occupied" ? 1 : 0;
    roomCounts.set(room.property_id, current);
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#126b5f]">Portfolio</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Properties</h1>
          <p className="mt-2 text-sm text-gray-600">
            Live property records from Supabase.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/setup">Owner setup</Link>
        </Button>
      </div>

      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Property saved successfully.
        </div>
      ) : null}
      {params.updated === "owner" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Property Owner updated successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Property could not be saved."}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add Property</CardTitle>
          <CardDescription>
            Create another property or location under your company.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {company ? (
            <form action={createProperty} className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Property name</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="name"
                  placeholder="Main House"
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Address/location</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="address"
                  placeholder="Kuala Lumpur"
                  required
                />
              </label>
              <label className="block lg:min-w-48">
                <span className="text-sm font-medium text-gray-700">Notes optional</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="notes"
                />
              </label>
              <Button className="lg:col-start-3" type="submit">
                Add property
              </Button>
            </form>
          ) : (
            <p className="text-sm text-gray-500">
              Complete Owner setup first before adding properties.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Managed Properties</CardTitle>
          <CardDescription>
            Assign an Owner to control which properties appear in their account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {properties.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Rooms</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Open</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((property) => (
                  <TableRow key={property.id}>
                    <TableCell className="font-medium text-gray-950">
                      <Link className="hover:text-[#126b5f]" href={`/properties/${property.id}`}>
                        {property.name}
                      </Link>
                    </TableCell>
                    <TableCell>{property.address}</TableCell>
                    <TableCell>
                      {roomCounts.get(property.id)?.occupied ?? 0} / {roomCounts.get(property.id)?.total ?? 0} occupied
                    </TableCell>
                    <TableCell>
                      <PropertyOwnerSelect
                        currentOwnerId={assignedOwners.get(property.id) ?? null}
                        owners={ownerData.owners
                          .filter((owner) => owner.company_id === property.company_id)
                          .map((owner) => ({ id: owner.id, name: owner.name }))}
                        propertyId={property.id}
                        propertyName={property.name}
                      />
                    </TableCell>
                    <TableCell>
                      <Button asChild size="icon" variant="ghost">
                        <Link aria-label={`Open ${property.name}`} href={`/properties/${property.id}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">
              No properties yet. Use Owner setup to create your first property.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

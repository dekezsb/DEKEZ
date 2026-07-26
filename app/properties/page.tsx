import Link from "next/link";
import { Building2, ChevronRight, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import {
  getFirstCompany,
  getProperties,
  getPropertyOwnerData,
  getRooms,
} from "@/lib/data/organization";
import { createProperty } from "./actions";
import { PropertyCommercialToggle } from "./property-commercial-toggle";
import { PropertyOwnerSelect } from "./property-owner-select";

type PropertiesPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
    updated?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Enter the property code, area, address and a room count from 1 to 10,000.",
  create: "Property could not be saved. Check that the code is not already in use.",
  owner_assign: "The Owner could not be assigned. Check that the account is an active Owner for this company.",
  owner_missing: "Please select an Owner.",
  commercial: "The commercial-title setting could not be saved.",
};

function inputClass() {
  return "mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20";
}

export default async function PropertiesPage({ searchParams }: PropertiesPageProps) {
  const role = await requireRole(["super_admin", "owner", "admin"]);
  const canManage = role === "super_admin" || role === "admin";
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
  const ownerNames = new Map(ownerData.owners.map((owner) => [owner.id, owner.name]));

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
            {canManage
              ? "Create properties, assign Owners and manage room inventory."
              : "View the properties assigned to your Owner account."}
          </p>
        </div>
        {canManage ? (
          <Button asChild variant="outline">
            <Link href="/admin-setup">Manage Owner Accounts</Link>
          </Button>
        ) : null}
      </div>

      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Property and numbered rooms created successfully.
        </div>
      ) : null}
      {params.updated === "owner" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Property Owner updated successfully.
        </div>
      ) : null}
      {params.updated === "commercial" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Commercial-title requirement updated successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Property could not be saved."}
        </div>
      ) : null}

      {canManage ? (
        <Card className="mx-auto w-full max-w-5xl">
          <CardHeader>
            <CardTitle>Add Property</CardTitle>
            <CardDescription>
              Rooms are created automatically as Room 1, Room 2, Room 3 and so on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {company ? (
              <form action={createProperty} className="grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Property code</span>
                  <input className={`${inputClass()} uppercase`} name="propertyCode" placeholder="DGG" required />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Area</span>
                  <input className={inputClass()} name="area" placeholder="Donggongon" required />
                </label>
                <label className="block lg:col-span-2">
                  <span className="text-sm font-medium text-gray-700">Full address</span>
                  <input
                    className={inputClass()}
                    name="address"
                    placeholder="Lot 1, Jalan Example, 89500 Penampang, Sabah"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Number of rooms</span>
                  <input
                    className={inputClass()}
                    max="10000"
                    min="1"
                    name="roomCount"
                    placeholder="15"
                    required
                    type="number"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Assign Owner optional</span>
                  <select className={inputClass()} defaultValue="" name="ownerId">
                    <option value="">Unassigned</option>
                    {ownerData.owners
                      .filter((owner) => owner.company_id === company.id)
                      .map((owner) => (
                        <option key={owner.id} value={owner.id}>{owner.name}</option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-3 rounded-md border border-[#d7dde5] bg-gray-50 px-4 py-3 lg:col-span-2">
                  <input className="h-4 w-4 accent-[#b98a29]" name="isCommercial" type="checkbox" />
                  <span>
                    <span className="block text-sm font-medium text-gray-950">Commercial title</span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      Tenants must also provide a trading licence or supporting business document.
                    </span>
                  </span>
                </label>
                <div className="lg:col-span-2">
                  <Button type="submit">Add Property</Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-gray-500">
                Create or assign a company in Admin Setup before adding properties.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="mx-auto flex w-full max-w-5xl items-start gap-3 rounded-md border border-[#d7dde5] bg-white px-4 py-3 text-sm text-gray-600">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-[#126b5f]" />
          <p>
            Owner access is view-only. You can see only the properties assigned to your Owner account.
          </p>
        </div>
      )}

      <Card className="mx-auto w-full max-w-5xl">
        <CardHeader>
          <CardTitle>Property List</CardTitle>
          <CardDescription>
            {canManage
              ? "Open a property to manage its rooms and tenants. Assign an Owner to control which properties they can view."
              : "Open an assigned property to view its rooms, tenants and current rental information."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {properties.length ? (
            <div className="divide-y divide-[#e5e9ef]">
              {properties.map((property) => {
                const counts = roomCounts.get(property.id) ?? { total: 0, occupied: 0 };
                const ownerId = assignedOwners.get(property.id) ?? null;
                return (
                  <div
                    className="grid gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[72px_minmax(0,1fr)_220px_40px] md:items-center"
                    key={property.id}
                  >
                    <div className="flex items-center md:justify-center">
                      {canManage ? (
                        <PropertyCommercialToggle
                          isCommercial={property.is_commercial}
                          propertyId={property.id}
                          propertyName={property.name}
                        />
                      ) : (
                        <span className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase ${
                          property.is_commercial
                            ? "bg-[#f6ecd2] text-[#8a6111]"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {property.is_commercial ? "Commercial" : "Residential"}
                        </span>
                      )}
                    </div>
                    <Link className="group min-w-0" href={`/properties/${property.id}`}>
                      <span className="flex flex-wrap items-center gap-2 font-semibold text-gray-950 group-hover:text-[#126b5f]">
                        <Building2 className="h-4 w-4 shrink-0" />
                        {property.name}
                        {property.is_commercial ? (
                          <span className="rounded-full bg-[#f6ecd2] px-2 py-0.5 text-[10px] font-medium text-[#8a6111]">
                            Commercial title
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-sm leading-5 text-gray-500">
                        {property.address || property.area || "Address not added"} · {counts.total} rooms · {counts.occupied} occupied
                      </span>
                    </Link>
                    <div>
                      {canManage ? (
                        <PropertyOwnerSelect
                          currentOwnerId={ownerId}
                          owners={ownerData.owners
                            .filter((owner) => owner.company_id === property.company_id)
                            .map((owner) => ({ id: owner.id, name: owner.name }))}
                          propertyId={property.id}
                          propertyName={property.name}
                        />
                      ) : (
                        <div>
                          <p className="text-[11px] font-semibold uppercase text-gray-500">Owner</p>
                          <p className="mt-1 text-sm font-medium text-gray-950">
                            {ownerId ? ownerNames.get(ownerId) ?? "Assigned Owner" : "Unassigned"}
                          </p>
                        </div>
                      )}
                    </div>
                    <Button asChild size="icon" variant="ghost">
                      <Link aria-label={`Open ${property.name}`} href={`/properties/${property.id}`}>
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              {canManage
                ? "No properties yet. Use Add Property to create the first one."
                : "No properties are assigned to this Owner account yet."}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

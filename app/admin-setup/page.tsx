import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getProperties, getRooms } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";
import {
  assignPropertyOwner,
  assignTenantTenancy,
  createPortalUser,
  createUnit,
} from "./actions";

type AdminSetupPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
    message?: string;
  }>;
};

const successMessages: Record<string, string> = {
  user: "User account created successfully.",
  unit: "Unit created successfully.",
  owner: "Property owner assigned successfully.",
  tenancy: "Tenant assigned to room successfully.",
};

const errorMessages: Record<string, string> = {
  service_key: "Missing Supabase service role key in Vercel. Add SUPABASE_SERVICE_ROLE_KEY first.",
  user_missing: "Please fill in the required user fields.",
  user_create: "User could not be created.",
  unit_missing: "Please choose a property and enter a unit name.",
  unit_create: "Unit could not be created.",
  property_missing: "Selected property was not found.",
  owner_missing: "Please choose a property and owner.",
  owner_assign: "Owner could not be assigned to this property.",
  tenancy_missing: "Please choose tenant, room, contract start date and due day.",
  room_missing: "Selected room was not found.",
  tenancy_create: "Tenancy could not be created.",
};

export default async function AdminSetupPage({ searchParams }: AdminSetupPageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const params = await searchParams;
  const supabase = await createClient();
  const [properties, rooms, profilesResult, unitsResult, tenanciesResult] = await Promise.all([
    getProperties(),
    getRooms(),
    supabase
      .from("profiles")
      .select("id, full_name, phone, role")
      .order("created_at", { ascending: false }),
    supabase
      .from("units")
      .select("id, name, floor, property_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("tenancies")
      .select("id, tenant_id, room_id, monthly_rental, contract_start, contract_end, status")
      .order("created_at", { ascending: false }),
  ]);

  const profiles = profilesResult.data ?? [];
  const owners = profiles.filter((profile) => profile.role === "owner");
  const tenants = profiles.filter((profile) => profile.role === "tenant");
  const units = unitsResult.data ?? [];
  const tenancies = tenanciesResult.data ?? [];
  const propertyById = new Map(properties.map((property) => [property.id, property.name]));
  const roomById = new Map(rooms.map((room) => [room.id, room.name]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile.full_name ?? profile.id]));

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Admin Control</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Admin Setup & Assignment
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Create role accounts, build property structure, assign owners, and create tenant tenancies.
        </p>
      </div>

      {params.created ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          {successMessages[params.created] ?? "Saved successfully."}
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Something went wrong."}
          {params.message ? ` ${params.message}` : ""}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create User Account</CardTitle>
            <CardDescription>
              Creates a Supabase Auth user and profile. Requires SUPABASE_SERVICE_ROLE_KEY.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createPortalUser} className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Full name</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="fullName" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Phone</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="phone" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Email</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="email" type="email" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Temporary password</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="password" type="password" required />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-700">Role</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="role" defaultValue="tenant">
                  <option value="owner">Owner</option>
                  <option value="admin">Admin Team</option>
                  <option value="tenant">Tenant</option>
                  <option value="maintenance_staff">Maintenance Staff</option>
                  <option value="cleaning_staff">Cleaning Staff</option>
                </select>
              </label>
              <Button className="sm:col-span-2" type="submit">Create user</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Unit</CardTitle>
            <CardDescription>Add a unit under a property.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createUnit} className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-700">Property</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="propertyId" required>
                  <option value="">Choose property</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>{property.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Unit name</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="name" placeholder="Unit A" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Floor</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="floor" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-700">Notes</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="notes" />
              </label>
              <Button className="sm:col-span-2" type="submit">Create unit</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assign Property Owner</CardTitle>
            <CardDescription>Link an owner account to a property.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={assignPropertyOwner} className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Property</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="propertyId" required>
                  <option value="">Choose property</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>{property.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Owner</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="ownerId" required>
                  <option value="">Choose owner</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>{owner.full_name ?? owner.id}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Ownership %</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="ownershipPercentage" type="number" min="1" max="100" step="0.01" defaultValue="100" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Start date</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="startDate" type="date" />
              </label>
              <Button className="sm:col-span-2" type="submit">Assign owner</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assign Tenant to Room</CardTitle>
            <CardDescription>Create the active tenancy contract.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={assignTenantTenancy} className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Tenant</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="tenantId" required>
                  <option value="">Choose tenant</option>
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>{tenant.full_name ?? tenant.id}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Room</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="roomId" required>
                  <option value="">Choose room</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>{room.name} - {propertyById.get(room.property_id) ?? "Property"}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Monthly rent RM</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="monthlyRental" type="number" min="0" step="0.01" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Deposit RM</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="deposit" type="number" min="0" step="0.01" defaultValue="0" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Contract start</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="contractStart" type="date" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Contract duration</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="contractDurationMonths" defaultValue="12">
                  <option value="6">6 months</option>
                  <option value="12">12 months</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Contract end optional override</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="contractEnd" type="date" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-700">Monthly due day</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="dueDay" type="number" min="1" max="31" defaultValue="1" required />
              </label>
              <Button className="sm:col-span-2" type="submit">Create tenancy</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Setup Records</CardTitle>
          <CardDescription>Quick view of profiles, units and active tenancies.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold">Profiles</h2>
            {profiles.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.slice(0, 8).map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell className="font-medium text-gray-950">{profile.full_name ?? profile.id}</TableCell>
                      <TableCell>{profile.phone ?? "-"}</TableCell>
                      <TableCell><Badge>{profile.role}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-gray-500">No profiles yet.</p>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 text-sm font-semibold">Units</h2>
              <div className="space-y-2">
                {units.slice(0, 6).map((unit) => (
                  <div className="rounded-md border border-[#d7dde5] p-3 text-sm" key={unit.id}>
                    <p className="font-medium">{unit.name}</p>
                    <p className="text-gray-500">{propertyById.get(unit.property_id) ?? "Property"} {unit.floor ? `- ${unit.floor}` : ""}</p>
                  </div>
                ))}
                {!units.length ? <p className="text-sm text-gray-500">No units yet.</p> : null}
              </div>
            </div>
            <div>
              <h2 className="mb-3 text-sm font-semibold">Tenancies</h2>
              <div className="space-y-2">
                {tenancies.slice(0, 6).map((tenancy) => (
                  <div className="rounded-md border border-[#d7dde5] p-3 text-sm" key={tenancy.id}>
                    <p className="font-medium">{profileById.get(tenancy.tenant_id) ?? "Tenant"}</p>
                    <p className="text-gray-500">{roomById.get(tenancy.room_id) ?? "Room"} - RM {Number(tenancy.monthly_rental ?? 0).toFixed(2)}</p>
                  </div>
                ))}
                {!tenancies.length ? <p className="text-sm text-gray-500">No tenancies yet.</p> : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

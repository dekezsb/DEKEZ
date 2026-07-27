import { Eye, Pencil, UserRound } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normalizeRole, roleLabels } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getProperties, getRooms } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";
import {
  assignPropertyOwner,
  assignTenantTenancy,
  createPortalUser,
} from "./actions";

type AdminSetupPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
    message?: string;
    removed?: string;
  }>;
};

const successMessages: Record<string, string> = {
  user: "User account created successfully.",
  owner: "Property owner assigned successfully.",
  tenancy: "Tenant assigned to room successfully.",
};

const errorMessages: Record<string, string> = {
  service_key: "Missing Supabase service role key in Vercel. Add SUPABASE_SERVICE_ROLE_KEY first.",
  user_missing: "Please fill in the required user fields.",
  user_create: "User could not be created.",
  property_missing: "Selected property was not found.",
  owner_missing: "Please choose a property and owner.",
  owner_assign: "Owner could not be assigned to this property.",
  tenancy_missing: "Please choose tenant, room and contract start date.",
  room_missing: "Selected room was not found.",
  tenancy_create: "Tenancy could not be created.",
};

function profileRoleLabel(role: string) {
  const normalizedRole = normalizeRole(role);
  return normalizedRole ? roleLabels[normalizedRole] : role;
}

function profileStatusClass(status: string) {
  if (status === "approved") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "rejected") {
    return "bg-red-100 text-red-700";
  }
  return "bg-amber-100 text-amber-800";
}

export default async function AdminSetupPage({ searchParams }: AdminSetupPageProps) {
  await requireRole(["super_admin"], {
    module: "admin_setup",
    level: "manage",
  });
  const params = await searchParams;
  const supabase = await createClient();
  const [properties, rooms, profilesResult, tenanciesResult] = await Promise.all([
    getProperties(),
    getRooms(),
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, registration_status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("tenancies")
      .select("id, tenant_id, room_id, monthly_rental, contract_start, contract_end, status")
      .order("created_at", { ascending: false }),
  ]);

  const profiles = profilesResult.data ?? [];
  const owners = profiles.filter((profile) => profile.role === "owner");
  const tenants = profiles.filter((profile) => profile.role === "tenant");
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

      {params.created || params.removed ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          {params.removed
            ? "User access removed. Historical records were preserved."
            : successMessages[params.created ?? ""] ?? "Saved successfully."}
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
              Creates a phone-login account and profile. Email is optional.
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
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  inputMode="tel"
                  name="phone"
                  placeholder="01x or international number"
                  required
                  type="tel"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Email (optional)</span>
                <input
                  autoComplete="email"
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  name="email"
                  type="email"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Temporary password</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="password" type="password" required />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-700">Role</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="role" defaultValue="tenant">
                  <option value="owner">Owner</option>
                  <option value="admin">Management</option>
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
            <CardTitle>Assign Property Owner</CardTitle>
            <CardDescription>
              Choose the one Owner who can access this property.
            </CardDescription>
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
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="dueDay" type="number" min="1" max="31" placeholder="Auto from check-in date" />
                <span className="mt-1 block text-xs text-gray-500">Leave blank to use the contract start/check-in day.</span>
              </label>
              <Button className="sm:col-span-2" type="submit">Create tenancy</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Setup Records</CardTitle>
          <CardDescription>Quick view of profiles and active tenancies.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Profiles</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Open a profile to review registration details, edit access,
                  or remove login access.
                </p>
              </div>
              <Badge>{profiles.length} users</Badge>
            </div>
            {profiles.length ? (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profiles.map((profile) => (
                        <TableRow key={profile.id}>
                          <TableCell className="font-medium text-gray-950">
                            <Link
                              className="inline-flex items-center gap-2 hover:text-[#9a6c1f]"
                              href={`/admin-setup/users/${profile.id}`}
                            >
                              <UserRound
                                aria-hidden="true"
                                className="h-4 w-4 text-[#b8892c]"
                              />
                              {profile.full_name ?? profile.id}
                            </Link>
                          </TableCell>
                          <TableCell>{profile.phone ?? "-"}</TableCell>
                          <TableCell>
                            <Badge>{profileRoleLabel(profile.role)}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={profileStatusClass(
                                profile.registration_status,
                              )}
                            >
                              {profile.registration_status.replaceAll("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button asChild size="sm" variant="outline">
                                <Link href={`/admin-setup/users/${profile.id}`}>
                                  <Eye aria-hidden="true" className="h-4 w-4" />
                                  View
                                </Link>
                              </Button>
                              <Button asChild size="icon" variant="ghost">
                                <Link
                                  aria-label={`Edit ${profile.full_name ?? "user"}`}
                                  href={`/admin-setup/users/${profile.id}`}
                                >
                                  <Pencil
                                    aria-hidden="true"
                                    className="h-4 w-4"
                                  />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-3 md:hidden">
                  {profiles.map((profile) => (
                    <div
                      className="rounded-md border border-[#d7dde5] p-4"
                      key={profile.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-950">
                            {profile.full_name ?? profile.id}
                          </p>
                          <p className="mt-1 text-sm text-gray-500">
                            {profile.phone ?? "No phone registered"}
                          </p>
                        </div>
                        <Badge
                          className={profileStatusClass(
                            profile.registration_status,
                          )}
                        >
                          {profile.registration_status.replaceAll("_", " ")}
                        </Badge>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <Badge>{profileRoleLabel(profile.role)}</Badge>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin-setup/users/${profile.id}`}>
                            <Eye aria-hidden="true" className="h-4 w-4" />
                            View profile
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">No profiles yet.</p>
            )}
          </div>

          <div>
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

import { Eye, Pencil, UserRound } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normalizeRole, roleLabels } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getProperties } from "@/lib/data/organization";
import { createClient } from "@/lib/supabase/server";
import {
  activateAllTenantPortalAccounts,
  assignPropertyOwner,
  createPortalUser,
} from "./actions";

export const maxDuration = 300;

type AdminSetupPageProps = {
  searchParams: Promise<{
    accounts?: string;
    activated?: string;
    conflicts?: string;
    created?: string;
    error?: string;
    errors?: string;
    message?: string;
    removed?: string;
    rooms?: string;
    skipped?: string;
  }>;
};

const successMessages: Record<string, string> = {
  user: "User account created successfully.",
  owner: "Property owner assigned successfully.",
};

const errorMessages: Record<string, string> = {
  service_key: "Missing Supabase service role key in Vercel. Add SUPABASE_SERVICE_ROLE_KEY first.",
  user_missing: "Please fill in the required user fields.",
  user_create: "User could not be created.",
  property_missing: "Selected property was not found.",
  owner_missing: "Please choose a property and owner.",
  owner_assign: "Owner could not be assigned to this property.",
  tenant_activation: "Tenant portal activation could not be completed. No credentials were exposed.",
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
  const [properties, profilesResult] = await Promise.all([
    getProperties(),
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, registration_status, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const profiles = profilesResult.data ?? [];
  const owners = profiles.filter((profile) => profile.role === "owner");

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">
          Admin Control & Settings
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Settings & Admin Setup
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Create role accounts, assign property owners, and manage user access.
        </p>
      </div>

      {params.created || params.removed || params.activated ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          {params.activated
            ? `${params.accounts ?? "0"} tenant logins are active across ${params.rooms ?? "0"} room assignments. ${params.skipped ?? "0"} records without valid phones and ${params.conflicts ?? "0"} conflicts require review.${Number(params.errors ?? 0) ? ` ${params.errors} processing errors were recorded.` : ""}`
            : params.removed
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

      <Card>
        <CardHeader>
          <CardTitle>Tenant Portal Access</CardTitle>
          <CardDescription>
            Activate every tenant with a valid phone number. The initial PIN is
            the last four phone digits. One person keeps one login, and every
            active room linked to that phone appears in the same portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-sm leading-6 text-gray-600">
            This action is repeatable. Existing accounts are retained and their
            portal links are repaired without deleting bills, payments, or
            agreements.
          </p>
          <form action={activateAllTenantPortalAccounts}>
            <Button type="submit">Activate all tenant logins</Button>
          </form>
        </CardContent>
      </Card>

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

      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Setup Records</CardTitle>
          <CardDescription>Review and manage user profiles.</CardDescription>
        </CardHeader>
        <CardContent>
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

        </CardContent>
      </Card>
    </section>
  );
}

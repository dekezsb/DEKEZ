import {
  ArrowLeft,
  Building2,
  CalendarDays,
  FileText,
  KeyRound,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  accessModuleDetails,
  getRoleDefaultAccess,
  resolveUserAccess,
} from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/session";
import { normalizeRole, roleLabels } from "@/lib/auth/roles";
import {
  formatMalaysiaDate as formatDate,
  formatMalaysiaDateTime as formatDateTime,
} from "@/lib/date-format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { updatePortalUser } from "../../actions";
import { CredentialControls } from "./credential-controls";
import { RemoveAccessDialog } from "./remove-access-dialog";

type UserProfilePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  auth_update: "The Supabase login account could not be updated.",
  membership_update: "The profile changed, but company access could not be synchronized.",
  permission: "You cannot change this protected account.",
  permission_update: "The user profile changed, but module access could not be saved.",
  phone_invalid: "Enter a valid international phone number with country code.",
  removal_reason: "Enter a reason before removing access.",
  self_remove: "You cannot remove your own Super Admin access.",
  service_key: "SUPABASE_SERVICE_ROLE_KEY is required for user management.",
  user_missing: "Complete all required profile fields.",
  user_not_found: "This user profile could not be found.",
  user_update: "The user profile could not be updated.",
};

const editableRoles = [
  "admin",
  "owner",
  "tenant",
  "technician",
  "maintenance_staff",
  "cleaning_staff",
] as const;

function formatMoney(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(Number(value ?? 0));
}

function humanize(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const role = normalizeRole(value);
  if (role) {
    return roleLabels[role];
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusClass(status: string) {
  if (status === "approved" || status === "active") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "rejected" || status === "inactive") {
    return "bg-red-100 text-red-700";
  }
  return "bg-amber-100 text-amber-800";
}

export default async function UserProfilePage({
  params,
  searchParams,
}: UserProfilePageProps) {
  const actorRole = await requireRole(["super_admin"], {
    module: "admin_setup",
    level: "manage",
  });
  const [{ id: profileId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const sessionClient = await createClient();
  const {
    data: { user: actor },
  } = await sessionClient.auth.getUser();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    redirect("/admin-setup?error=service_key");
  }

  const [
    profileResult,
    authResult,
    membershipsResult,
    ownerAssignmentsResult,
    tenantsResult,
    applicationsResult,
    permissionsResult,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, phone, role, global_role, registration_status, registration_reviewed_at, registration_rejection_reason, organization_id, created_at, updated_at")
      .eq("id", profileId)
      .maybeSingle(),
    admin.auth.admin.getUserById(profileId),
    admin
      .from("company_users")
      .select("id, company_id, role, status, created_at, updated_at")
      .or(`profile_id.eq.${profileId},user_id.eq.${profileId}`)
      .order("created_at", { ascending: false }),
    admin
      .from("property_owners")
      .select("id, property_id, ownership_percentage, start_date, end_date")
      .eq("owner_id", profileId)
      .order("start_date", { ascending: false }),
    admin
      .from("tenants")
      .select("id, company_id, full_name, email, phone, identity_number, emergency_contact_name, emergency_contact_phone, status, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false }),
    admin
      .from("tenant_applications")
      .select("id, tenant_id, property_id, room_id, full_name, ic_passport_number, nationality, date_of_birth, whatsapp_number, emergency_contact_name, emergency_contact_number, contract_duration_months, proposed_start_date, proposed_end_date, monthly_rent, deposit, utility_deposit, status, verification_status, payment_status, submitted_at, reviewed_at, admin_notes")
      .eq("tenant_id", profileId)
      .order("submitted_at", { ascending: false }),
    admin
      .from("user_module_permissions")
      .select("module_key, access_level")
      .eq("profile_id", profileId),
  ]);

  const profile = profileResult.data;
  const authUser = authResult.data.user;
  if (!profile || !authUser) {
    notFound();
  }

  const memberships = membershipsResult.data ?? [];
  const ownerAssignments = ownerAssignmentsResult.data ?? [];
  const tenantRecords = tenantsResult.data ?? [];
  const applications = applicationsResult.data ?? [];
  const profileAccess = resolveUserAccess(
    normalizeRole(profile.role) ?? "tenant",
    permissionsResult.data ?? [],
  );
  const roleMaximumAccess = getRoleDefaultAccess(
    normalizeRole(profile.role) ?? "tenant",
  );
  const tenantIds = Array.from(
    new Set([profile.id, ...tenantRecords.map((tenant) => tenant.id)]),
  );

  const { data: tenancies } = await admin
    .from("tenancies")
    .select("id, tenant_id, property_id, room_id, monthly_rental, deposit, contract_start, contract_end, rent_due_day, status, created_at")
    .in("tenant_id", tenantIds)
    .order("created_at", { ascending: false });

  const tenantApplicationIds = applications.map((application) => application.id);
  const documentRows = [];
  if (tenantIds.length) {
    const { data } = await admin
      .from("tenant_documents")
      .select("id, tenant_application_id, tenant_id, document_type, file_path, file_name, content_type, verification_status, uploaded_at")
      .in("tenant_id", tenantIds)
      .order("uploaded_at", { ascending: false });
    documentRows.push(...(data ?? []));
  }
  if (tenantApplicationIds.length) {
    const { data } = await admin
      .from("tenant_documents")
      .select("id, tenant_application_id, tenant_id, document_type, file_path, file_name, content_type, verification_status, uploaded_at")
      .in("tenant_application_id", tenantApplicationIds)
      .order("uploaded_at", { ascending: false });
    documentRows.push(...(data ?? []));
  }
  const { data: profileDocumentRows } = await admin
    .from("profile_documents")
    .select("id, profile_id, document_type, file_path, file_name, content_type, verification_status, uploaded_at")
    .eq("profile_id", profileId)
    .order("uploaded_at", { ascending: false });
  documentRows.push(
    ...(profileDocumentRows ?? []).map((document) => ({
      ...document,
      tenant_application_id: null,
      tenant_id: profileId,
    })),
  );

  const documents = Array.from(
    new Map(documentRows.map((document) => [document.id, document])).values(),
  );
  const documentsWithUrls = await Promise.all(
    documents.map(async (document) => {
      const { data } = await admin.storage
        .from("tenant-documents")
        .createSignedUrl(document.file_path, 60 * 10);
      return { ...document, signedUrl: data?.signedUrl ?? null };
    }),
  );

  const tenancyRows = tenancies ?? [];
  const companyIds = Array.from(
    new Set([
      ...memberships.map((membership) => membership.company_id),
      ...tenantRecords.map((tenant) => tenant.company_id),
    ]),
  );
  const propertyIds = Array.from(
    new Set([
      ...ownerAssignments.map((assignment) => assignment.property_id),
      ...applications
        .map((application) => application.property_id)
        .filter((id): id is string => Boolean(id)),
      ...tenancyRows
        .map((tenancy) => tenancy.property_id)
        .filter((id): id is string => Boolean(id)),
    ]),
  );
  const roomIds = Array.from(
    new Set([
      ...applications
        .map((application) => application.room_id)
        .filter((id): id is string => Boolean(id)),
      ...tenancyRows
        .map((tenancy) => tenancy.room_id)
        .filter((id): id is string => Boolean(id)),
    ]),
  );

  const [companiesResult, propertiesResult, roomsResult] = await Promise.all([
    companyIds.length
      ? admin.from("companies").select("id, name").in("id", companyIds)
      : Promise.resolve({ data: [] }),
    propertyIds.length
      ? admin.from("properties").select("id, name").in("id", propertyIds)
      : Promise.resolve({ data: [] }),
    roomIds.length
      ? admin.from("rooms").select("id, name, room_number").in("id", roomIds)
      : Promise.resolve({ data: [] }),
  ]);

  const companyById = new Map(
    (companiesResult.data ?? []).map((company) => [company.id, company.name]),
  );
  const propertyById = new Map(
    (propertiesResult.data ?? []).map((property) => [
      property.id,
      property.name,
    ]),
  );
  const roomById = new Map(
    (roomsResult.data ?? []).map((room) => [
      room.id,
      room.name ?? `Room ${room.room_number}`,
    ]),
  );

  const normalizedProfileRole = normalizeRole(profile.role);
  const isSelf = actor?.id === profile.id;
  const isProtectedSuperAdmin = normalizedProfileRole === "super_admin";
  const canEditAccess = !isSelf && !isProtectedSuperAdmin;
  const canRemove =
    actorRole === "super_admin" && !isSelf && !isProtectedSuperAdmin;
  const isBanned =
    Boolean(authUser.banned_until) &&
    new Date(authUser.banned_until as string).getTime() > Date.now();

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-950"
            href="/admin-setup"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Current Setup Records
          </Link>
          <p className="mt-5 text-xs font-semibold uppercase text-[#b8892c]">
            User Profile
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            {profile.full_name || "Unnamed user"}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>{humanize(profile.role)}</Badge>
            <Badge className={statusClass(profile.registration_status)}>
              {humanize(profile.registration_status)}
            </Badge>
            {isBanned ? (
              <Badge className="bg-red-100 text-red-700">Login disabled</Badge>
            ) : null}
          </div>
        </div>
        {canRemove ? (
          <RemoveAccessDialog
            fullName={profile.full_name || "This user"}
            profileId={profile.id}
          />
        ) : null}
      </div>

      {query.saved ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          User profile and access were updated successfully.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMessages[query.error] ?? "The user could not be updated."}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound aria-hidden="true" className="h-5 w-5 text-[#b8892c]" />
              Registered Profile
            </CardTitle>
            <CardDescription>
              Review and edit the details stored when this user registered.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updatePortalUser} className="grid gap-4 sm:grid-cols-2">
              <input name="profileId" type="hidden" value={profile.id} />
              <label className="block">
                <span className="text-sm font-medium text-gray-800">
                  Full name
                </span>
                <input
                  className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] px-3 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
                  defaultValue={profile.full_name ?? ""}
                  name="fullName"
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-800">
                  Phone number
                </span>
                <input
                  className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] px-3 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
                  defaultValue={profile.phone ?? ""}
                  name="phone"
                  placeholder="+60123456789"
                  type="tel"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-800">Role</span>
                {canEditAccess ? (
                  <select
                    className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] bg-white px-3"
                    defaultValue={profile.role}
                    name="role"
                  >
                    {editableRoles.map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input name="role" type="hidden" value={profile.role} />
                    <div className="mt-2 flex h-11 items-center rounded-md border border-[#d7dde5] bg-gray-50 px-3 text-sm text-gray-600">
                      {humanize(profile.role)}
                    </div>
                  </>
                )}
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-800">
                  Registration status
                </span>
                {canEditAccess ? (
                  <select
                    className="mt-2 h-11 w-full rounded-md border border-[#d7dde5] bg-white px-3"
                    defaultValue={profile.registration_status}
                    name="registrationStatus"
                  >
                    <option value="pending_verification">
                      Pending Verification
                    </option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                ) : (
                  <>
                    <input
                      name="registrationStatus"
                      type="hidden"
                      value={profile.registration_status}
                    />
                    <div className="mt-2 flex h-11 items-center rounded-md border border-[#d7dde5] bg-gray-50 px-3 text-sm text-gray-600">
                      {humanize(profile.registration_status)}
                    </div>
                  </>
                )}
              </label>
              {canEditAccess ? (
                <label className="block sm:col-span-2">
                  <span className="text-sm font-medium text-gray-800">
                    Rejection or access note
                  </span>
                  <textarea
                    className="mt-2 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2 outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
                    defaultValue={profile.registration_rejection_reason ?? ""}
                    name="rejectionReason"
                    placeholder="Required when the status is Rejected"
                  />
                </label>
              ) : (
                <input
                  name="rejectionReason"
                  type="hidden"
                  value={profile.registration_rejection_reason ?? ""}
                />
              )}
              <div className="space-y-3 border-t border-[#e4e8ee] pt-5 sm:col-span-2">
                <div>
                  <h2 className="font-semibold text-gray-950">
                    Module Access
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Choose whether this user cannot open a module, can view it,
                    or can make changes.
                  </p>
                </div>
                <div className="divide-y divide-[#e4e8ee] rounded-md border border-[#d7dde5]">
                  {accessModuleDetails.map((module) => {
                    const isDashboard = module.key === "dashboard";
                    const maximumAccess = roleMaximumAccess[module.key];
                    const isLocked =
                      isDashboard ||
                      isProtectedSuperAdmin ||
                      maximumAccess === "none";
                    const accessLevel = profileAccess[module.key];

                    return (
                      <div
                        className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center"
                        key={module.key}
                      >
                        <div>
                          <p className="font-medium text-gray-950">
                            {module.label}
                          </p>
                          <p className="mt-1 text-sm text-gray-500">
                            {module.description}
                          </p>
                        </div>
                        {isLocked ? (
                          <>
                            <input
                              name={`access_${module.key}`}
                              type="hidden"
                              value={
                                isProtectedSuperAdmin
                                  ? "manage"
                                  : isDashboard
                                    ? "view"
                                    : "none"
                              }
                            />
                            <div className="flex h-11 items-center rounded-md border border-[#d7dde5] bg-gray-50 px-3 text-sm font-medium text-gray-600">
                              {isProtectedSuperAdmin
                                ? "Full access"
                                : isDashboard
                                  ? "View only"
                                  : "Not available for this role"}
                            </div>
                          </>
                        ) : (
                          <select
                            className="h-11 w-full rounded-md border border-[#d7dde5] bg-white px-3"
                            defaultValue={accessLevel}
                            name={`access_${module.key}`}
                          >
                            <option value="none">No access</option>
                            <option value="view">View only</option>
                            {maximumAccess === "manage" ? (
                              <option value="manage">Full access</option>
                            ) : null}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <Button className="sm:col-span-2 sm:w-fit" type="submit">
                <Save aria-hidden="true" className="h-4 w-4" />
                Save user
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound aria-hidden="true" className="h-5 w-5 text-[#b8892c]" />
              Login & Registration
            </CardTitle>
            <CardDescription>
              Authentication and registration activity. Passwords are never
              displayed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-[#e4e8ee] text-sm">
              <div className="py-3 first:pt-0">
                <dt className="text-gray-500">User ID</dt>
                <dd className="mt-1 break-all font-mono text-xs font-medium text-gray-950">
                  {profile.id}
                </dd>
              </div>
              <div className="py-3 first:pt-0">
                <dt className="text-gray-500">Login phone</dt>
                <dd className="mt-1 font-medium text-gray-950">
                  {authUser.phone ?? profile.phone ?? "-"}
                </dd>
              </div>
              <div className="py-3">
                <dt className="text-gray-500">Login email</dt>
                <dd className="mt-1 break-all font-medium text-gray-950">
                  {authUser.email ?? "-"}
                </dd>
              </div>
              <div className="py-3">
                <dt className="text-gray-500">Registered</dt>
                <dd className="mt-1 font-medium text-gray-950">
                  {formatDateTime(profile.created_at)}
                </dd>
              </div>
              <div className="py-3">
                <dt className="text-gray-500">Last sign-in</dt>
                <dd className="mt-1 font-medium text-gray-950">
                  {formatDateTime(authUser.last_sign_in_at)}
                </dd>
              </div>
              <div className="py-3">
                <dt className="text-gray-500">Last reviewed</dt>
                <dd className="mt-1 font-medium text-gray-950">
                  {formatDateTime(profile.registration_reviewed_at)}
                </dd>
              </div>
              <div className="py-3 last:pb-0">
                <dt className="text-gray-500">Access state</dt>
                <dd className="mt-1 font-medium text-gray-950">
                  {isBanned ? "Login disabled" : "Login enabled"}
                </dd>
              </div>
            </dl>
            <CredentialControls
              phone={authUser.phone ?? profile.phone ?? null}
              profileId={profile.id}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 aria-hidden="true" className="h-5 w-5 text-[#b8892c]" />
            Company & Property Access
          </CardTitle>
          <CardDescription>
            Company memberships and property ownership currently registered to
            this user.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold">Company access</h2>
            {memberships.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {memberships.map((membership) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-md border border-[#d7dde5] p-4"
                    key={membership.id}
                  >
                    <div>
                      <p className="font-medium">
                        {companyById.get(membership.company_id) ?? "Company"}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        {humanize(membership.role)}
                      </p>
                    </div>
                    <Badge className={statusClass(membership.status)}>
                      {humanize(membership.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No company membership is registered.
              </p>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold">Assigned properties</h2>
            {ownerAssignments.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {ownerAssignments.map((assignment) => (
                  <div
                    className="rounded-md border border-[#d7dde5] p-4"
                    key={assignment.id}
                  >
                    <p className="font-medium">
                      {propertyById.get(assignment.property_id) ?? "Property"}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {assignment.end_date
                        ? `Access ended ${formatDate(assignment.end_date)}`
                        : `Active since ${formatDate(assignment.start_date)}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No property ownership is registered.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="h-5 w-5 text-[#b8892c]" />
            Tenant Registration Submissions
          </CardTitle>
          <CardDescription>
            The information this user submitted during tenant onboarding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {applications.length ? (
            <div className="space-y-4">
              {applications.map((application) => (
                <div
                  className="rounded-md border border-[#d7dde5] p-4"
                  key={application.id}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold">
                        {application.full_name || profile.full_name}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        {propertyById.get(application.property_id) ?? "No property"}{" "}
                        · {roomById.get(application.room_id) ?? "No room"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={statusClass(application.status)}>
                        {humanize(application.status)}
                      </Badge>
                      <Badge>{humanize(application.verification_status)}</Badge>
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-gray-500">IC / Passport</dt>
                      <dd className="mt-1 font-medium">
                        {application.ic_passport_number ?? "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">WhatsApp</dt>
                      <dd className="mt-1 font-medium">
                        {application.whatsapp_number ?? "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Nationality</dt>
                      <dd className="mt-1 font-medium">
                        {application.nationality ?? "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Date of birth</dt>
                      <dd className="mt-1 font-medium">
                        {formatDate(application.date_of_birth)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Proposed term</dt>
                      <dd className="mt-1 font-medium">
                        {formatDate(application.proposed_start_date)} to{" "}
                        {formatDate(application.proposed_end_date)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Monthly rent</dt>
                      <dd className="mt-1 font-medium">
                        {formatMoney(application.monthly_rent)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Deposit</dt>
                      <dd className="mt-1 font-medium">
                        {formatMoney(application.deposit)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Submitted</dt>
                      <dd className="mt-1 font-medium">
                        {formatDateTime(application.submitted_at)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No tenant registration submission was found for this profile.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays aria-hidden="true" className="h-5 w-5 text-[#b8892c]" />
            Tenancies
          </CardTitle>
          <CardDescription>
            Current and historical tenancy records linked to this user.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tenancyRows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property / Room</TableHead>
                    <TableHead>Contract</TableHead>
                    <TableHead>Monthly Rent</TableHead>
                    <TableHead>Due Day</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenancyRows.map((tenancy) => (
                    <TableRow key={tenancy.id}>
                      <TableCell className="font-medium">
                        {propertyById.get(tenancy.property_id) ?? "Property"}
                        <span className="block text-xs font-normal text-gray-500">
                          {roomById.get(tenancy.room_id) ?? "Room"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {formatDate(tenancy.contract_start)} to{" "}
                        {formatDate(tenancy.contract_end)}
                      </TableCell>
                      <TableCell>
                        {formatMoney(tenancy.monthly_rental)}
                      </TableCell>
                      <TableCell>{tenancy.rent_due_day ?? "-"}</TableCell>
                      <TableCell>
                        <Badge className={statusClass(tenancy.status)}>
                          {humanize(tenancy.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No tenancy records are linked to this profile.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText aria-hidden="true" className="h-5 w-5 text-[#b8892c]" />
            Registered Documents
          </CardTitle>
          <CardDescription>
            Identity and supporting documents already uploaded by this user.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documentsWithUrls.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {documentsWithUrls.map((document) => (
                <div
                  className="flex items-start gap-4 rounded-md border border-[#d7dde5] p-4"
                  key={document.id}
                >
                  {document.signedUrl ? (
                    <DocumentPreview
                      contentType={document.content_type}
                      fileName={document.file_name}
                      label={humanize(document.document_type)}
                      size="sm"
                      url={document.signedUrl}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {document.file_name ??
                        document.file_path.split("/").at(-1) ??
                        "Document"}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {humanize(document.document_type)} ·{" "}
                      {humanize(document.verification_status)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No uploaded documents are linked to this profile.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

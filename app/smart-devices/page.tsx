import Link from "next/link";
import {
  AlertTriangle,
  BatteryCharging,
  Building2,
  CheckCircle2,
  ChevronDown,
  Fingerprint,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  Router,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTTLockConfigStatus } from "@/lib/ttlock/client";
import {
  provisionTTLockAccess,
  sendFingerprintEnrollmentInvite,
  syncTTLockFingerprintEnrollments,
  syncTTLockDevices,
} from "./actions";

export const dynamic = "force-dynamic";

type SmartDevicesPageProps = {
  searchParams: Promise<{
    accessCreated?: string;
    accessErrors?: string;
    accessSkipped?: string;
    accessUnchanged?: string;
    accessUpdated?: string;
    error?: string;
    fingerprintCode?: string;
    fingerprintError?: string;
    fingerprintErrors?: string;
    fingerprintExisting?: string;
    fingerprintInvited?: string;
    fingerprintMatched?: string;
    fingerprintSkipped?: string;
    lockPage?: string;
    lockSearch?: string;
    synced?: string;
  }>;
};

type SmartLockDevice = {
  id: string;
  provider_lock_name: string;
  battery_level: number | null;
  has_gateway: boolean | null;
  sync_status: string;
  snapshot_captured_at: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  property_id: string | null;
  room_id: string | null;
  access_scope: "property_entry" | "room_entry";
  properties: { name: string; property_code: string | null } | null;
  rooms: { name: string | null; room_number: string | null } | null;
};

type SmartLockAccessGrant = {
  id: string;
  access_scope: "property_entry" | "room_entry";
  keyboard_password: string | null;
  credential_state: string;
  valid_from: string;
  valid_until: string;
  smart_lock_devices: Relation<{ id: string; provider_lock_name: string }>;
  tenancies: Relation<{ tenants: Relation<{ full_name: string }> }>;
  rooms: Relation<{ name: string | null; room_number: string | null }>;
};

type SmartLockFingerprintGrant = {
  id: string;
  device_id: string;
  access_scope: "property_entry" | "room_entry";
  credential_state: string;
  enrollment_code: string;
  fingerprint_name: string | null;
  valid_from: string | null;
  valid_until: string | null;
  last_error: string | null;
  tenancies: Relation<{ tenants: Relation<{ full_name: string }> }>;
};

type ActiveLockTenancy = {
  id: string;
  room_id: string;
  tenants: Relation<{
    profile_id: string | null;
    full_name: string;
    phone: string | null;
  }>;
  tenancy_agreements: Relation<{
    signed_at: string | null;
    admin_verified_at: string | null;
    admin_rejected_at: string | null;
  }>;
};

type Relation<T> = T | T[] | null;

const statusLabels: Record<string, string> = {
  awaiting_api_approval: "Awaiting API approval",
  credentials_required: "Credentials required",
  pending_sync: "Pending first sync",
  connected: "Live connected",
  offline: "Offline",
  error: "Sync needs attention",
  retired: "Retired",
};

const numberedRoomLockPattern = /\boffice\s+\d+\b/i;

function statusClass(status: string) {
  if (status === "connected") return "bg-emerald-100 text-emerald-800";
  if (status === "error" || status === "offline") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-800";
}

function fingerprintStatusClass(status: string) {
  if (status === "active") return "bg-emerald-100 text-emerald-800";
  if (status === "suspended" || status === "error") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-800";
}

function dateTimeLabel(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function SmartDevicesPage({ searchParams }: SmartDevicesPageProps) {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });

  const admin = createAdminClient();
  const [
    { data, error },
    { data: accessData, error: accessError },
    { data: fingerprintData, error: fingerprintError },
    { data: tenancyData, error: tenancyError },
    params,
  ] = await Promise.all([
    admin
      .from("smart_lock_devices")
      .select(
        "id,provider_lock_name,battery_level,has_gateway,sync_status,snapshot_captured_at,last_synced_at,last_sync_error,property_id,room_id,access_scope,properties(name,property_code),rooms(name,room_number)",
      )
      .neq("sync_status", "retired")
      .order("provider_lock_name"),
    admin
      .from("smart_lock_access_grants")
      .select(
        "id,access_scope,keyboard_password,credential_state,valid_from,valid_until,smart_lock_devices(id,provider_lock_name),tenancies(tenants(full_name)),rooms(name,room_number)",
      )
      .eq("credential_state", "active")
      .order("valid_until"),
    admin
      .from("smart_lock_fingerprint_grants")
      .select(
        "id,device_id,access_scope,credential_state,enrollment_code,fingerprint_name,valid_from,valid_until,last_error,tenancies(tenants(full_name))",
      )
      .in("credential_state", [
        "pending_enrollment",
        "active",
        "suspension_due",
        "suspended",
        "revoke_pending",
        "error",
      ])
      .order("created_at"),
    admin
      .from("tenancies")
      .select(
        "id,room_id,tenants(profile_id,full_name,phone),tenancy_agreements(signed_at,admin_verified_at,admin_rejected_at)",
      )
      .eq("status", "active")
      .is("checkout_date", null),
    searchParams,
  ]);

  const devices = ((data ?? []) as unknown as SmartLockDevice[]).map((device) => ({
    ...device,
    properties: relatedOne(device.properties),
    rooms: relatedOne(device.rooms),
  }));
  const accessGrants = (accessData ?? []) as unknown as SmartLockAccessGrant[];
  const accessGrantsByDeviceId = accessGrants.reduce<Record<string, SmartLockAccessGrant[]>>(
    (grouped, grant) => {
      const device = relatedOne(grant.smart_lock_devices);
      if (!device?.id) return grouped;
      (grouped[device.id] ??= []).push(grant);
      return grouped;
    },
    {},
  );
  const fingerprintGrants = (fingerprintData ?? []) as unknown as SmartLockFingerprintGrant[];
  const fingerprintGrantsByDeviceId = fingerprintGrants.reduce<Record<string, SmartLockFingerprintGrant[]>>(
    (grouped, grant) => {
      (grouped[grant.device_id] ??= []).push(grant);
      return grouped;
    },
    {},
  );
  const activeTenancies = (tenancyData ?? []) as unknown as ActiveLockTenancy[];
  const activeTenancyByRoomId = new Map(
    activeTenancies.map((tenancy) => [tenancy.room_id, tenancy]),
  );
  const lockSearchText = (params.lockSearch ?? "").trim();
  const lockSearch = lockSearchText.toLocaleLowerCase("en");
  const filteredDevices = lockSearch
    ? devices.filter((device) =>
        [
          device.provider_lock_name,
          device.properties?.name,
          device.properties?.property_code,
          device.rooms?.name,
          device.rooms?.room_number,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("en")
          .includes(lockSearch),
      )
    : devices;
  const locksPerPage = 20;
  const requestedLockPage = Number.parseInt(params.lockPage ?? "1", 10);
  const totalLockPages = Math.max(1, Math.ceil(filteredDevices.length / locksPerPage));
  const currentLockPage = Math.min(
    Number.isFinite(requestedLockPage) && requestedLockPage > 0 ? requestedLockPage : 1,
    totalLockPages,
  );
  const visibleDevices = filteredDevices.slice(
    (currentLockPage - 1) * locksPerPage,
    currentLockPage * locksPerPage,
  );
  const lockPageHref = (page: number) => {
    const query = new URLSearchParams();
    if (lockSearchText) query.set("lockSearch", lockSearchText);
    if (page > 1) query.set("lockPage", String(page));
    const value = query.toString();
    return value ? `/smart-devices?${value}` : "/smart-devices";
  };
  const config = getTTLockConfigStatus();
  const connectedCount = devices.filter((device) => device.sync_status === "connected").length;
  const assignedCount = devices.filter((device) => device.room_id).length;
  const numberedRoomLockCount = devices.filter((device) => numberedRoomLockPattern.test(device.provider_lock_name)).length;
  const errorMessage = error || accessError || fingerprintError || tenancyError
    ? "Smart-device records could not be loaded."
    : params.error === "credentials"
      ? "TTLock has not released or configured the API credentials yet."
      : params.error === "sync"
        ? "TTLock could not be synchronized. No room or tenancy data was changed."
        : params.error === "access"
          ? "Current tenant access could not be prepared. No existing passcode was changed."
          : params.error === "revoke"
            ? "A TTLock passcode could not be revoked. The access record remains flagged for attention."
        : null;
  const accessAttempted =
    params.accessCreated !== undefined ||
    params.accessUpdated !== undefined ||
    params.accessUnchanged !== undefined ||
    params.accessSkipped !== undefined ||
    params.accessErrors !== undefined;
  const accessErrors = Number(params.accessErrors ?? 0);

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#b47d17]">Admin control</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-950">Smart Devices</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Connect TTLock devices to DEKEZ, confirm their physical rooms, and later automate tenant access from check-in to checkout.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={syncTTLockDevices}>
            <Button disabled={!config.complete} type="submit" variant="outline">
              <RefreshCw className="h-4 w-4" /> Sync installed locks
            </Button>
          </form>
          <form action={provisionTTLockAccess}>
            <Button disabled={!config.complete || connectedCount !== devices.length} type="submit">
              <KeyRound className="h-4 w-4" /> Provision current tenant access
            </Button>
          </form>
          <form action={syncTTLockFingerprintEnrollments}>
            <Button disabled={!config.complete || connectedCount !== devices.length} type="submit" variant="outline">
              <Fingerprint className="h-4 w-4" /> Match enrolled fingerprints
            </Button>
          </form>
        </div>
      </div>

      {errorMessage ? (
        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{errorMessage}</p>
        </div>
      ) : null}
      {params.synced ? (
        <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{params.synced} installed lock(s) synchronized successfully.</p>
        </div>
      ) : null}
      {params.fingerprintError ? (
        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{params.fingerprintError === "sync" ? "TTLock fingerprints could not be synchronized." : params.fingerprintError}</p>
        </div>
      ) : null}
      {params.fingerprintInvited ? (
        <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Fingerprint setup instructions were sent to {params.fingerprintInvited}. Enrollment reference: <strong>{params.fingerprintCode}</strong>.
          </p>
        </div>
      ) : null}
      {params.fingerprintExisting ? (
        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <Fingerprint className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{params.fingerprintExisting} already has linked fingerprint access, so no re-enrollment message was sent.</p>
        </div>
      ) : null}
      {params.fingerprintMatched !== undefined ? (
        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <Fingerprint className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Fingerprint matching finished: {params.fingerprintMatched} activated, {params.fingerprintSkipped ?? "0"} still waiting for physical enrollment, and {params.fingerprintErrors ?? "0"} error(s).
          </p>
        </div>
      ) : null}
      {accessAttempted ? (
        <div
          className={`flex gap-3 rounded-lg border p-4 text-sm ${
            accessErrors
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {accessErrors ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <p>
            Access reconciliation finished: {params.accessCreated ?? "0"} created, {params.accessUpdated ?? "0"} extended, {params.accessUnchanged ?? "0"} already correct, {params.accessSkipped ?? "0"} expired or not eligible, and {params.accessErrors ?? "0"} error(s).
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard icon={Link2} label="TTLock integration" value={config.complete ? "Ready to sync" : "Under review"} />
        <SummaryCard icon={LockKeyhole} label="Installed locks" value={String(devices.length)} />
        <SummaryCard icon={Building2} label="Room locks assigned" value={`${assignedCount} / ${numberedRoomLockCount}`} />
        <SummaryCard icon={Router} label="Live connected" value={`${connectedCount} / ${devices.length}`} />
        <SummaryCard icon={KeyRound} label="Active tenant credentials" value={String(accessGrants.length)} />
        <SummaryCard icon={Fingerprint} label="Fingerprint records" value={String(fingerprintGrants.length)} />
      </div>

      {!config.complete ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="font-semibold">TTLock application is still under review</h2>
              <p className="mt-1 text-sm leading-6">
                The four devices below are the last verified onboarding snapshot, not live readings. Live sync and control actions will activate only after TTLock approves the application and the credentials are saved securely on Vercel.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Installed lock directory</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              Search by lock, property or room. Open only the lock whose details you need.
            </p>
          </div>
          <Badge>{lockSearchText ? `${filteredDevices.length} matching` : `${devices.length} devices`}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-2 sm:flex-row" method="get">
            <label className="relative flex-1">
              <span className="sr-only">Search installed locks</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
                defaultValue={lockSearchText}
                name="lockSearch"
                placeholder="Search lock, property or room"
                type="search"
              />
            </label>
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4" /> Search
            </Button>
            {lockSearchText ? (
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
                href="/smart-devices"
              >
                Clear
              </Link>
            ) : null}
          </form>

          {visibleDevices.length ? (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              {visibleDevices.map((device) => {
                const lockAccess = accessGrantsByDeviceId[device.id] ?? [];
                const lockFingerprints = fingerprintGrantsByDeviceId[device.id] ?? [];
                const roomTenancy = device.room_id
                  ? activeTenancyByRoomId.get(device.room_id) ?? null
                  : null;
                const roomTenant = relatedOne(roomTenancy?.tenants ?? null);
                const roomAgreements = roomTenancy
                  ? Array.isArray(roomTenancy.tenancy_agreements)
                    ? roomTenancy.tenancy_agreements
                    : roomTenancy.tenancy_agreements
                      ? [roomTenancy.tenancy_agreements]
                      : []
                  : [];
                const fingerprintEligible = Boolean(
                  roomTenancy
                    && roomTenant?.profile_id
                    && roomTenant.phone
                    && roomAgreements.some(
                      (agreement) =>
                        agreement.signed_at
                        && agreement.admin_verified_at
                        && !agreement.admin_rejected_at,
                    ),
                );

                return (
                    <details className="group border-b border-gray-200 last:border-b-0" key={device.id} name="installed-locks">
                      <summary className="grid cursor-pointer list-none gap-3 p-4 transition hover:bg-gray-50 md:grid-cols-[minmax(180px,1.2fr)_minmax(180px,1fr)_minmax(220px,1.2fr)_minmax(140px,.8fr)_auto] md:items-center [&::-webkit-details-marker]:hidden">
                        <div className="flex items-center gap-2 font-semibold text-gray-950">
                          <KeyRound className="h-4 w-4 shrink-0 text-[#b8892c]" />
                          {device.provider_lock_name}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{device.properties?.name ?? "Not assigned"}</p>
                          <p className="text-xs text-amber-700">
                            {device.rooms?.name || device.rooms?.room_number || (device.access_scope === "property_entry" ? "Common / main entrance" : "Room confirmation required")}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={statusClass(device.sync_status)}>
                            {statusLabels[device.sync_status] ?? device.sync_status}
                          </Badge>
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-800">
                            <BatteryCharging className="h-4 w-4 text-emerald-600" />
                            {device.battery_level === null ? "Not checked" : `${device.battery_level}%`}
                          </span>
                        </div>
                        <div>
                          {lockAccess.length || lockFingerprints.length ? (
                            <Badge className="bg-emerald-100 text-emerald-800">
                              {lockAccess.length} code · {lockFingerprints.length} fingerprint
                            </Badge>
                          ) : (
                            <span className="text-xs text-gray-500">No active access</span>
                          )}
                        </div>
                        <span className="flex items-center justify-end gap-2 text-sm font-medium text-[#8b651e]">
                          View
                          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                        </span>
                      </summary>

                      <div className="border-t border-gray-200 bg-gray-50/70 p-4">
                        <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-500">Access path</p>
                            <Badge className={`mt-2 ${device.access_scope === "property_entry" ? "bg-blue-100 text-blue-800" : "bg-violet-100 text-violet-800"}`}>
                              {device.access_scope === "property_entry" ? "Shared main entrance" : "Individual room"}
                            </Badge>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-500">Gateway</p>
                            <p className="mt-2 font-medium text-gray-900">
                              {device.has_gateway === null ? "Not checked" : device.has_gateway ? "Installed" : "Not installed"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-500">Last checked</p>
                            <p className="mt-2 font-medium text-gray-900">
                              {dateTimeLabel(device.last_synced_at ?? device.snapshot_captured_at)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-500">Control</p>
                            <p className="mt-2 inline-flex items-center gap-2 font-medium text-gray-900">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              {device.sync_status === "connected" ? "Connected" : "Unavailable"}
                            </p>
                            {device.last_sync_error ? <p className="mt-1 text-xs text-red-600">{device.last_sync_error}</p> : null}
                          </div>
                        </div>

                        {lockAccess.length ? (
                          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                                <KeyRound className="h-4 w-4" /> Current tenant access
                              </p>
                              <Badge className="bg-emerald-100 text-emerald-800">
                                {lockAccess.length} active
                              </Badge>
                            </div>
                            <div className="mt-3 grid gap-3 xl:grid-cols-2">
                              {lockAccess.map((grant) => {
                                const tenancy = relatedOne(grant.tenancies);
                                const tenant = relatedOne(tenancy?.tenants ?? null);
                                const room = relatedOne(grant.rooms);

                                return (
                                  <div className="rounded-md border border-emerald-100 bg-white p-3" key={grant.id}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="font-semibold text-gray-950">{tenant?.full_name ?? "Tenant"}</p>
                                      <Badge className="bg-emerald-100 text-emerald-800">Active</Badge>
                                    </div>
                                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                                      <div>
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Access</p>
                                        <p className="mt-1 font-medium text-gray-900">
                                          {grant.access_scope === "property_entry"
                                            ? "Main entrance"
                                            : room?.room_number ?? room?.name ?? "Room"}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Passcode</p>
                                        <code className="mt-1 inline-block rounded bg-gray-100 px-2 py-1 font-bold tracking-widest text-gray-950">
                                          {grant.keyboard_password ?? "Pending"}
                                        </code>
                                      </div>
                                      <div>
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Valid period</p>
                                        <p className="mt-1 text-gray-900">
                                          {dateTimeLabel(grant.valid_from)} – {dateTimeLabel(grant.valid_until)}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
                            This lock has no active tenant access.
                          </p>
                        )}

                        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="flex items-center gap-2 text-sm font-semibold text-blue-950">
                                <Fingerprint className="h-4 w-4" /> Fingerprint access
                              </p>
                              <p className="mt-1 text-xs leading-5 text-blue-800">
                                Physical enrollment happens at this lock. DEKEZ stores the TTLock record number and validity only, never the fingerprint image.
                              </p>
                            </div>
                            {device.access_scope === "room_entry" && roomTenancy ? (
                              <form action={sendFingerprintEnrollmentInvite}>
                                <input name="tenancyId" type="hidden" value={roomTenancy.id} />
                                <Button disabled={!fingerprintEligible} size="sm" type="submit">
                                  <Fingerprint className="h-4 w-4" /> Send setup WhatsApp
                                </Button>
                              </form>
                            ) : null}
                          </div>

                          {device.access_scope === "room_entry" && roomTenancy && !fingerprintEligible ? (
                            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                              {roomTenant?.full_name ?? "This tenant"} needs an active portal phone and a signed, Admin-verified tenancy agreement before fingerprint setup can be sent.
                            </p>
                          ) : null}

                          {lockFingerprints.length ? (
                            <div className="mt-3 grid gap-3 xl:grid-cols-2">
                              {lockFingerprints.map((grant) => {
                                const tenancy = relatedOne(grant.tenancies);
                                const tenant = relatedOne(tenancy?.tenants ?? null);
                                return (
                                  <div className="rounded-md border border-blue-100 bg-white p-3" key={grant.id}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="font-semibold text-gray-950">{tenant?.full_name ?? "Tenant"}</p>
                                      <Badge className={fingerprintStatusClass(grant.credential_state)}>
                                        {grant.credential_state.replaceAll("_", " ")}
                                      </Badge>
                                    </div>
                                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                                      <div>
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Reference</p>
                                        <code className="mt-1 inline-block rounded bg-gray-100 px-2 py-1 font-bold tracking-widest text-gray-950">
                                          {grant.enrollment_code}
                                        </code>
                                      </div>
                                      <div>
                                        <p className="text-xs uppercase tracking-wide text-gray-500">TTLock name</p>
                                        <p className="mt-1 font-medium text-gray-900">{grant.fingerprint_name ?? "Waiting for enrollment"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Valid until</p>
                                        <p className="mt-1 text-gray-900">{dateTimeLabel(grant.valid_until)}</p>
                                      </div>
                                    </div>
                                    {grant.last_error ? <p className="mt-2 text-xs text-red-700">{grant.last_error}</p> : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-3 rounded-md border border-dashed border-blue-200 bg-white p-3 text-sm text-blue-800">
                              No fingerprint record is linked to this lock yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </details>
                );
              })}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              {lockSearchText ? "No locks match this search." : "No smart locks have been added yet."}
            </p>
          )}

          {filteredDevices.length ? (
            <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-500">
                Page {currentLockPage} of {totalLockPages} · Maximum {locksPerPage} locks per page
              </p>
              <div className="flex gap-2">
                {currentLockPage > 1 ? (
                  <Link
                    className="inline-flex h-9 items-center justify-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    href={lockPageHref(currentLockPage - 1)}
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="inline-flex h-9 items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-400">
                    Previous
                  </span>
                )}
                {currentLockPage < totalLockPages ? (
                  <Link
                    className="inline-flex h-9 items-center justify-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    href={lockPageHref(currentLockPage + 1)}
                  >
                    Next
                  </Link>
                ) : (
                  <span className="inline-flex h-9 items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-400">
                    Next
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Two-door tenant access</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <AccessRule
              number="1"
              title="Verified TA opens enrollment"
              text="After the tenant signs and Admin verifies the TA, DEKEZ sends one WhatsApp reference for physical fingerprint enrollment at the main entrance and assigned room lock."
            />
            <AccessRule
              number="2"
              title="Payment renews the same finger"
              text="A verified rental payment extends the same fingerprint for another 30-day cycle. A pending payment slip prevents an overdue suspension while Admin reviews it."
            />
            <AccessRule
              number="3"
              title="Overdue and checkout are controlled"
              text="Seven days overdue with no pending slip suspends entry. Verified payment reopens it; checkout deletes the fingerprint from both locks and retains the audit record."
            />
          </div>
          <p className="mt-4 rounded-md bg-gray-50 p-3 text-xs leading-5 text-gray-600">
            Fingerprints are captured only by the physical TTLock hardware. DEKEZ stores provider record IDs, dates and audit events—not biometric images or templates.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live installation status</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-4 md:grid-cols-5">
            <NextStep number="1" title="API approved" text="The DEKEZ TTLock application is approved and active." />
            <NextStep number="2" title="Secrets secured" text="The API credentials are encrypted in Vercel and never sent to the browser." />
            <NextStep number="3" title="Installed locks connected" text="Live IDs, battery, gateway and V4 support are confirmed." />
            <NextStep number="4" title="Rooms mapped" text="The main entrance and numbered BDS room locks are linked." />
            <NextStep number="5" title="Fingerprint lifecycle" text="Signed TA enables setup; verified rent extends access; overdue policy suspends; checkout deletes." />
          </ol>
        </CardContent>
      </Card>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Link2;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="rounded-lg bg-[#f6edd9] p-3 text-[#9a6b16]">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="mt-1 text-xl font-bold text-gray-950">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function NextStep({ number, text, title }: { number: string; text: string; title: string }) {
  return (
    <li className="rounded-lg border border-[#e2e6ec] p-4">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#b8892c] text-sm font-bold text-[#17130d]">
        {number}
      </span>
      <h3 className="mt-3 font-semibold text-gray-950">{title}</h3>
      <p className="mt-1 text-sm leading-5 text-gray-600">{text}</p>
    </li>
  );
}

function AccessRule({ number, text, title }: { number: string; text: string; title: string }) {
  return (
    <div className="rounded-lg border border-[#e2e6ec] bg-gray-50/60 p-4">
      <span className="text-xs font-bold uppercase tracking-wide text-[#9a6b16]">Rule {number}</span>
      <h3 className="mt-2 font-semibold text-gray-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-gray-600">{text}</p>
    </div>
  );
}

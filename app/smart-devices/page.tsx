import { Fragment } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  Building2,
  CheckCircle2,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  Router,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTTLockConfigStatus } from "@/lib/ttlock/client";
import {
  provisionTTLockAccess,
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
  const [{ data, error }, { data: accessData, error: accessError }, params] = await Promise.all([
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
  const config = getTTLockConfigStatus();
  const connectedCount = devices.filter((device) => device.sync_status === "connected").length;
  const assignedCount = devices.filter((device) => device.room_id).length;
  const numberedRoomLockCount = devices.filter((device) => numberedRoomLockPattern.test(device.provider_lock_name)).length;
  const errorMessage = error || accessError
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
              <RefreshCw className="h-4 w-4" /> Sync four locks
            </Button>
          </form>
          <form action={provisionTTLockAccess}>
            <Button disabled={!config.complete || connectedCount !== devices.length} type="submit">
              <KeyRound className="h-4 w-4" /> Provision current tenant access
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard icon={Link2} label="TTLock integration" value={config.complete ? "Ready to sync" : "Under review"} />
        <SummaryCard icon={LockKeyhole} label="Installed locks" value={String(devices.length)} />
        <SummaryCard icon={Building2} label="Room locks assigned" value={`${assignedCount} / ${numberedRoomLockCount}`} />
        <SummaryCard icon={Router} label="Live connected" value={`${connectedCount} / ${devices.length}`} />
        <SummaryCard icon={KeyRound} label="Active tenant credentials" value={String(accessGrants.length)} />
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
            <CardTitle>Installed BDS locks</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              Each lock shows its own current tenant access directly below the device details.
            </p>
          </div>
          <Badge>{devices.length} devices</Badge>
        </CardHeader>
        <CardContent>
          {devices.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lock</TableHead>
                  <TableHead>Property / room</TableHead>
                  <TableHead>Access path</TableHead>
                  <TableHead>Battery</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last checked</TableHead>
                  <TableHead>Control</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => {
                  const lockAccess = accessGrantsByDeviceId[device.id] ?? [];

                  return (
                    <Fragment key={device.id}>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-2 font-semibold text-gray-950">
                            <KeyRound className="h-4 w-4 text-[#b8892c]" />
                            {device.provider_lock_name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-gray-900">{device.properties?.name ?? "Not assigned"}</p>
                          <p className="text-xs text-amber-700">
                            {device.rooms?.name || device.rooms?.room_number || (device.access_scope === "property_entry" ? "Common / main entrance" : "Room confirmation required")}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge className={device.access_scope === "property_entry" ? "bg-blue-100 text-blue-800" : "bg-violet-100 text-violet-800"}>
                            {device.access_scope === "property_entry" ? "Shared main entrance" : "Individual room"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-2 font-semibold text-gray-900">
                            <BatteryCharging className="h-4 w-4 text-emerald-600" />
                            {device.battery_level === null ? "Not checked" : `${device.battery_level}%`}
                          </span>
                        </TableCell>
                        <TableCell>{device.has_gateway === null ? "Not checked" : device.has_gateway ? "Installed" : "Not installed"}</TableCell>
                        <TableCell>
                          <Badge className={statusClass(device.sync_status)}>
                            {statusLabels[device.sync_status] ?? device.sync_status}
                          </Badge>
                          {device.last_sync_error ? <p className="mt-1 max-w-56 text-xs text-red-600">{device.last_sync_error}</p> : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {dateTimeLabel(device.last_synced_at ?? device.snapshot_captured_at)}
                        </TableCell>
                        <TableCell>
                          <Button disabled size="sm" variant="outline">
                            <CheckCircle2 className="h-4 w-4" /> {device.sync_status === "connected" ? "Connected" : "Unavailable"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {lockAccess.length ? (
                        <TableRow className="bg-gray-50/70 hover:bg-gray-50/70">
                          <TableCell className="px-4 pb-5 pt-0" colSpan={8}>
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
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
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              No smart locks have been added yet.
            </p>
          )}
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
              title="Check-in creates two credentials"
              text="DEKEZ creates one personal password for the shared main entrance and one personal password for the tenant's assigned room."
            />
            <AccessRule
              number="2"
              title="Access follows the tenancy"
              text="Both credentials start on check-in and use the same verified tenancy end date. Another tenant receives different passwords."
            />
            <AccessRule
              number="3"
              title="Checkout revokes both"
              text="When checkout is confirmed, DEKEZ queues both the main-door and room-door passwords for removal and retains the audit record."
            />
          </div>
          <p className="mt-4 rounded-md bg-gray-50 p-3 text-xs leading-5 text-gray-600">
            All four installed locks are live, gateway-connected and compatible with V4 passcodes. Expired tenancies are deliberately skipped until their renewal end date is confirmed.
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
            <NextStep number="3" title="Four locks connected" text="Live IDs, battery, gateway and V4 support are confirmed." />
            <NextStep number="4" title="Rooms mapped" text="The main entrance and numbered BDS room locks are linked." />
            <NextStep number="5" title="Automation enabled" text="Check-in creates both passwords; renewal extends both; checkout revokes both." />
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EKeyGrantTable, TTLockNotice } from "@/components/smart-devices/ekey-controls";
import { requireRole } from "@/lib/auth/session";
import { listEKeyGrants } from "@/lib/data/ttlock-ekeys";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTTLockConfigStatus, listTTLockLockEKeys, type TTLockEKey } from "@/lib/ttlock/client";
import { providerKeyStatusLabel } from "@/lib/ttlock/ekey-rules";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ deviceId: string }>;
  searchParams: Promise<{ ttlockError?: string; ttlockNotice?: string }>;
};

function dateTime(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(date);
}

/** Live list of every eKey TTLock holds for one lock, next to DEKEZ records. */
export default async function LockEKeysPage({ params, searchParams }: PageProps) {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });
  const [{ deviceId }, query] = await Promise.all([params, searchParams]);
  const { data: device } = await createAdminClient()
    .from("smart_lock_devices")
    .select("id,provider_lock_id,provider_lock_name,access_scope,properties(property_code),rooms(room_number)")
    .eq("id", deviceId)
    .maybeSingle();
  if (!device) notFound();

  const lockId = Number(device.provider_lock_id);
  let liveKeys: TTLockEKey[] = [];
  let liveError: string | null = null;
  if (!getTTLockConfigStatus().complete) {
    liveError = "TTLock API credentials are not configured.";
  } else if (!Number.isSafeInteger(lockId) || lockId <= 0) {
    liveError = "This lock has no live TTLock ID.";
  } else {
    try {
      liveKeys = await listTTLockLockEKeys(lockId);
    } catch (error) {
      liveError = error instanceof Error ? error.message : "TTLock could not be reached.";
    }
  }
  const records = await listEKeyGrants().catch(() => ({ grants: [], migrationPending: false }));
  const ours = records.grants.filter((grant) => grant.deviceId === device.id);
  const returnTo = "/smart-devices";
  const property = Array.isArray(device.properties) ? device.properties[0] : device.properties;
  const room = Array.isArray(device.rooms) ? device.rooms[0] : device.rooms;

  return (
    <section className="space-y-6">
      <nav className="text-sm text-gray-500">
        <Link className="hover:underline" href="/smart-devices">Smart Devices</Link> / eKeys
      </nav>
      <div>
        <h1 className="text-2xl font-bold text-gray-950">{device.provider_lock_name}</h1>
        <p className="text-sm text-gray-600">
          {property?.property_code ?? "-"} · {device.access_scope === "property_entry" ? "Main door" : room?.room_number ?? "Room lock"}
        </p>
      </div>
      <TTLockNotice error={query.ttlockError} notice={query.ttlockNotice} />

      <Card>
        <CardHeader><CardTitle>DEKEZ eKeys on this lock</CardTitle></CardHeader>
        <CardContent>
          <EKeyGrantTable grants={ours} returnTo={returnTo} showLocation />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All eKeys in TTLock (live)</CardTitle>
          <Badge>{liveKeys.length}</Badge>
        </CardHeader>
        <CardContent>
          {liveError ? (
            <p className="text-sm text-red-700">{liveError}</p>
          ) : liveKeys.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase text-gray-500">
                  <tr><th className="py-2">Name</th><th className="py-2">Account</th><th className="py-2">Status</th><th className="py-2">Valid</th><th className="py-2">Managed by DEKEZ</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {liveKeys.map((key) => {
                    const managed = ours.some((grant) => grant.receiverUsername === key.username);
                    return (
                      <tr key={key.keyId}>
                        <td className="py-2">{key.keyName ?? "—"}{key.keyRight === 1 ? <Badge className="ml-2 bg-purple-100 text-purple-800">admin</Badge> : null}</td>
                        <td className="py-2 font-mono text-xs">{key.username ?? "—"}</td>
                        <td className="py-2">{providerKeyStatusLabel(key.keyStatus)}</td>
                        <td className="py-2 text-gray-600">{dateTime(key.startDate)} – {key.endDate ? dateTime(key.endDate) : "permanent"}</td>
                        <td className="py-2">{managed ? "Yes" : "No"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">TTLock reports no eKeys on this lock (the admin key is not listed).</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MeterControlButtons, TTLockNotice } from "@/components/smart-devices/ekey-controls";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getTTLockConfigStatus,
  getTTLockElectricMeterDetail,
  listTTLockElectricMeterOperationRecords,
  listTTLockElectricMeterUsage,
} from "@/lib/ttlock/client";
import { operationRecordLabel, parseKwh, providerTimestamp } from "@/lib/ttlock/meter-rules";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ meterId: string }>;
  searchParams: Promise<{ ttlockError?: string; ttlockNotice?: string; year?: string }>;
};

function dateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function currentMalaysiaYear() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric" }).format(new Date());
}

/** Live TTLock meter detail, monthly usage and operation history (read-only). */
export default async function MeterDetailPage({ params, searchParams }: PageProps) {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });
  const [{ meterId }, query] = await Promise.all([params, searchParams]);
  const year = /^\d{4}$/.test(query.year ?? "") ? query.year! : currentMalaysiaYear();

  const { data: meter } = await createAdminClient()
    .from("smart_meters")
    .select("id,provider,provider_meter_id,meter_number,property_id,room_id,power_state,connection_status,remaining_units,total_units,last_sync_error,provider_metadata,properties(property_code),rooms(room_number)")
    .eq("id", meterId)
    .maybeSingle();
  if (!meter) notFound();

  const property = Array.isArray(meter.properties) ? meter.properties[0] : meter.properties;
  const room = Array.isArray(meter.rooms) ? meter.rooms[0] : meter.rooms;
  const canReadLive =
    meter.provider === "ttlock" && Boolean(meter.provider_meter_id) && getTTLockConfigStatus().complete;

  let liveError: string | null = null;
  let detail: Awaited<ReturnType<typeof getTTLockElectricMeterDetail>> | null = null;
  let usage: Awaited<ReturnType<typeof listTTLockElectricMeterUsage>> = [];
  let operations: Awaited<ReturnType<typeof listTTLockElectricMeterOperationRecords>> = [];
  if (canReadLive && meter.provider_meter_id) {
    try {
      [detail, usage, operations] = await Promise.all([
        getTTLockElectricMeterDetail(meter.provider_meter_id),
        listTTLockElectricMeterUsage({ electricMeterId: meter.provider_meter_id, dateType: 1, dateStr: year }),
        listTTLockElectricMeterOperationRecords({ electricMeterId: meter.provider_meter_id, pageSize: 50 }),
      ]);
    } catch (error) {
      liveError = error instanceof Error ? error.message : "TTLock could not be reached.";
    }
  }

  const name = (meter.provider_metadata as { name?: string } | null)?.name || meter.meter_number;
  const returnTo = "/smart-devices";

  return (
    <section className="space-y-6">
      <nav className="text-sm text-gray-500">
        <Link className="hover:underline" href="/smart-devices">Smart Devices</Link> / Meter
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">{name}</h1>
          <p className="text-sm text-gray-600">
            {property?.property_code ?? "-"} · {room?.room_number ?? "Unassigned"}
          </p>
        </div>
        {meter.provider === "ttlock" && meter.provider_meter_id ? (
          <MeterControlButtons meterId={meter.id} powerState={meter.power_state} returnTo={returnTo} />
        ) : null}
      </div>

      <TTLockNotice error={query.ttlockError} notice={query.ttlockNotice} />
      {meter.last_sync_error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Needs attention: {meter.last_sync_error}
        </p>
      ) : null}
      {!canReadLive ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Live readings need a linked TTLock meter and configured TTLock API credentials.
        </p>
      ) : null}
      {liveError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          TTLock could not be read: {liveError}
        </p>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Live status</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <p><span className="block text-gray-500">Remaining</span>{detail ? `${parseKwh(detail.remainderKwh) ?? "—"} kWh` : `${meter.remaining_units ?? "—"} kWh (stored)`}</p>
          <p><span className="block text-gray-500">Total used</span>{detail ? `${parseKwh(detail.totalKwh) ?? "—"} kWh` : `${meter.total_units ?? "—"} kWh (stored)`}</p>
          <p><span className="block text-gray-500">Connection</span>
            <Badge className={(detail ? detail.online === 1 : meter.connection_status === "online") ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}>
              {detail ? (detail.online === 1 ? "online" : "offline") : meter.connection_status}
            </Badge>
          </p>
          <p><span className="block text-gray-500">Power</span>{detail ? (detail.onOff === 1 ? "on" : detail.onOff === 0 ? "off" : "unknown") : meter.power_state}</p>
          <p><span className="block text-gray-500">Mode</span>{detail ? (detail.payMode === 1 ? "Prepaid" : detail.payMode === 0 ? "Metering only" : "—") : "—"}</p>
          <p><span className="block text-gray-500">Last meter reading</span>{dateTime(providerTimestamp(detail?.syncKwhDate ?? null))}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Monthly usage {year}</CardTitle>
          <div className="flex gap-3 text-sm">
            <Link className="text-[#9b6c14] hover:underline" href={`/smart-devices/meters/${meter.id}?year=${Number(year) - 1}`}>← {Number(year) - 1}</Link>
            <Link className="text-[#9b6c14] hover:underline" href={`/smart-devices/meters/${meter.id}?year=${Number(year) + 1}`}>{Number(year) + 1} →</Link>
          </div>
        </CardHeader>
        <CardContent>
          {usage.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-500"><tr><th className="py-2">Month</th><th className="py-2">Used</th></tr></thead>
              <tbody className="divide-y divide-gray-200">
                {usage.map((row, index) => (
                  <tr key={`${row.createDate}-${index}`}><td className="py-2">{row.createDate ?? "—"}</td><td className="py-2">{row.usedKwh ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">No usage reported for {year}.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent meter operations</CardTitle></CardHeader>
        <CardContent>
          {operations.filter((row) => String(row.recordType) !== "-1").length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-500"><tr><th className="py-2">Time</th><th className="py-2">Type</th><th className="py-2">Detail</th></tr></thead>
              <tbody className="divide-y divide-gray-200">
                {operations.map((row, index) =>
                  String(row.recordType) === "-1" ? (
                    <tr key={`d-${index}`}><td className="bg-gray-50 py-1 text-xs font-semibold text-gray-600" colSpan={3}>{row.date}</td></tr>
                  ) : (
                    <tr key={row.id ?? index}>
                      <td className="py-2">{row.date ?? "—"}</td>
                      <td className="py-2">{operationRecordLabel(row.recordType)}</td>
                      <td className="py-2 text-gray-600">{row.content ?? row.title ?? ""}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">No operations reported.</p>}
        </CardContent>
      </Card>
    </section>
  );
}

import { formatMalaysiaDate, formatMalaysiaDateTime } from "@/lib/date-format";
import type { RoomSmartDevices } from "@/lib/data/room-smart-devices";
import { KeyRound, Zap } from "lucide-react";

const money = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });

function formatUnits(value: number | null, unit: string) {
  if (value == null) return "Not reported";
  return `${value.toLocaleString("en-MY", { maximumFractionDigits: 3 })} ${unit}`;
}

function statusLabel(value: string | null | undefined, fallback = "Unknown") {
  if (!value) return fallback;
  return value.replaceAll("_", " ");
}

export function RoomSmartDevicesCard({ devices }: { devices: RoomSmartDevices }) {
  return (
    <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Smart Devices</p>
        <h2 className="mt-1 text-lg font-semibold text-gray-900">Meter and locks for this room</h2>
        <p className="mt-1 text-sm text-gray-500">
          Shown even when the room is vacant, so staff can check the latest reading, top-ups, and
          lock status without leaving the room page.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Zap className="h-4 w-4 text-amber-500" />
          Smart meter
        </h3>
        {devices.meters.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
            No smart meter is assigned to this room. If this property uses TTLock meters,
            they appear here once linked on Smart Devices.
          </p>
        ) : (
          devices.meters.map((meter) => (
            <article key={meter.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {meter.meterNumber ?? "Unnamed meter"}
                    {meter.provider ? (
                      <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">
                        {meter.provider}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {meter.meterType ?? "Meter"} · {statusLabel(meter.status, "Active")}
                  </p>
                </div>
                <p className="text-xs text-gray-500">
                  Last sync: {formatMalaysiaDateTime(meter.lastSyncedAt ?? meter.lastReportedAt)}
                </p>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400">Latest reading</dt>
                  <dd className="mt-1 font-medium text-gray-900">{formatUnits(meter.totalUnits, meter.unitLabel)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400">Remaining balance</dt>
                  <dd className="mt-1 font-medium text-gray-900">{formatUnits(meter.remainingUnits, meter.unitLabel)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400">Credit</dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    {meter.remainingCredit == null ? "Not reported" : money.format(meter.remainingCredit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400">Status</dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    {statusLabel(meter.connectionStatus)} · {statusLabel(meter.powerState, "Power unknown")}
                  </dd>
                </div>
              </dl>
              {meter.lastSyncError ? (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Last sync error: {meter.lastSyncError}
                </p>
              ) : null}

              <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Top-up history
              </h4>
              {meter.topUps.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No verified slips or meter recharges recorded yet.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-gray-400">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 pr-3 font-medium">Amount</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Type</th>
                        <th className="py-2 font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meter.topUps.map((topUp) => (
                        <tr key={topUp.id} className="border-t border-gray-100">
                          <td className="py-2 pr-3">{formatMalaysiaDate(topUp.paymentDate ?? topUp.verifiedAt ?? topUp.creditedAt)}</td>
                          <td className="py-2 pr-3">{money.format(topUp.amount)}</td>
                          <td className="py-2 pr-3 capitalize">{statusLabel(topUp.status)}</td>
                          <td className="py-2 pr-3">
                            {topUp.source === "ttlock_recharge" ? "TTLock recharge" : "Verified slip"}
                            {topUp.providerReference ? ` · ${topUp.providerReference}` : ""}
                          </td>
                          <td className="py-2">
                            {topUp.creditBefore == null && topUp.creditAfter == null
                              ? "—"
                              : `${topUp.creditBefore ?? "—"} → ${topUp.creditAfter ?? "—"}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {meter.readings.length > 0 ? (
                <>
                  <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Recorded readings
                  </h4>
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-gray-400">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Date</th>
                          <th className="py-2 pr-3 font-medium">Previous</th>
                          <th className="py-2 pr-3 font-medium">Current</th>
                          <th className="py-2 pr-3 font-medium">Usage</th>
                          <th className="py-2 font-medium">Top-up</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meter.readings.map((reading) => (
                          <tr key={reading.id} className="border-t border-gray-100">
                            <td className="py-2 pr-3">{formatMalaysiaDate(reading.readingDate ?? reading.billingMonth)}</td>
                            <td className="py-2 pr-3">{formatUnits(reading.previousReading, meter.unitLabel)}</td>
                            <td className="py-2 pr-3">{formatUnits(reading.currentReading, meter.unitLabel)}</td>
                            <td className="py-2 pr-3">{formatUnits(reading.usage, meter.unitLabel)}</td>
                            <td className="py-2">
                              {reading.topUpAmount == null ? "—" : money.format(reading.topUpAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </article>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <KeyRound className="h-4 w-4 text-sky-600" />
          Locks
        </h3>
        {devices.locks.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
            No lock is linked to this room or its main entrance yet.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {devices.locks.map((lock) => (
              <article key={lock.id} className="rounded-2xl border border-gray-200 p-4">
                <p className="font-medium text-gray-900">{lock.name}</p>
                <p className="text-xs text-gray-500">
                  {lock.accessScope === "property_entry" ? "Property main entrance" : "Room lock"}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-400">Battery</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {lock.batteryLevel == null ? "Not checked" : `${lock.batteryLevel}%`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-400">Gateway</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {lock.hasGateway == null ? "Not checked" : lock.hasGateway ? "Online / installed" : "Not installed"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-400">Status</dt>
                    <dd className="mt-1 font-medium text-gray-900">{statusLabel(lock.syncStatus)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-400">Active codes</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {lock.activeCodeCount === 0
                        ? "No active access"
                        : `${lock.activeCodeCount} active${lock.validUntil ? ` · until ${formatMalaysiaDateTime(lock.validUntil)}` : ""}`}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-gray-400">
                  Last sync: {formatMalaysiaDateTime(lock.lastSyncedAt)}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

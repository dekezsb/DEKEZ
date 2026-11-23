import { KeyRound, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EKeyGrantTable,
  MeterControlButtons,
  TTLockNotice,
} from "@/components/smart-devices/ekey-controls";
import type { RoomTTLockContext } from "@/lib/data/ttlock-ekeys";
import {
  saveTenantTTLockAccount,
  sendTenancyEKeys,
} from "@/app/smart-devices/ekey-meter-actions";

/** Staff controls for the tenant's TTLock app eKeys and the room's meter. */
export function RoomTTLockControls({
  context,
  returnTo,
  notice,
  error,
}: {
  context: RoomTTLockContext;
  returnTo: string;
  notice?: string;
  error?: string;
}) {
  return (
    <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">TTLock controls</p>
        <h2 className="mt-1 text-lg font-semibold text-gray-900">App eKeys and meter power</h2>
        <p className="mt-1 text-sm text-gray-500">
          eKeys let the tenant unlock with the TTLock app. They are sent to the main door and room
          lock, extended after verified rent, and deleted at checkout or contract end, together
          with the passcodes.
        </p>
      </div>

      <TTLockNotice error={error} notice={notice} />

      {context.migrationPending ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The eKey database update has not been applied yet, so eKeys cannot be saved.
        </p>
      ) : null}

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <KeyRound className="h-4 w-4 text-[#b17f19]" /> App eKeys
        </h3>
        {context.tenancyId && context.tenantId ? (
          <>
            <form action={saveTenantTTLockAccount} className="flex flex-wrap items-end gap-2">
              <input name="tenantId" type="hidden" value={context.tenantId} />
              <input name="tenancyId" type="hidden" value={context.tenancyId} />
              <input name="returnTo" type="hidden" value={returnTo} />
              <label className="block text-sm">
                <span className="block text-gray-600">
                  {context.tenantName ?? "Tenant"}&apos;s TTLock app account (phone or email)
                </span>
                <input
                  className="mt-1 w-72 rounded-md border border-gray-300 px-3 py-2"
                  defaultValue={context.ttlockUsername ?? ""}
                  disabled={context.migrationPending}
                  name="ttlockUsername"
                  placeholder="e.g. 60123456789 or name@email.com"
                />
              </label>
              <Button disabled={context.migrationPending} size="sm" type="submit">
                Save and send eKey
              </Button>
            </form>
            <p className="text-xs text-gray-500">
              The tenant must first sign up in the TTLock app with this phone number or email.
              Leave it empty and save to stop sending eKeys (existing eKeys stay until deleted).
            </p>
            {context.ttlockUsername ? (
              <form action={sendTenancyEKeys}>
                <input name="tenancyId" type="hidden" value={context.tenancyId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <Button size="sm" type="submit" variant="outline">
                  Send missing eKeys / sync to contract
                </Button>
              </form>
            ) : null}
            <EKeyGrantTable grants={context.grants} returnTo={returnTo} />
          </>
        ) : (
          <p className="text-sm text-gray-500">No active tenancy in this room.</p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Zap className="h-4 w-4 text-amber-500" /> TTLock meter
        </h3>
        {context.meters.length ? (
          context.meters.map((meter) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 p-4" key={meter.id}>
              <div className="text-sm">
                <p className="font-medium text-gray-900">{meter.name}</p>
                <p className="mt-1 flex flex-wrap gap-2">
                  <Badge className={meter.connectionStatus === "online" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}>
                    {meter.connectionStatus ?? "unknown"}
                  </Badge>
                  <Badge className={meter.powerState === "on" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                    power {meter.powerState ?? "unknown"}
                  </Badge>
                  {meter.powerControlReason === "checkout" ? (
                    <Badge className="bg-gray-100 text-gray-700">off since checkout</Badge>
                  ) : null}
                </p>
                {meter.lastSyncError ? (
                  <p className="mt-1 text-xs text-red-700">Needs attention: {meter.lastSyncError}</p>
                ) : null}
              </div>
              <MeterControlButtons meterId={meter.id} powerState={meter.powerState} returnTo={returnTo} />
            </div>
          ))
        ) : (
          <p className="text-sm text-gray-500">No TTLock meter is linked to this room.</p>
        )}
      </div>
    </section>
  );
}

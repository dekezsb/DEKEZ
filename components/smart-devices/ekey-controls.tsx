import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMalaysiaDateTime } from "@/lib/date-format";
import type { EKeyGrantView } from "@/lib/data/ttlock-ekeys";
import { ekeyStateLabel } from "@/lib/ttlock/ekey-rules";
import {
  deleteEKey,
  extendEKey,
  freezeEKey,
  refreshMeter,
  switchMeterPower,
  unfreezeEKey,
} from "@/app/smart-devices/ekey-meter-actions";

export function ekeyStateClass(state: string) {
  switch (state) {
    case "active":
      return "bg-emerald-100 text-emerald-800";
    case "frozen":
      return "bg-sky-100 text-sky-800";
    case "pending_send":
    case "revoke_pending":
      return "bg-amber-100 text-amber-800";
    case "error":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function GrantButton({
  action,
  grantId,
  label,
  returnTo,
  variant = "outline",
}: {
  action: (formData: FormData) => Promise<void>;
  grantId: string;
  label: string;
  returnTo: string;
  variant?: "outline" | "default";
}) {
  return (
    <form action={action}>
      <input name="grantId" type="hidden" value={grantId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <Button size="sm" type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

/** Freeze / unfreeze / extend / delete buttons for one eKey. */
export function EKeyGrantActions({ grant, returnTo }: { grant: EKeyGrantView; returnTo: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {grant.state === "active" ? (
        <GrantButton action={freezeEKey} grantId={grant.id} label="Freeze" returnTo={returnTo} />
      ) : null}
      {grant.state === "frozen" ? (
        <GrantButton action={unfreezeEKey} grantId={grant.id} label="Unfreeze" returnTo={returnTo} />
      ) : null}
      {grant.state === "active" || grant.state === "frozen" ? (
        <GrantButton action={extendEKey} grantId={grant.id} label="Extend 30 days" returnTo={returnTo} />
      ) : null}
      <GrantButton
        action={deleteEKey}
        grantId={grant.id}
        label={grant.state === "error" ? "Dismiss" : grant.state === "revoke_pending" ? "Retry delete" : "Delete"}
        returnTo={returnTo}
      />
    </div>
  );
}

export function EKeyGrantTable({
  grants,
  returnTo,
  showLocation = false,
}: {
  grants: EKeyGrantView[];
  returnTo: string;
  showLocation?: boolean;
}) {
  if (!grants.length) {
    return <p className="text-sm text-gray-500">No app eKeys yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            {showLocation ? <th className="px-3 py-2">Room / tenant</th> : null}
            <th className="px-3 py-2">Lock</th>
            <th className="px-3 py-2">TTLock account</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Valid until</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {grants.map((grant) => (
            <tr key={grant.id}>
              {showLocation ? (
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-950">
                    {grant.propertyCode ?? "-"} · {grant.roomNumber ?? "Main door"}
                  </span>
                  <span className="block text-xs text-gray-500">{grant.tenantName ?? "-"}</span>
                </td>
              ) : null}
              <td className="px-3 py-2">
                {grant.lockName}
                <span className="block text-xs text-gray-500">
                  {grant.accessScope === "property_entry" ? "Main door" : "Room door"}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{grant.receiverUsername}</td>
              <td className="px-3 py-2">
                <Badge className={ekeyStateClass(grant.state)}>{ekeyStateLabel(grant.state)}</Badge>
                {grant.lastError ? (
                  <span className="mt-1 block max-w-xs text-xs text-red-700">{grant.lastError}</span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-gray-600">{formatMalaysiaDateTime(grant.validUntil)}</td>
              <td className="px-3 py-2">
                <EKeyGrantActions grant={grant} returnTo={returnTo} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Refresh reading and power on/off buttons for one TTLock meter. */
export function MeterControlButtons({
  meterId,
  powerState,
  returnTo,
}: {
  meterId: string;
  powerState: string | null;
  returnTo: string;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <form action={refreshMeter}>
        <input name="meterId" type="hidden" value={meterId} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <Button size="sm" type="submit" variant="outline">
          Refresh reading
        </Button>
      </form>
      <form action={switchMeterPower}>
        <input name="meterId" type="hidden" value={meterId} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <input name="power" type="hidden" value={powerState === "on" ? "off" : "on"} />
        <Button size="sm" type="submit" variant="outline">
          {powerState === "on" ? "Switch power off" : "Switch power on"}
        </Button>
      </form>
    </div>
  );
}

export function TTLockNotice({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  return (
    <div className="space-y-2">
      {notice ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}


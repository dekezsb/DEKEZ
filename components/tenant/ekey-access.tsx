import { Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMalaysiaDateTime } from "@/lib/date-format";

export type TenantEKeyGrant = {
  id: string;
  accessScope: string;
  account: string;
  state: string;
  validUntil: string | null;
  lockName: string;
};

function tenantStateLabel(state: string) {
  switch (state) {
    case "active":
      return "Ready in TTLock app";
    case "frozen":
      return "Paused by management";
    case "pending_send":
      return "Sending";
    case "revoke_pending":
      return "Being removed";
    default:
      return state.replaceAll("_", " ");
  }
}

/** Tenant portal: which TTLock app eKeys the tenant has and until when. */
export function TenantEKeyAccess({
  roomName,
  grants,
}: {
  roomName: string;
  grants: TenantEKeyGrant[];
}) {
  if (!grants.length) return null;
  return (
    <Card className="border-[#d8c28c]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="h-4 w-4 text-[#b17f19]" /> Unlock with the TTLock app · {roomName}
        </CardTitle>
        <CardDescription>
          Log in to the TTLock app with {grants[0].account} and pull down to refresh. Your eKeys
          appear there. Use Bluetooth near the door to unlock.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {grants.map((grant) => (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 p-3 text-sm" key={grant.id}>
            <div>
              <p className="font-medium text-gray-900">
                {grant.accessScope === "property_entry" ? "Main door" : "Room door"} · {grant.lockName}
              </p>
              <p className="text-xs text-gray-500">
                Valid until {formatMalaysiaDateTime(grant.validUntil)}
              </p>
            </div>
            <Badge className={grant.state === "active" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
              {tenantStateLabel(grant.state)}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

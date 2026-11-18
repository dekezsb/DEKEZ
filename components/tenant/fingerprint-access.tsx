import { Fingerprint } from "lucide-react";
import { requestTenantFingerprint } from "@/app/tenant/fingerprint-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMalaysiaDateTime } from "@/lib/date-format";
import { fingerprintStatusLabel } from "@/lib/ttlock/fingerprint-support";

export type TenantFingerprintGrant = {
  id: string;
  tenancyId: string;
  accessScope: "property_entry" | "room_entry" | string;
  enrollmentCode: string;
  state: string;
  validUntil: string | null;
  lockName: string;
};

export function TenantFingerprintAccess({
  tenancyId,
  roomName,
  canRequest,
  grants,
}: {
  tenancyId: string;
  roomName: string;
  canRequest: boolean;
  grants: TenantFingerprintGrant[];
}) {
  const openGrants = grants.filter((grant) => grant.state !== "revoked");
  const visibleGrants = openGrants.length ? openGrants : grants;
  const enrollmentCode = visibleGrants[0]?.enrollmentCode ?? null;
  const alreadyRequested = visibleGrants.some((grant) =>
    ["pending_enrollment", "active", "revoke_pending"].includes(grant.state),
  );

  return (
    <Card className="border-[#d8c28c]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Request fingerprint</CardTitle>
            <CardDescription>
              Staff will add your fingerprint at the {roomName} locks. Your phone
              cannot read a finger for the lock, and the gateway cannot add it
              remotely.
            </CardDescription>
          </div>
          <Fingerprint className="h-6 w-6 text-[#b8892c]" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {visibleGrants.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleGrants.map((grant) => (
              <div
                className="rounded-lg border border-[#eadcb9] bg-[#fbf8f1] p-4"
                key={grant.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-950">
                      {grant.accessScope === "property_entry"
                        ? "Main entrance"
                        : "Room door"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{grant.lockName}</p>
                  </div>
                  <Badge
                    className={
                      grant.state === "active"
                        ? "bg-emerald-100 text-emerald-800"
                        : grant.state === "revoked"
                          ? "bg-gray-100 text-gray-700"
                          : "bg-amber-100 text-amber-800"
                    }
                  >
                    {fingerprintStatusLabel(grant.state)}
                  </Badge>
                </div>
                {grant.state === "active" && grant.validUntil ? (
                  <p className="mt-3 text-sm text-gray-700">
                    Valid until{" "}
                    <strong className="text-gray-950">
                      {formatMalaysiaDateTime(grant.validUntil)}
                    </strong>
                  </p>
                ) : grant.state === "pending_enrollment" ? (
                  <p className="mt-3 text-sm text-gray-700">
                    Show this reference to staff at the lock:{" "}
                    <strong className="tracking-wide text-gray-950">
                      {grant.enrollmentCode}
                    </strong>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            You can request a fingerprint for the main entrance and your room.
            Staff will open the TTLock app at the lock, over Bluetooth, and name
            the fingerprint with your reference.
          </p>
        )}

        {enrollmentCode && alreadyRequested ? (
          <p className="rounded-md bg-[#f6edd9] px-3 py-2 text-sm text-gray-800">
            Reference: <strong>{enrollmentCode}</strong>. After staff add your
            finger, it becomes Active until your contract end date.
          </p>
        ) : null}

        {canRequest && !alreadyRequested ? (
          <form action={requestTenantFingerprint}>
            <input name="tenancyId" type="hidden" value={tenancyId} />
            <Button type="submit">
              <Fingerprint className="h-4 w-4" /> Request fingerprint
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

import { Zap } from "lucide-react";
import { submitSmartMeterTopUpForTenant } from "@/app/smart-meter-top-up/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StaffTopUpCandidate } from "@/lib/data/electricity-top-up-admin";

function candidateLabel(candidate: StaffTopUpCandidate) {
  const base = `${candidate.propertyName} / ${candidate.roomName} — ${candidate.tenantName}`;
  if (!candidate.openRequest) return base;
  const statusLabel =
    candidate.openRequest.status === "pending_verification"
      ? "slip pending verification"
      : "approved, awaiting meter top-up";
  return `${base} (already has a top-up ${statusLabel})`;
}

export function StaffElectricityTopUp({
  candidates,
}: {
  candidates: StaffTopUpCandidate[];
}) {
  const availableCount = candidates.filter((c) => !c.openRequest).length;

  return (
    <Card className="overflow-hidden border-amber-300 shadow-sm">
      <CardHeader className="border-b border-amber-200 bg-gradient-to-r from-amber-50 to-white">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950">
            <Zap className="h-6 w-6" />
          </span>
          <div>
            <CardTitle>Submit Tenant&apos;s Electricity Top-Up</CardTitle>
            <CardDescription className="mt-1">
              For tenants who can&apos;t submit it themselves — pick their
              room, enter the amount, and attach a photo of their bank-in
              slip. It still goes through the usual Verification review
              before the meter is credited.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {!candidates.length ? (
          <p className="text-sm text-gray-500">
            No active tenancies at a top-up-enabled property right now.
          </p>
        ) : (
          <form
            action={submitSmartMeterTopUpForTenant}
            className="space-y-4"
            encType="multipart/form-data"
          >
            <label className="block text-sm font-semibold text-gray-900">
              Tenant / room
              <select
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm font-normal"
                defaultValue=""
                name="tenancyId"
                required
              >
                <option disabled value="">
                  {availableCount
                    ? "Select a tenant..."
                    : "All tenants already have an open top-up request"}
                </option>
                {candidates.map((candidate) => (
                  <option
                    disabled={Boolean(candidate.openRequest)}
                    key={candidate.tenancyId}
                    value={candidate.tenancyId}
                  >
                    {candidateLabel(candidate)}
                    {candidate.remainingUnits !== null
                      ? ` · meter: ${candidate.remainingUnits.toFixed(2)} ${candidate.unitLabel ?? "kWh"}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-semibold text-gray-900">
              Top-up amount (RM)
              <input
                className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm font-normal"
                max={500}
                min={10}
                name="amount"
                placeholder="Example: 50"
                required
                step={1}
                type="number"
              />
              <span className="mt-1 block text-xs font-normal text-gray-500">
                Whole Ringgit, RM 10 to RM 500.
              </span>
            </label>

            <label className="block text-sm font-semibold text-gray-900">
              Bank-in slip photo
              <input
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="mt-1 w-full rounded-lg border border-dashed border-amber-400 bg-amber-50 p-2.5 text-sm font-normal"
                name="paymentSlip"
                required
                type="file"
              />
              <span className="mt-1 block text-xs font-normal text-gray-500">
                Image or PDF, up to 5 MB.
              </span>
            </label>

            <Button
              className="h-11 w-full bg-amber-500 text-sm font-bold text-amber-950 hover:bg-amber-400"
              type="submit"
            >
              Submit for verification
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

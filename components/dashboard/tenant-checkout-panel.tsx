import { DoorOpen } from "lucide-react";
import { checkoutTenantFromManagement } from "@/app/dashboard/checkout-actions";
import { TenantCheckoutSubmit } from "@/components/dashboard/tenant-checkout-submit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TenantCheckoutCandidate } from "@/lib/data/tenant-checkouts";
import { formatMalaysiaDate } from "@/lib/date-format";

const checkoutErrors: Record<string, string> = {
  confirm: "Choose an occupied room, enter the checkout date and tick the confirmation box.",
  invalid: "Choose a valid occupied room and checkout date.",
  stale: "This room is already vacant or the tenant has already checked out. Refresh and try again.",
  date_before_checkin: "The checkout date cannot be earlier than the tenant's check-in date.",
  future_date: "The checkout date cannot be in the future.",
  lock: "Checkout stopped because the linked smart-lock access could not be removed. Ask the Super Admin to check the lock connection.",
  failed: "The checkout could not be completed. Nothing else should be submitted until the Super Admin reviews this room.",
};

function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function TenantCheckoutPanel({
  candidates,
  error,
  phoneRelease,
  saved,
}: {
  candidates: TenantCheckoutCandidate[];
  error?: string;
  phoneRelease?: string;
  saved: boolean;
}) {
  return (
    <Card className="border-red-200 shadow-sm">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
            <DoorOpen className="h-5 w-5" />
          </span>
          <div>
            <CardTitle>Check Out Tenant</CardTitle>
            <CardDescription className="mt-1 leading-6">
              Use this when the old tenant has moved out and the room must be
              cleared for a new registration. Records are retained for audit.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {saved ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {phoneRelease === "failed"
              ? "Tenant checked out successfully and the room is vacant. The phone-login release needs a Super Admin review."
              : phoneRelease === "kept_for_active_tenancy"
                ? "Tenant checked out successfully and the room is vacant. The phone login was kept because the tenant still has another active room."
                : "Tenant checked out successfully. The room is vacant, the old phone login is released for future registration, and the action is recorded for the Super Admin."}
          </p>
        ) : null}
        {saved && phoneRelease === "failed" ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            The room was checked out, but the old phone login could not be
            released automatically. Ask the Super Admin to review it before
            registering the same phone number again.
          </p>
        ) : null}
        {saved && phoneRelease === "kept_for_active_tenancy" ? (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900">
            This phone login was kept because the tenant still has another
            active room.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {checkoutErrors[error] ?? checkoutErrors.failed}
          </p>
        ) : null}

        {candidates.length ? (
          <form action={checkoutTenantFromManagement} className="space-y-4">
            <div>
              <label className="text-sm font-medium" htmlFor="checkout-tenancy">
                Occupied room and tenant *
              </label>
              <select
                className="mt-1 min-h-11 w-full rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-sm"
                defaultValue=""
                id="checkout-tenancy"
                name="tenancyId"
                required
              >
                <option disabled value="">
                  Choose the tenant who has moved out
                </option>
                {candidates.map((candidate) => (
                  <option key={candidate.tenancyId} value={candidate.tenancyId}>
                    {candidate.propertyName} · {candidate.roomName} · {candidate.tenantName}
                    {candidate.tenantPhone ? ` · ${candidate.tenantPhone}` : ""} · In {formatMalaysiaDate(candidate.checkInDate)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Only currently occupied rooms are listed.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium" htmlFor="checkout-date">
                  Actual checkout date *
                </label>
                <input
                  className="mt-1 min-h-11 w-full rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-sm"
                  defaultValue={malaysiaToday()}
                  id="checkout-date"
                  max={malaysiaToday()}
                  name="checkoutDate"
                  required
                  type="date"
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="checkout-note">
                  Checkout note (optional)
                </label>
                <input
                  className="mt-1 min-h-11 w-full rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-sm"
                  id="checkout-note"
                  maxLength={500}
                  name="note"
                  placeholder="Example: Key returned to Rosley"
                  type="text"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-900">
              <input
                className="mt-1 h-4 w-4 shrink-0"
                name="confirmed"
                required
                type="checkbox"
                value="yes"
              />
              <span>
                I confirm this tenant has moved out. The active tenancy will
                end, linked door access will be removed and the room will become
                vacant. If this is the tenant's final active room, their old
                phone login will be released for re-registration. Signed
                agreements and invoices remain in history.
              </span>
            </label>

            <TenantCheckoutSubmit />
          </form>
        ) : (
          <p className="rounded-md border border-[#d7dde5] bg-[#f7f9fb] px-4 py-3 text-sm text-gray-600">
            No occupied tenant room is currently available for checkout.
          </p>
        )}

        <details className="rounded-md border border-[#d7dde5] bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-[#18304f]">
            Checkout SOP
          </summary>
          <div className="mt-3 space-y-1 text-gray-600">
            <p>1. Confirm the tenant and room carefully.</p>
            <p>2. Enter the tenant's actual checkout date.</p>
            <p>3. Add a note if keys or access were handed over.</p>
            <p>4. Submit once only; the Super Admin can see the audit record.</p>
            <p>
              5. The old phone login is released only when the tenant has no
              other active room, so the same number can be used at another
              branch.
            </p>
            <p>
              The selected tenant's check-in date is shown in the main records;
              checkout earlier than that date is blocked.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

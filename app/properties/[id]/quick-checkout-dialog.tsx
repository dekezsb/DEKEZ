"use client";

import { CalendarDays, CheckCircle2, LogOut, X } from "lucide-react";
import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { checkoutRoom } from "./actions";

type QuickCheckoutDialogProps = {
  checkoutDate: string;
  propertyId: string;
  roomId: string;
  roomNumber: string;
  tenancyId: string;
  tenantName: string;
};

function CheckoutSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      <LogOut aria-hidden="true" className="h-4 w-4" />
      {pending ? "Checking out..." : "Confirm Check Out"}
    </button>
  );
}

export function QuickCheckoutDialog({
  checkoutDate,
  propertyId,
  roomId,
  roomNumber,
  tenancyId,
  tenantName,
}: QuickCheckoutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button
        className="border-red-200 text-red-700 hover:bg-red-50"
        onClick={() => dialogRef.current?.showModal()}
        size="sm"
        type="button"
        variant="outline"
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
        Check Out
      </Button>

      <dialog
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-md border border-[#d7dde5] bg-white p-0 text-gray-950 shadow-2xl backdrop:bg-black/45"
        ref={dialogRef}
      >
        <form action={checkoutRoom} className="p-5 sm:p-6">
          <input name="propertyId" type="hidden" value={propertyId} />
          <input name="roomId" type="hidden" value={roomId} />
          <input name="tenancyId" type="hidden" value={tenancyId} />

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
                Admin checkout
              </p>
              <h2 className="mt-1 text-lg font-semibold">Check out this tenant?</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                <span className="font-semibold text-gray-950">{tenantName}</span>
                {" · "}
                {roomNumber}
              </p>
            </div>
            <button
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-950"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <label className="mt-5 block">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <CalendarDays aria-hidden="true" className="h-4 w-4" />
              Check-out date
            </span>
            <input
              className="mt-2 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm outline-none focus:border-[#b8892c] focus:ring-2 focus:ring-[#b8892c]/20"
              defaultValue={checkoutDate}
              max={checkoutDate}
              name="checkoutDate"
              required
              type="date"
            />
          </label>

          <div className="mt-5 rounded-md border border-[#eadcb9] bg-[#fbf8f1] p-4">
            <p className="text-sm font-semibold text-gray-950">The checkout SOP runs automatically:</p>
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              <li className="flex gap-2">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                Room becomes vacant and ready for a new tenant.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                Future and open rent bills stop; audit invoices stay archived for 7 years.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                Unsigned agreements are removed; signed copies remain archived.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                Room and main-door smart-lock access is revoked.
              </li>
            </ul>
          </div>

          <p className="mt-4 text-xs leading-5 text-gray-500">
            This checks out only the tenant shown above. If the room changed since this page loaded, checkout will stop safely.
          </p>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              onClick={() => dialogRef.current?.close()}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <CheckoutSubmitButton />
          </div>
        </form>
      </dialog>
    </>
  );
}

"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";

export function CheckoutForm({
  action,
  propertyId,
  roomId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  propertyId: string;
  roomId: string;
}) {
  function confirmCheckout(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("Check out this tenant, close the tenancy, and stop future rent bills?")) {
      event.preventDefault();
    }
  }

  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={confirmCheckout}>
      <input name="propertyId" type="hidden" value={propertyId} />
      <input name="roomId" type="hidden" value={roomId} />
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Checkout date</span>
        <input className="mt-1.5 rounded-md border border-[#d7dde5] px-3 py-2 text-sm" name="checkoutDate" type="date" required />
      </label>
      <Button className="bg-red-600 text-white hover:bg-red-700" type="submit">Check Out Tenant</Button>
    </form>
  );
}

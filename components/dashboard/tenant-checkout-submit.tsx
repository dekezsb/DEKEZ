"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function TenantCheckoutSubmit() {
  const { pending } = useFormStatus();

  return (
    <Button
      className="w-full bg-red-600 text-white hover:bg-red-700"
      disabled={pending}
      type="submit"
    >
      {pending ? "Checking tenant out…" : "Check Out Tenant & Vacate Room"}
    </Button>
  );
}

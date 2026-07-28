"use client";

import { Upload } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function PaymentSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      className="h-12 w-full sm:w-auto"
      disabled={pending}
      type="submit"
    >
      <Upload className="h-4 w-4" />
      {pending ? "Submitting..." : "Submit payment"}
    </Button>
  );
}

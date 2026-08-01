"use client";

import { Send } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function RenewalWhatsAppSubmit({ resend }: { resend: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} size="sm" type="submit">
      <Send className="h-4 w-4" />
      {pending
        ? "Sending..."
        : resend
          ? "Send WhatsApp again"
          : "Send WhatsApp reminder"}
    </Button>
  );
}

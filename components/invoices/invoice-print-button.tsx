"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InvoicePrintButton() {
  return (
    <Button onClick={() => window.print()} type="button">
      <Printer className="h-4 w-4" />
      Print / Save PDF
    </Button>
  );
}

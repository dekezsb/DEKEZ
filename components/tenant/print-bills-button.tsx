"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintBillsButton() {
  return (
    <Button
      className="print:hidden"
      type="button"
      variant="outline"
      onClick={() => window.print()}
    >
      <Printer className="h-4 w-4" />
      Print / Save PDF
    </Button>
  );
}

"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return <Button className="print:hidden" onClick={() => window.print()} type="button"><Printer className="h-4 w-4" />{label}</Button>;
}

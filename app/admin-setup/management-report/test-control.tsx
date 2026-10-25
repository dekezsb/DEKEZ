"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { sendTestReport } from "./actions";

export function TestReportControl({ enabled }: { enabled: boolean }) {
  const [message, action, pending] = useActionState(sendTestReport, "");
  return <form action={action} className="space-y-3">
    <Button type="submit" disabled={!enabled || pending}>{pending ? "Sending…" : "Send Test Report"}</Button>
    <p role="status" className="text-sm text-gray-600">{message || "One test report per company, recipient and Malaysia date. No real sending until approved and enabled."}</p>
  </form>;
}

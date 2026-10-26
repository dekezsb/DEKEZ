import { requireRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { reportConfig } from "@/lib/management-report/config";
import { reportPreview } from "@/lib/management-report/service";
import { formatReport } from "@/lib/management-report/model";
import { TestReportControl } from "./test-control";

export const dynamic = "force-dynamic";

export default async function ManagementReportPage() {
  await requireRole(["super_admin"], { module: "admin_setup", level: "manage" });
  if (!await reportAdministrator()) redirect("/");
  const config = reportConfig();
  let preview = "Configure the report company and install the reviewed migration to preview actual totals. No sample figures are displayed.";
  if (config.scopeReady) {
    try { preview = formatReport(await reportPreview(), "test"); }
    catch { preview = "Report data is unavailable. Check the reviewed migration and company configuration. No message has been sent."; }
  }
  return <section className="space-y-6">
    <div><h1 className="text-2xl font-semibold sm:text-3xl">Daily Management Report</h1>
      <p className="mt-2 text-sm text-gray-600">Private DEKEZ summary via Whapi. Existing tenant WhatsApp services are unchanged.</p></div>
    <Card><CardHeader><CardTitle>Delivery controls</CardTitle>
      <CardDescription>8:00 PM Malaysia time. Sending and scheduling require separate approval and configuration.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">Recipient: {config.recipient} · Configuration: {config.configured ? "Ready" : "Incomplete"}</p>
        <p className="text-sm">Ordinary sending: {config.sendEnabled ? "Enabled" : "Disabled"} · Ordinary testing: {config.testEnabled ? "Enabled" : "Disabled"} · Daily schedule gate: {config.scheduleEnabled ? "Enabled" : "Disabled"}</p>
        <p className="text-sm text-gray-600">An authorized Admin can separately request a five-minute, single-use test authorization. Review and confirmation are required; no environment switches are changed.</p>
        <TestReportControl enabled={config.configured && config.recipient === "60168173911" && !config.scheduleEnabled} />
      </CardContent></Card>
    <Card><CardHeader><CardTitle>Read-only preview</CardTitle><CardDescription>Current company snapshot. Previewing never reserves or sends a report.</CardDescription></CardHeader>
      <CardContent><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{preview}</pre></CardContent></Card>
  </section>;
}

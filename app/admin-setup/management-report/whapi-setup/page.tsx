import { notFound, redirect } from "next/navigation";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { getSetupAvailability } from "@/lib/management-report/temporary-whapi-setup";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TemporarySetupControl } from "./setup-control";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function TemporaryWhapiSetupPage() {
  if (!getSetupAvailability().available) notFound();
  if (!await reportAdministrator()) redirect("/");
  return <section className="space-y-6">
    <h1 className="text-2xl font-semibold">Temporary WhatsApp reporting setup</h1>
    <Card><CardHeader><CardTitle>Approved incoming command activation</CardTitle>
      <CardDescription>Temporary, expiring Admin control. Existing daily reporting and business records are not changed.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">Channel: FALCON-D9NS9 · Configured sender: 60168173911 · Authorized reporting contact: 60198894911</p>
        <p className="text-sm break-all">Callback: https://dekez.vercel.app/api/webhooks/whapi-reporting</p>
        <p className="text-sm">Event: messages.post · Authentication: dedicated Bearer secret · Commands remain disabled until the cleanup release.</p>
        <TemporarySetupControl />
      </CardContent></Card>
  </section>;
}

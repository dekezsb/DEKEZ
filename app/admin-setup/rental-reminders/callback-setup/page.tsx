import { notFound } from "next/navigation";
import { reportAdministrator } from "@/lib/management-report/authorization";
import { callbackDiagnosticsEnabled, setupConfig } from "@/lib/rental-collection/callback-setup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallbackSetupControl } from "./setup-control";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function CallbackSetupPage() {
  if (!await reportAdministrator()) notFound();
  const setupEnabled = !!setupConfig(), diagnosticsEnabled = callbackDiagnosticsEnabled();
  if (!setupEnabled && !diagnosticsEnabled) notFound();
  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold">{diagnosticsEnabled ? "Rental callback diagnostics" : "Temporary rental callback setup"}</h1>
    <a className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm" href="/admin-setup/rental-reminders">Back to rental reminders</a>
    <Card><CardHeader><CardTitle>{diagnosticsEnabled ? "Read-only checks · setup stays disabled" : "One approved operation · sending stays off"}</CardTitle></CardHeader><CardContent>
      <CallbackSetupControl setupEnabled={setupEnabled} diagnosticsEnabled={diagnosticsEnabled} />
    </CardContent></Card>
  </section>;
}

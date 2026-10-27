import { readTemporaryWhapiDiagnostic } from "@/lib/management-report/temporary-whapi-diagnostic";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export default async function TemporaryWhapiDiagnosticPage() {
  const result = await readTemporaryWhapiDiagnostic();
  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold">Read-only Whapi callback diagnostic</h1>
    <p className="text-sm text-gray-600">Authorized Admin review only. This temporary page cannot change settings, activate commands or send messages. Only safe comparison results are shown.</p>
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-white p-4 text-sm">{JSON.stringify(result, null, 2)}</pre>
  </section>;
}

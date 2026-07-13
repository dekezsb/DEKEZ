import { FileBarChart } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { reports } from "@/lib/dummy-data";
import { requireRole } from "@/lib/auth/session";

export default async function ReportsPage() {
  await requireRole(["owner", "admin"]);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Insights</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Reports</h1>
        <p className="mt-2 text-sm text-gray-600">Dummy report menu for Phase 1.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {reports.map((report) => (
          <Card key={report}>
            <CardHeader>
              <FileBarChart className="h-5 w-5 text-[#126b5f]" />
              <CardTitle>{report}</CardTitle>
              <CardDescription>Preview report card</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">Dummy data only.</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

import Link from "next/link";
import { AlertTriangle, Building2, DoorOpen, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getDashboardSummary } from "@/lib/data/organization";

function stat(label: string, value: string | number, detail: string) {
  return { label, value, detail };
}

export default async function DashboardPage() {
  const role = await requireRole(["super_admin", "owner", "admin", "tenant"]);
  const summary = await getDashboardSummary();
  const needsSetup = role === "owner" && summary.companies.length === 0;

  const stats = [
    stat("Total Properties", summary.totalProperties, "Saved in Supabase"),
    stat("Total Rooms", summary.totalRooms, "Across your visible companies"),
    stat("Occupied Rooms", summary.occupiedRooms, "Rooms marked occupied"),
    stat("Vacant Rooms", summary.vacantRooms, "Ready for tenancy"),
    stat("Monthly Income", "RM 0.00", "Payments start in a later phase"),
    stat("Outstanding Rent", "RM 0.00", "Tenancies start in a later phase"),
    stat("Expiring Contracts", 0, "Contracts start in a later phase"),
    stat("Maintenance Requests", 0, "Maintenance jobs start in a later phase"),
  ];

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Overview</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Admin Dashboard
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Your live business foundation. Financial and tenant modules will be added after the setup data is stable.
        </p>
      </div>

      {needsSetup ? (
        <Card>
          <CardHeader>
            <CardTitle>Complete owner setup</CardTitle>
            <CardDescription>
              Create your first company, property and room before using the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/setup">Start setup</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-2xl">{item.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">{item.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[#126b5f]" />
              Companies
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.companies.length ? (
              summary.companies.map((company) => (
                <div className="rounded-md border border-[#d7dde5] p-3" key={company.id}>
                  <p className="text-sm font-medium">{company.name}</p>
                  <p className="text-xs text-gray-500">{company.email ?? "No email"}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No company setup yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-[#126b5f]" />
              Room Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <p>Vacant: {summary.vacantRooms}</p>
            <p>Occupied: {summary.occupiedRooms}</p>
            <p>Reserved: {summary.reservedRooms}</p>
            <p>Maintenance: {summary.maintenanceRooms}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-[#126b5f]" />
              Cash Flow
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <p>Total money received: RM 0.00</p>
            <p>Total money paid out: RM 0.00</p>
            <p className="font-semibold text-gray-950">Net cash flow: RM 0.00</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[#126b5f]" />
            Next Modules
          </CardTitle>
          <CardDescription>
            Tenants, payments, maintenance jobs and reports are still placeholders until the next phases.
          </CardDescription>
        </CardHeader>
      </Card>
    </section>
  );
}

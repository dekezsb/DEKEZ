import Link from "next/link";
import { AlertTriangle, BriefcaseBusiness, Building2, DoorOpen, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getDashboardSummary } from "@/lib/data/organization";
import { getOwnerPortalSummary, getStaffPortalSummary, getTenantPortalSummary } from "@/lib/data/portal";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

function money(value: number) {
  return ringgitFormatter.format(value);
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const role = await requireRole([
    "super_admin",
    "owner",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
    "tenant",
  ]);

  if (role === "tenant") {
    return <TenantDashboard />;
  }

  if (["technician", "maintenance_staff", "cleaning_staff"].includes(role)) {
    return <StaffDashboard />;
  }

  if (role === "owner") {
    return <OwnerDashboard />;
  }

  return <AdminDashboard />;
}

async function OwnerDashboard() {
  const [summary, setupSummary] = await Promise.all([
    getOwnerPortalSummary(),
    getDashboardSummary(),
  ]);
  const needsSetup = setupSummary.companies.length === 0;
  const netPayable =
    summary.monthlyRentalCollected -
    summary.waterBills -
    summary.electricityBills -
    summary.maintenanceExpenses;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Owner Portal</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Owner Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Portfolio, rental income, utilities, claims and maintenance visibility scoped by Supabase RLS.
        </p>
      </div>

      {needsSetup ? (
        <Card>
          <CardHeader>
            <CardTitle>Complete owner setup</CardTitle>
            <CardDescription>Create your first company, property and room.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/setup">Start setup</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total properties owned" value={summary.totalProperties} detail="Visible owned portfolio" />
        <StatCard label="Total units owned" value={summary.totalUnits} detail="Units under owned properties" />
        <StatCard label="Total rooms owned" value={summary.totalRooms} detail="Rooms under owned portfolio" />
        <StatCard label="Occupied rooms" value={summary.occupiedRooms} detail="Rooms currently occupied" />
        <StatCard label="Vacant rooms" value={summary.vacantRooms} detail="Rooms ready to rent" />
        <StatCard label="Monthly rental expected" value={money(summary.monthlyRentalExpected)} detail="Based on room rent setup" />
        <StatCard label="Monthly rental collected" value={money(summary.monthlyRentalCollected)} detail="Confirmed rental paid" />
        <StatCard label="Outstanding rental" value={money(summary.outstandingRental)} detail="Unpaid rental balance" />
        <StatCard label="Water bills" value={money(summary.waterBills)} detail="Water utility charges" />
        <StatCard label="Electricity bills" value={money(summary.electricityBills)} detail="Electricity utility charges" />
        <StatCard label="Maintenance expenses" value={money(summary.maintenanceExpenses)} detail="Approved claim amount" />
        <StatCard label="Open maintenance tickets" value={summary.openMaintenanceTickets} detail="Not closed yet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Claims</CardTitle>
            <CardDescription>Owner approval queue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            <p>Pending claims: {summary.pendingClaims}</p>
            <p>Approved claims: {summary.approvedClaims}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Monthly Profit Summary</CardTitle>
            <CardDescription>Cash-flow view, not full accounting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            <p>Rental collected: {money(summary.monthlyRentalCollected)}</p>
            <p>Water bills: {money(summary.waterBills)}</p>
            <p>Electricity bills: {money(summary.electricityBills)}</p>
            <p>Maintenance claims: {money(summary.maintenanceExpenses)}</p>
            <p className="font-semibold text-gray-950">Net payable: {money(netPayable)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
            <CardDescription>Manage inside modules.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild variant="outline"><Link href="/properties">My Properties</Link></Button>
            <Button asChild variant="outline"><Link href="/rooms">My Rooms</Link></Button>
            <Button asChild variant="outline"><Link href="/claims">Claims</Link></Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

async function TenantDashboard() {
  const summary = await getTenantPortalSummary();

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Tenant Portal</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Tenant Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Your room, bills, payments and maintenance tickets only.
        </p>
      </div>

      {summary && !summary.hasTenancy ? (
        <Card>
          <CardHeader>
            <CardTitle>Your room or tenancy has not been assigned yet.</CardTitle>
            <CardDescription>
              The Owner or Admin Team will assign your company, room and tenancy later.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Monthly rental" value={money(summary?.monthlyRental ?? 0)} detail="Assigned tenancy rental" />
        <StatCard label="Rental due date" value={summary?.dueDay ? `Day ${summary.dueDay}` : "-"} detail="Monthly due day" />
        <StatCard label="Outstanding amount" value={money(summary?.outstandingAmount ?? 0)} detail="Rent still unpaid" />
        <StatCard label="Account balance" value={money(summary?.balance ?? 0)} detail="Wallet or top-up balance" />
        <StatCard label="Water bill" value={money(summary?.waterBill ?? 0)} detail="Visible tenant bill" />
        <StatCard label="Electricity bill" value={money(summary?.electricityBill ?? 0)} detail="Visible tenant bill" />
        <StatCard label="Payment history" value={money(summary?.paymentHistoryTotal ?? 0)} detail="Total recorded payments" />
        <StatCard label="Open tickets" value={summary?.openTickets ?? 0} detail="Maintenance or cleaning requests" />
      </div>
    </section>
  );
}

async function StaffDashboard() {
  const summary = await getStaffPortalSummary();

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Staff Portal</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Maintenance & Cleaning Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Only jobs assigned to your account are visible.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="New assigned jobs" value={summary.newAssignedJobs} detail="Waiting for acceptance" />
        <StatCard label="In-progress jobs" value={summary.inProgressJobs} detail="Currently being worked on" />
        <StatCard label="Waiting for parts" value={summary.waitingForParts} detail="Paused for materials" />
        <StatCard label="Completed jobs" value={summary.completedJobs} detail="Finished assignments" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-[#126b5f]" />
            Assigned Work
          </CardTitle>
          <CardDescription>
            Open Maintenance to accept jobs, update status and prepare claims.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/maintenance">Open maintenance jobs</Link>
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

async function AdminDashboard() {
  const summary = await getDashboardSummary();

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Admin Portal</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Admin Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Admin view across records allowed by Supabase RLS.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Companies" value={summary.companies.length} detail="Visible organizations" />
        <StatCard label="Properties" value={summary.totalProperties} detail="Managed properties" />
        <StatCard label="Rooms" value={summary.totalRooms} detail="Managed rooms" />
        <StatCard label="Vacant rooms" value={summary.vacantRooms} detail="Available rooms" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[#126b5f]" />
              Property Setup
            </CardTitle>
            <CardDescription>Create properties, units and rooms.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BriefcaseBusiness className="h-5 w-5 text-[#126b5f]" />
              Operations
            </CardTitle>
            <CardDescription>Assign tenants and maintenance jobs in upcoming forms.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[#126b5f]" />
              Security
            </CardTitle>
            <CardDescription>Access is enforced by Supabase RLS, not frontend filtering.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </section>
  );
}

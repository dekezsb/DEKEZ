import Link from "next/link";
import {
  Banknote,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  DoorOpen,
  Droplets,
  FileText,
  Home,
  ReceiptText,
  Upload,
  WalletCards,
  Wrench,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

function ModuleCard({
  title,
  description,
  href,
  icon: Icon,
  badge,
}: {
  title: string;
  description: string;
  href: string;
  icon: typeof Home;
  badge?: string | number;
}) {
  return (
    <Link
      className="block rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm transition hover:border-[#126b5f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#126b5f] focus:ring-offset-2"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#e7f2f0] text-[#126b5f]">
            <Icon className="h-5 w-5" />
          </span>
          <h2 className="text-sm font-semibold text-gray-950">{title}</h2>
        </div>
        {badge !== undefined ? <Badge>{badge}</Badge> : null}
      </div>
      <p className="mt-4 text-sm leading-6 text-gray-600">{description}</p>
    </Link>
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
    return <MaintenanceDashboard />;
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
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Manage your owned properties, rooms, rental income, utility bills, maintenance claims and reports.
        </p>
      </div>

      {needsSetup ? (
        <Card>
          <CardHeader>
            <CardTitle>Complete owner setup</CardTitle>
            <CardDescription>Create your first company, property and room before managing your portfolio.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/setup">Start setup</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="My Properties" value={summary.totalProperties} detail="Properties owned or visible to you" />
        <StatCard label="My Units" value={summary.totalUnits} detail="Units under your properties" />
        <StatCard label="My Rooms" value={summary.totalRooms} detail="Rooms under your portfolio" />
        <StatCard label="Vacant Rooms" value={summary.vacantRooms} detail="Available rooms" />
        <StatCard label="Rental Income" value={money(summary.monthlyRentalCollected)} detail="Collected this cycle" />
        <StatCard label="Outstanding Rental" value={money(summary.outstandingRental)} detail="Unpaid rent balance" />
        <StatCard label="Water Bills" value={money(summary.waterBills)} detail="Water charges" />
        <StatCard label="Electricity Bills" value={money(summary.electricityBills)} detail="Electricity charges" />
        <StatCard label="Maintenance Claims" value={summary.pendingClaims} detail="Pending owner approval" />
        <StatCard label="Approved Claims" value={summary.approvedClaims} detail="Approved expenses" />
        <StatCard label="Open Tickets" value={summary.openMaintenanceTickets} detail="Maintenance not closed" />
        <StatCard label="Net Payable" value={money(netPayable)} detail="Income minus utilities and claims" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ModuleCard title="My Properties" description="View properties assigned to your ownership." href="/properties" icon={Building2} badge={summary.totalProperties} />
        <ModuleCard title="My Units" description="Review units inside your owned properties." href="/units" icon={Home} badge={summary.totalUnits} />
        <ModuleCard title="My Rooms" description="Track occupied, vacant, reserved and maintenance rooms." href="/rooms" icon={DoorOpen} badge={summary.totalRooms} />
        <ModuleCard title="Rental Income" description="Open rent and payment records for your portfolio." href="/payments" icon={Banknote} />
        <ModuleCard title="Water Bills" description="Check water utility charges linked to your rooms." href="/utility-bills" icon={Droplets} />
        <ModuleCard title="Electricity Bills" description="Review electricity utility costs and balances." href="/utility-bills" icon={Zap} />
        <ModuleCard title="Maintenance Claims" description="Approve, reject, or review maintenance claim costs." href="/claims" icon={ClipboardCheck} badge={summary.pendingClaims} />
        <ModuleCard title="Reports" description="View cash-flow, rental and maintenance summaries." href="/reports" icon={BarChart3} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Owner Profit Snapshot</CardTitle>
            <CardDescription>Cash-flow view for non-accounting users.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            <p>Rental collected: {money(summary.monthlyRentalCollected)}</p>
            <p>Water bills: {money(summary.waterBills)}</p>
            <p>Electricity bills: {money(summary.electricityBills)}</p>
            <p>Maintenance claims: {money(summary.maintenanceExpenses)}</p>
            <p className="font-semibold text-gray-950">Net amount payable: {money(netPayable)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next Actions</CardTitle>
            <CardDescription>Common owner tasks.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline"><Link href="/claims">Review claims</Link></Button>
            <Button asChild variant="outline"><Link href="/utility-bills">View bills</Link></Button>
            <Button asChild variant="outline"><Link href="/maintenance">Open tickets</Link></Button>
            <Button asChild variant="outline"><Link href="/reports">View reports</Link></Button>
          </CardContent>
        </Card>
      </div>
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
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Full daily management for properties, rooms, tenants, payments, maintenance and reports.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Properties" value={summary.totalProperties} detail="Managed properties" />
        <StatCard label="Rooms" value={summary.totalRooms} detail="All managed rooms" />
        <StatCard label="Occupied Rooms" value={summary.occupiedRooms} detail="Rooms currently occupied" />
        <StatCard label="Vacant Rooms" value={summary.vacantRooms} detail="Rooms available now" />
        <StatCard label="Reserved Rooms" value={summary.reservedRooms} detail="Rooms reserved" />
        <StatCard label="Maintenance Rooms" value={summary.maintenanceRooms} detail="Rooms under maintenance" />
        <StatCard label="Companies" value={summary.companies.length} detail="Visible organizations" />
        <StatCard label="Setup Status" value="Ready" detail="Use Admin Setup to connect records" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ModuleCard title="Full Property Management" description="Create and manage properties and ownership setup." href="/properties" icon={Building2} badge={summary.totalProperties} />
        <ModuleCard title="Room Management" description="Create rooms, set rent, and monitor room status." href="/rooms" icon={DoorOpen} badge={summary.totalRooms} />
        <ModuleCard title="Tenant Management" description="Create tenants and assign them to rooms through Admin Setup." href="/tenants" icon={BriefcaseBusiness} />
        <ModuleCard title="Payment Management" description="View rent collections and tenant payment records." href="/payments" icon={CreditCard} />
        <ModuleCard title="Maintenance Management" description="Create tickets and coordinate work with staff." href="/maintenance" icon={Wrench} />
        <ModuleCard title="Reports" description="Review portfolio, rental, bill and maintenance reports." href="/reports" icon={BarChart3} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Admin Setup Flow</CardTitle>
          <CardDescription>Create the minimum data needed before tenant and maintenance workflows.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Button asChild variant="outline"><Link href="/admin-setup">Create users</Link></Button>
          <Button asChild variant="outline"><Link href="/admin-setup">Assign owner</Link></Button>
          <Button asChild variant="outline"><Link href="/admin-setup">Assign tenant</Link></Button>
          <Button asChild variant="outline"><Link href="/maintenance">Create ticket</Link></Button>
        </CardContent>
      </Card>
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
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          View your room, rental, bills, balance, contract, payment history and maintenance requests.
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
        <StatCard label="My Rental" value={money(summary?.monthlyRental ?? 0)} detail="Monthly rental amount" />
        <StatCard label="Rental Due Date" value={summary?.dueDay ? `Day ${summary.dueDay}` : "-"} detail="Payment due each month" />
        <StatCard label="Outstanding Amount" value={money(summary?.outstandingAmount ?? 0)} detail="Unpaid balance" />
        <StatCard label="Top Up Balance" value={money(summary?.balance ?? 0)} detail="Wallet or account balance" />
        <StatCard label="Water Bill" value={money(summary?.waterBill ?? 0)} detail="Current water charges" />
        <StatCard label="Electricity Bill" value={money(summary?.electricityBill ?? 0)} detail="Current electricity charges" />
        <StatCard label="Payment History" value={money(summary?.paymentHistoryTotal ?? 0)} detail="Recorded payments" />
        <StatCard label="Maintenance Requests" value={summary?.openTickets ?? 0} detail="Open tenant tickets" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ModuleCard title="My Room" description="View your assigned room once Admin creates your tenancy." href="/rooms" icon={DoorOpen} />
        <ModuleCard title="My Rental" description="Check monthly rent, due date and outstanding balance." href="/payments" icon={Banknote} />
        <ModuleCard title="My Bills" description="View water, electricity and other utility bills." href="/utility-bills" icon={ReceiptText} />
        <ModuleCard title="Top Up" description="Review account balance and top-up history." href="/payments" icon={WalletCards} />
        <ModuleCard title="Maintenance Request" description="Submit repair, maintenance or cleaning requests." href="/maintenance" icon={Wrench} badge={summary?.openTickets ?? 0} />
        <ModuleCard title="My Contract" description="View contract dates and tenancy details." href="/payments" icon={FileText} />
        <ModuleCard title="Payment History" description="Track all recorded rental and bill payments." href="/payments" icon={CreditCard} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contract Summary</CardTitle>
          <CardDescription>Shown after Admin assigns your tenancy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          <p>Contract start: {summary?.contractStart ?? "-"}</p>
          <p>Contract end: {summary?.contractEnd ?? "-"}</p>
          <p>Monthly due day: {summary?.dueDay ? `Day ${summary.dueDay}` : "-"}</p>
        </CardContent>
      </Card>
    </section>
  );
}

async function MaintenanceDashboard() {
  const summary = await getStaffPortalSummary();

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Maintenance & Cleaning Portal</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Maintenance Dashboard</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          View assigned jobs, update work progress, upload photos and submit claims.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Assigned Jobs" value={summary.newAssignedJobs} detail="New jobs assigned to you" />
        <StatCard label="Work In Progress" value={summary.inProgressJobs} detail="Jobs currently being worked on" />
        <StatCard label="Waiting For Parts" value={summary.waitingForParts} detail="Jobs paused for materials" />
        <StatCard label="Completed Jobs" value={summary.completedJobs} detail="Finished assigned jobs" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ModuleCard title="Assigned Jobs" description="Open jobs assigned to your staff account only." href="/maintenance" icon={ClipboardList} badge={summary.newAssignedJobs} />
        <ModuleCard title="Work In Progress" description="Update ongoing job status and work notes." href="/maintenance" icon={Wrench} badge={summary.inProgressJobs} />
        <ModuleCard title="Completed Jobs" description="Review completed maintenance and cleaning work." href="/maintenance" icon={ClipboardCheck} badge={summary.completedJobs} />
        <ModuleCard title="Upload Before Photos" description="Attach before-work photos to a maintenance ticket." href="/maintenance" icon={Upload} />
        <ModuleCard title="Upload After Photos" description="Attach after-work photos before marking completed." href="/maintenance" icon={Upload} />
        <ModuleCard title="Submit Claim" description="Record labour/material costs and submit owner claim." href="/claims" icon={ReceiptText} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Staff Workflow</CardTitle>
          <CardDescription>Use this order when handling a repair or cleaning job.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
          <p>1. Accept assigned job</p>
          <p>2. Start work and update status</p>
          <p>3. Upload before and after photos</p>
          <p>4. Submit claim for approval</p>
        </CardContent>
      </Card>
    </section>
  );
}

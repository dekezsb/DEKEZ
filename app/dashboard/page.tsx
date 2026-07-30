import { Link } from "@/components/app-link";
import {
  Banknote,
  BarChart3,
  Building2,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  Droplets,
  Home,
  ReceiptText,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AgreementRenewalReminders } from "@/components/dashboard/agreement-renewal-reminders";
import { CompanyCashInHand } from "@/components/dashboard/company-cash-in-hand";
import { CompactRentDueTracker } from "@/components/dashboard/compact-rent-due-tracker";
import { DepositOutstanding } from "@/components/dashboard/deposit-outstanding";
import { TenantHome } from "@/components/tenant/tenant-portal";
import { requireRole } from "@/lib/auth/session";
import { getAgreementRenewalReminders } from "@/lib/data/agreement-renewals";
import { getCashManagementSummary } from "@/lib/data/cash-management";
import { getDepositOutstandingSummary } from "@/lib/data/deposit-outstanding";
import { getDashboardSummary } from "@/lib/data/organization";
import { getOwnerPortalSummary, getStaffPortalSummary } from "@/lib/data/portal";
import { getRentDueSummary } from "@/lib/data/rent-due";
import { getTenantPortalData } from "@/lib/data/tenant-portal";

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    cash_error?: string;
    cash_saved?: string;
    cash_cancelled?: string;
    rentBucket?: string;
  }>;
}) {
  const query = await searchParams;
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
    return (
      <>
        <AccessNotice show={query.error === "access_denied"} />
        <TenantDashboard />
      </>
    );
  }

  if (["technician", "maintenance_staff", "cleaning_staff"].includes(role)) {
    return (
      <>
        <AccessNotice show={query.error === "access_denied"} />
        <MaintenanceDashboard />
      </>
    );
  }

  if (role === "owner") {
    return (
      <>
        <AccessNotice show={query.error === "access_denied"} />
        <OwnerDashboard />
      </>
    );
  }

  if (role === "admin") {
    return (
      <>
        <AccessNotice show={query.error === "access_denied"} />
        <ManagementDashboard query={query} />
      </>
    );
  }

  return (
    <>
      <AccessNotice show={query.error === "access_denied"} />
      <AdminDashboard query={query} />
    </>
  );
}

function AccessNotice({ show }: { show: boolean }) {
  return show ? (
    <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      Your account does not have access to that module. Contact the Super Admin
      if your access needs to change.
    </div>
  ) : null;
}

async function ManagementDashboard({
  query,
}: {
  query: {
    rentBucket?: string;
  };
}) {
  const [rentDueSummary, depositSummary] = await Promise.all([
    getRentDueSummary(),
    getDepositOutstandingSummary(),
  ]);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#b98a2c]">
          Management Team
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Daily Operations
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Follow up rent and deposits, process maintenance work, submit claims
          and verify tenant registrations from one mobile workspace.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <ModuleCard
          description="Open reports, update work status and submit completion photos."
          href="/maintenance"
          icon={Wrench}
          title="Maintenance"
        />
        <ModuleCard
          description="Review tenant registrations and signed tenancy agreements."
          href="/verification"
          icon={ClipboardCheck}
          title="Verification"
        />
        <ModuleCard
          description="Submit repair receipts and follow reimbursement status."
          href="/claims"
          icon={ReceiptText}
          title="Claim Bills"
        />
      </div>

      <CompactRentDueTracker
        selectedBucket={query.rentBucket}
        summary={rentDueSummary}
      />
      <DepositOutstanding canManage summary={depositSummary} />
    </section>
  );
}

async function OwnerDashboard() {
  const [summary, setupSummary, depositSummary] = await Promise.all([
    getOwnerPortalSummary(),
    getDashboardSummary(),
    getDepositOutstandingSummary(),
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
        <StatCard label="My Rooms" value={summary.totalRooms} detail="Rooms under your portfolio" />
        <StatCard label="Vacant Rooms" value={summary.vacantRooms} detail="Available rooms" />
        <StatCard label="Rental Income" value={money(summary.monthlyRentalCollected)} detail="Collected this cycle" />
        <StatCard label="Outstanding Rental" value={money(summary.outstandingRental)} detail="Unpaid rent balance" />
        <StatCard label="Water Bills" value={money(summary.waterBills)} detail="Water charges" />
        <StatCard label="Electricity Bills" value={money(summary.electricityBills)} detail="Electricity charges" />
        <StatCard label="Maintenance Claims" value={summary.pendingClaims} detail="Pending Admin verification" />
        <StatCard label="Approved Claims" value={summary.approvedClaims} detail="Approved expenses" />
        <StatCard label="Open Tickets" value={summary.openMaintenanceTickets} detail="Maintenance not closed" />
        <StatCard label="Net Payable" value={money(netPayable)} detail="Income minus utilities and claims" />
      </div>

      <DepositOutstanding canManage={false} summary={depositSummary} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ModuleCard title="My Properties" description="View properties assigned to your ownership." href="/properties" icon={Building2} badge={summary.totalProperties} />
        <ModuleCard title="My Rooms" description="Track occupied, vacant, reserved and maintenance rooms." href="/rooms" icon={DoorOpen} badge={summary.totalRooms} />
        <ModuleCard title="Rental Income" description="Open rent and payment records for your portfolio." href="/payments" icon={Banknote} />
        <ModuleCard title="Water Bills" description="Check main water bills for your properties." href="/utility-bills" icon={Droplets} />
        <ModuleCard title="Electricity Bills" description="Review main electricity costs for your properties." href="/utility-bills" icon={Zap} />
        <ModuleCard title="Maintenance Claims" description="View submitted maintenance claims and their status." href="/maintenance#claim-bills" icon={ClipboardCheck} badge={summary.pendingClaims} />
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
            <Button asChild variant="outline"><Link href="/maintenance#claim-bills">View claims</Link></Button>
            <Button asChild variant="outline"><Link href="/utility-bills">View bills</Link></Button>
            <Button asChild variant="outline"><Link href="/maintenance">Open tickets</Link></Button>
            <Button asChild variant="outline"><Link href="/reports">View reports</Link></Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

async function AdminDashboard({
  query,
}: {
  query: {
    cash_error?: string;
    cash_saved?: string;
    cash_cancelled?: string;
    rentBucket?: string;
  };
}) {
  const [
    summary,
    rentDueSummary,
    depositSummary,
    cashSummary,
    agreementReminders,
  ] = await Promise.all([
    getDashboardSummary(),
    getRentDueSummary(),
    getDepositOutstandingSummary(),
    getCashManagementSummary(),
    getAgreementRenewalReminders(),
  ]);
  const occupancyRate = summary.totalRooms
    ? Math.round((summary.occupiedRooms / summary.totalRooms) * 100)
    : 0;
  const propertyRows = summary.properties.map((property) => {
    const propertyRooms = summary.rooms.filter((room) => room.property_id === property.id);
    const occupiedRooms = propertyRooms.filter((room) => room.status === "occupied").length;
    const rate = propertyRooms.length ? Math.round((occupiedRooms / propertyRooms.length) * 100) : 0;

    return {
      id: property.id,
      name: property.name,
      totalRooms: propertyRooms.length,
      occupiedRooms,
      rate,
    };
  });

  return (
    <section className="space-y-6">
      <div className="flex justify-end">
        <Button asChild className="bg-[#b98a2c] text-white hover:bg-[#9d7424]">
          <Link href="/register-tenant">+ Register new tenant</Link>
        </Button>
      </div>

      <Card className="mx-auto max-w-4xl rounded-xl border-[#d7dde5] bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <p className="text-sm text-[#496386]">Total Rooms</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-[#07142f]">{summary.totalRooms}</p>
            </div>
            <div>
              <p className="text-sm text-[#496386]">Occupancy Rate</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-[#07142f]">{occupancyRate}%</p>
              <p className="mt-1 text-sm text-[#496386]">
                {summary.occupiedRooms} out of {summary.totalRooms} rooms occupied
              </p>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <p className="font-medium text-[#07142f]">Occupancy</p>
              <p className="text-[#496386]">
                {summary.occupiedRooms} / {summary.totalRooms} - {occupancyRate}%
              </p>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-[#eef2f6]">
              <div
                className="h-full rounded-full bg-[#b98a2c]"
                style={{ width: `${Math.min(occupancyRate, 100)}%` }}
              />
            </div>
          </div>

          <div className="border-t border-[#e3e8ef] pt-6">
            <p className="mb-4 text-sm font-medium text-[#07142f]">By property</p>
            <div className="space-y-3">
              {propertyRows.map((property) => (
                <div className="grid gap-2 text-sm sm:grid-cols-[1fr_auto]" key={property.id}>
                  <p className="font-medium text-[#214066]">{property.name}</p>
                  <p className="text-[#496386]">
                    {property.occupiedRooms} / {property.totalRooms} - {property.rate}%
                  </p>
                </div>
              ))}
              {!propertyRows.length ? (
                <p className="text-sm text-[#496386]">No properties have been created yet.</p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Vacant Rooms" value={summary.vacantRooms} detail="Rooms available now" />
        <StatCard label="Reserved Rooms" value={summary.reservedRooms} detail="Rooms reserved" />
        <StatCard label="Maintenance Rooms" value={summary.maintenanceRooms} detail="Rooms under maintenance" />
        <StatCard label="Properties" value={summary.totalProperties} detail="Managed properties" />
      </div>

      <CompanyCashInHand
        cashCancelled={query.cash_cancelled === "1"}
        cashError={query.cash_error}
        cashSaved={query.cash_saved === "1"}
        summary={cashSummary}
      />

      <DepositOutstanding canManage summary={depositSummary} />

      <AgreementRenewalReminders reminders={agreementReminders} />

      <CompactRentDueTracker
        selectedBucket={query.rentBucket}
        summary={rentDueSummary}
      />
    </section>
  );
}

async function TenantDashboard() {
  const data = await getTenantPortalData();
  return data ? <TenantHome data={data} /> : null;
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
        <ModuleCard title="Submit Claim" description="Upload a repair bill for Admin verification." href="/maintenance#claim-bills" icon={ReceiptText} />
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

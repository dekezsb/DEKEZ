import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Building2,
  CircleCheckBig,
  CircleDollarSign,
  CircleEllipsis,
  ReceiptText,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import {
  getRentDueMap,
  summarizeRentCollections,
  type RentCollectionRow,
  type RentCollectionStatus,
  type RentMapProperty,
  type RentMapRoom,
  type RentMapStatus,
} from "@/lib/data/rent-due-map";
import { money } from "@/lib/e-tenancy";

type PageProps = {
  searchParams: Promise<{
    property?: string;
    month?: string;
  }>;
};

const roomStyles: Record<RentMapStatus, string> = {
  paid: "border-emerald-300 bg-emerald-50 text-emerald-950 hover:border-emerald-500",
  unpaid: "border-red-300 bg-red-50 text-red-950 hover:border-red-500",
  partially_paid: "border-amber-300 bg-amber-50 text-amber-950 hover:border-amber-500",
  vacant: "border-gray-300 bg-gray-100 text-gray-700 hover:border-gray-500",
  reserved: "border-blue-300 bg-blue-50 text-blue-950 hover:border-blue-500",
  maintenance: "border-rose-300 bg-rose-50 text-rose-950 hover:border-rose-500",
  no_bill: "border-dashed border-gray-300 bg-white text-gray-700 hover:border-gray-500",
};

const statusLabels: Record<RentMapStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  vacant: "Vacant",
  reserved: "Reserved",
  maintenance: "Maintenance",
  no_bill: "No bill",
};

const statusDots: Record<RentMapStatus, string> = {
  paid: "bg-emerald-500",
  unpaid: "bg-red-500",
  partially_paid: "bg-amber-500",
  vacant: "bg-gray-400",
  reserved: "bg-blue-500",
  maintenance: "bg-rose-500",
  no_bill: "bg-gray-300",
};

const collectionStatusClasses: Record<RentCollectionStatus, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  partially_paid: "bg-amber-100 text-amber-800",
  unpaid: "bg-red-100 text-red-800",
  pending_verification: "bg-yellow-100 text-yellow-800",
};

const collectionStatusLabels: Record<RentCollectionStatus, string> = {
  paid: "Paid",
  partially_paid: "Partially Paid",
  unpaid: "Unpaid",
  pending_verification: "Payment Submitted - Pending Verification",
};

function dateLabel(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00+08:00`));
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="flex min-h-32 items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-[#0b1733]">{value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#f5ecd7] text-[#9a6b12]">
          {icon}
        </span>
      </CardContent>
    </Card>
  );
}

function CollectionBadge({ status }: { status: RentCollectionStatus }) {
  return (
    <span
      className={`inline-flex max-w-48 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${collectionStatusClasses[status]}`}
    >
      {collectionStatusLabels[status]}
    </span>
  );
}

function RoomCard({ room }: { room: RentMapRoom }) {
  const displayStatus = room.paymentStatus === "pending_verification"
    ? "Pending verification"
    : statusLabels[room.status];
  const displayDot = room.paymentStatus === "pending_verification"
    ? "bg-yellow-500"
    : statusDots[room.status];

  return (
    <Link
      href={`/properties/${room.propertyId}/rooms/${room.id}`}
      className={`group flex items-center justify-between gap-3 rounded-lg border p-3 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b98a2c] ${roomStyles[room.status]}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Room {room.roomNumber}</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
            <span className={`size-2 shrink-0 rounded-full ${displayDot}`} />
            {displayStatus}
          </span>
        </div>
        <p className="mt-1 truncate text-sm">{room.tenantName}</p>
        <p className="mt-1 text-xs text-current/70">
          Due {room.dueDay ?? "-"} |{" "}
          <span className="font-semibold text-current">{money(room.outstanding)} outstanding</span>
        </p>
      </div>
      <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

function PropertySummaryTable({
  properties,
}: {
  properties: RentMapProperty[];
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-[#0b1733]">Property Summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each total uses the selected billing month only.
        </p>
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-[#d8dee8] bg-white md:block">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-[#d8dee8] bg-[#f8fafc] text-xs uppercase text-[#60708a]">
            <tr>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3 text-right">Total due</th>
              <th className="px-4 py-3 text-right">Total paid</th>
              <th className="px-4 py-3 text-right">Outstanding</th>
              <th className="px-4 py-3 text-center">Paid rooms</th>
              <th className="px-4 py-3 text-center">Partial</th>
              <th className="px-4 py-3 text-center">Unpaid</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.id} className="border-b border-[#e4e9f0] last:border-b-0">
                <td className="px-4 py-3 font-medium text-[#0b1733]">{property.name}</td>
                <td className="px-4 py-3 text-right">{money(property.summary.totalRentDue)}</td>
                <td className="px-4 py-3 text-right text-emerald-700">{money(property.summary.totalPaid)}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-700">
                  {money(property.summary.totalOutstanding)}
                </td>
                <td className="px-4 py-3 text-center">{property.summary.fullyPaid}</td>
                <td className="px-4 py-3 text-center">{property.summary.partiallyPaid}</td>
                <td className="px-4 py-3 text-center">{property.summary.unpaid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {properties.map((property) => (
          <div key={property.id} className="rounded-lg border border-[#d8dee8] bg-white p-4">
            <h3 className="font-semibold text-[#0b1733]">{property.name}</h3>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <p><span className="block text-xs text-muted-foreground">Total due</span>{money(property.summary.totalRentDue)}</p>
              <p><span className="block text-xs text-muted-foreground">Total paid</span>{money(property.summary.totalPaid)}</p>
              <p><span className="block text-xs text-muted-foreground">Outstanding</span><span className="font-semibold text-red-700">{money(property.summary.totalOutstanding)}</span></p>
              <p><span className="block text-xs text-muted-foreground">Paid / Partial / Unpaid</span>{property.summary.fullyPaid} / {property.summary.partiallyPaid} / {property.summary.unpaid}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CollectionDetails({
  collections,
}: {
  collections: RentCollectionRow[];
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-[#0b1733]">Outstanding Room Details</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only tenant rooms with a remaining balance for the selected month are shown.
        </p>
      </div>

      {collections.length ? (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-[#d8dee8] bg-white lg:block">
            <table className="w-full min-w-[1380px] text-left text-sm">
              <thead className="border-b border-[#d8dee8] bg-[#f8fafc] text-xs uppercase text-[#60708a]">
                <tr>
                  <th className="px-3 py-3">Property</th>
                  <th className="px-3 py-3">Room / Tenant</th>
                  <th className="px-3 py-3 text-right">Monthly rent</th>
                  <th className="px-3 py-3 text-right">Previous outstanding</th>
                  <th className="px-3 py-3 text-right">Current due</th>
                  <th className="px-3 py-3 text-right">Paid</th>
                  <th className="px-3 py-3 text-right">Current outstanding</th>
                  <th className="px-3 py-3">Due / Payment date</th>
                  <th className="px-3 py-3">Payment status</th>
                </tr>
              </thead>
              <tbody>
                {collections.map((collection) => (
                  <tr key={collection.billId} className="border-b border-[#e4e9f0] align-top last:border-b-0">
                    <td className="px-3 py-4 font-medium">{collection.propertyName}</td>
                    <td className="px-3 py-4">
                      <Link
                        href={`/properties/${collection.propertyId}/rooms/${collection.roomId}`}
                        className="font-semibold text-[#0b1733] hover:text-[#9a6b12] hover:underline"
                      >
                        Room {collection.roomNumber}
                      </Link>
                      <p className="mt-1 max-w-48 text-xs text-muted-foreground">{collection.tenantName}</p>
                    </td>
                    <td className="px-3 py-4 text-right">{money(collection.monthlyRent)}</td>
                    <td className="px-3 py-4 text-right">{money(collection.previousOutstanding)}</td>
                    <td className="px-3 py-4 text-right">{money(collection.currentAmountDue)}</td>
                    <td className="px-3 py-4 text-right font-medium text-emerald-700">
                      {money(collection.paidAmount)}
                      {collection.paymentCount > 1 ? (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          {collection.paymentCount} payments
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-red-700">
                      {money(collection.outstanding)}
                      {collection.previousOutstanding > 0 ? (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          Total: {money(collection.totalOutstanding)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-4">
                      <p>{dateLabel(collection.dueDate)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Paid: {dateLabel(collection.latestPaymentDate)}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <CollectionBadge status={collection.paymentStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {collections.map((collection) => (
              <div key={collection.billId} className="rounded-lg border border-[#d8dee8] bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{collection.propertyName}</p>
                    <Link
                      href={`/properties/${collection.propertyId}/rooms/${collection.roomId}`}
                      className="mt-1 block font-semibold text-[#0b1733]"
                    >
                      Room {collection.roomNumber} - {collection.tenantName}
                    </Link>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <p><span className="block text-xs text-muted-foreground">Current due</span>{money(collection.currentAmountDue)}</p>
                  <p><span className="block text-xs text-muted-foreground">Verified paid</span>{money(collection.paidAmount)}</p>
                  <p><span className="block text-xs text-muted-foreground">Previous balance</span>{money(collection.previousOutstanding)}</p>
                  <p><span className="block text-xs text-muted-foreground">Current outstanding</span><span className="font-semibold text-red-700">{money(collection.outstanding)}</span></p>
                  <p><span className="block text-xs text-muted-foreground">Due date</span>{dateLabel(collection.dueDate)}</p>
                  <p><span className="block text-xs text-muted-foreground">Latest payment</span>{dateLabel(collection.latestPaymentDate)}</p>
                </div>
                <div className="mt-4">
                  <CollectionBadge status={collection.paymentStatus} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-[#cfd7e3] py-12 text-center">
          <CircleCheckBig className="mx-auto size-7 text-emerald-600" />
          <p className="mt-3 font-medium text-[#0b1733]">No unpaid tenant rooms for this month</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Change the billing month or property filter to view another collection period.
          </p>
        </div>
      )}
    </section>
  );
}

export default async function RentDueTrackerPage({ searchParams }: PageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const params = await searchParams;
  const tracker = await getRentDueMap(params.month);
  const selectedProperty = tracker.properties.some(
    (property) => property.id === params.property,
  )
    ? params.property
    : "";
  const visibleProperties = selectedProperty
    ? tracker.properties.filter((property) => property.id === selectedProperty)
    : tracker.properties;
  const visibleCollections = visibleProperties.flatMap(
    (property) => property.collections,
  );
  const outstandingCollections = visibleCollections.filter(
    (collection) => collection.outstanding > 0,
  );
  const propertiesWithUnpaidRooms = visibleProperties
    .map((property) => ({
      ...property,
      rooms: property.rooms.filter(
        (room) =>
          Boolean(room.tenantName)
          && Boolean(room.billId)
          && room.outstanding > 0
          && (room.status === "unpaid" || room.status === "partially_paid"),
      ),
    }))
    .filter((property) => property.rooms.length > 0);
  const visibleSummary = summarizeRentCollections(visibleCollections);
  const pendingVerification = visibleCollections.filter(
    (collection) => collection.paymentStatus === "pending_verification",
  ).length;

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b37b14]">Rental Collection</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#0b1733]">Rent Due Tracker</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Monthly collection, verified payments and room status for {tracker.selectedMonthLabel}.
          </p>
        </div>

        <form
          className="grid w-full gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:w-auto"
          action="/rent-due-tracker"
        >
          <div className="min-w-0 sm:w-64">
            <label className="mb-1.5 block text-sm font-medium" htmlFor="month">
              Billing month
            </label>
            <input
              id="month"
              name="month"
              type="month"
              max={tracker.currentMonth}
              defaultValue={tracker.selectedMonth}
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
            />
          </div>
          <div className="min-w-0 sm:w-72">
            <label className="mb-1.5 block text-sm font-medium" htmlFor="property">
              Property
            </label>
            <select
              id="property"
              name="property"
              defaultValue={selectedProperty}
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
            >
              <option value="">All Properties</option>
              {tracker.properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            View
          </Button>
        </form>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard
          icon={<ReceiptText className="size-5" />}
          label="Total Rent Due"
          value={money(visibleSummary.totalRentDue)}
          detail={`${visibleSummary.occupiedTenants} billed tenant${visibleSummary.occupiedTenants === 1 ? "" : "s"}`}
        />
        <SummaryCard
          icon={<Banknote className="size-5" />}
          label="Total Paid"
          value={money(visibleSummary.totalPaid)}
          detail="Verified payments only"
        />
        <SummaryCard
          icon={<CircleDollarSign className="size-5" />}
          label="Total Outstanding"
          value={money(visibleSummary.totalOutstanding)}
          detail="Selected month balance"
        />
        <SummaryCard
          icon={<CircleCheckBig className="size-5" />}
          label="Fully Paid"
          value={String(visibleSummary.fullyPaid)}
          detail="Current bill settled"
        />
        <SummaryCard
          icon={<CircleEllipsis className="size-5" />}
          label="Partially Paid"
          value={String(visibleSummary.partiallyPaid)}
          detail="Verified balance received"
        />
        <SummaryCard
          icon={<TriangleAlert className="size-5" />}
          label="Unpaid"
          value={String(visibleSummary.unpaid)}
          detail={`${pendingVerification} pending verification`}
        />
      </div>

      <p className="rounded-md border border-[#ead9af] bg-[#fffaf0] px-4 py-3 text-sm text-[#6f5317]">
        Monthly totals do not include earlier balances. Previous outstanding amounts remain visible separately for each tenant.
      </p>

      <PropertySummaryTable properties={visibleProperties} />

      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-[#0b1733]">Rooms Still Unpaid</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only occupied rooms with a tenant and an outstanding bill for {tracker.selectedMonthLabel} are shown.
            Paid rooms disappear automatically.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-y border-[#d8dee8] py-3 text-xs font-medium text-[#42516a]">
          {(["unpaid", "partially_paid"] as const).map(
            (status) => (
              <span key={status} className="inline-flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${statusDots[status]}`} />
                {statusLabels[status]}
              </span>
            ),
          )}
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-yellow-500" />
            Pending verification
          </span>
        </div>

        {propertiesWithUnpaidRooms.length ? (
          <div className="space-y-8">
            {propertiesWithUnpaidRooms.map((property) => (
              <section key={property.id} className="space-y-4">
                <div className="flex flex-col gap-3 border-b border-[#d8dee8] pb-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 className="size-5 text-[#b37b14]" />
                      <h3 className="text-xl font-semibold text-[#0b1733]">{property.name}</h3>
                    </div>
                    {property.area ? (
                      <p className="mt-1 text-sm text-muted-foreground">{property.area}</p>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {property.rooms.length} unpaid room{property.rooms.length === 1 ? "" : "s"} | Outstanding{" "}
                    <span className="font-semibold text-red-700">{money(property.summary.totalOutstanding)}</span>
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {property.rooms.map((room) => (
                    <RoomCard key={room.id} room={room} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[#cfd7e3] py-16 text-center">
            <CircleCheckBig className="mx-auto size-8 text-emerald-600" />
            <p className="mt-3 font-medium text-[#0b1733]">
              All occupied rooms are paid for {tracker.selectedMonthLabel}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Vacant rooms and rooms without a current bill are hidden.
            </p>
          </div>
        )}
      </section>

      <CollectionDetails collections={outstandingCollections} />
    </section>
  );
}

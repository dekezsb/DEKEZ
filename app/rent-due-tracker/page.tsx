import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CircleCheckBig,
  CircleDollarSign,
  DoorOpen,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import {
  getRentDueMap,
  type RentMapRoom,
  type RentMapStatus,
} from "@/lib/data/rent-due-map";
import { money } from "@/lib/e-tenancy";

type PageProps = {
  searchParams: Promise<{
    property?: string;
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
  no_bill: "No current bill",
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

function RoomCard({ room }: { room: RentMapRoom }) {
  const vacant = room.status === "vacant";
  const reserved = room.status === "reserved";
  const maintenance = room.status === "maintenance";
  const hasBill = ["paid", "unpaid", "partially_paid"].includes(room.status);

  return (
    <Link
      href={`/properties/${room.propertyId}/rooms/${room.id}`}
      className={`group flex min-h-44 flex-col justify-between rounded-lg border p-4 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b98a2c] ${roomStyles[room.status]}`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-current/60">Room</p>
            <h3 className="mt-1 text-lg font-semibold">{room.roomNumber}</h3>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-1 text-xs font-medium">
            <span className={`size-2 rounded-full ${statusDots[room.status]}`} />
            {statusLabels[room.status]}
          </span>
        </div>

        <p className="mt-4 line-clamp-2 min-h-10 text-sm font-medium">
          {room.tenantName ?? (vacant ? "No tenant" : reserved ? "Reserved room" : maintenance ? "Room unavailable" : "Tenant not assigned")}
        </p>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-current/10 pt-3">
        <div className="space-y-1 text-sm">
          <p>
            Due: <span className="font-semibold">{room.dueDay ?? "-"}</span>
          </p>
          <p className="font-semibold">
            {hasBill ? `${money(room.outstanding)} outstanding` : "-"}
          </p>
        </div>
        <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

export default async function RentDueTrackerPage({ searchParams }: PageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const params = await searchParams;
  const summary = await getRentDueMap();
  const selectedProperty = summary.properties.some(
    (property) => property.id === params.property,
  )
    ? params.property
    : "";
  const visibleProperties = selectedProperty
    ? summary.properties.filter((property) => property.id === selectedProperty)
    : summary.properties;
  const visibleRooms = visibleProperties.flatMap((property) => property.rooms);
  const visibleUnpaid = visibleRooms.filter((room) =>
    ["unpaid", "partially_paid"].includes(room.status),
  );
  const visibleOutstanding = visibleUnpaid.reduce(
    (total, room) => total + room.outstanding,
    0,
  );
  const visiblePaid = visibleRooms.filter((room) => room.status === "paid").length;
  const visibleVacant = visibleRooms.filter((room) => room.status === "vacant").length;

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b37b14]">Rental Collection</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#0b1733]">Rent Due Tracker</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Property room status for {summary.currentMonthLabel}.
          </p>
        </div>

        <form className="flex w-full items-end gap-2 sm:w-auto" action="/rent-due-tracker">
          <div className="min-w-0 flex-1 sm:w-72">
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
              {summary.properties.map((property) => (
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard
          icon={<CalendarDays className="size-5" />}
          label="Current Month"
          value={summary.currentMonthLabel}
          detail="Malaysia billing month"
        />
        <SummaryCard
          icon={<UsersRound className="size-5" />}
          label="Unpaid Tenants"
          value={String(visibleUnpaid.length)}
          detail="Includes partially paid bills"
        />
        <SummaryCard
          icon={<CircleDollarSign className="size-5" />}
          label="Outstanding"
          value={money(visibleOutstanding)}
          detail="Current month only"
        />
        <SummaryCard
          icon={<CircleCheckBig className="size-5" />}
          label="Paid Tenants"
          value={String(visiblePaid)}
          detail="Current month bills settled"
        />
        <SummaryCard
          icon={<DoorOpen className="size-5" />}
          label="Vacant Rooms"
          value={String(visibleVacant)}
          detail="Across visible properties"
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 border-y border-[#d8dee8] py-3 text-xs font-medium text-[#42516a]">
        {(["paid", "unpaid", "partially_paid", "vacant", "reserved"] as const).map(
          (status) => (
            <span key={status} className="inline-flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${statusDots[status]}`} />
              {statusLabels[status]}
            </span>
          ),
        )}
      </div>

      {visibleProperties.length ? (
        <div className="space-y-10">
          {visibleProperties.map((property) => (
            <section key={property.id} className="space-y-4">
              <div className="flex flex-col gap-1 border-b border-[#d8dee8] pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="size-5 text-[#b37b14]" />
                    <h2 className="text-xl font-semibold text-[#0b1733]">{property.name}</h2>
                  </div>
                  {property.area ? (
                    <p className="mt-1 text-sm text-muted-foreground">{property.area}</p>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {property.rooms.length} room{property.rooms.length === 1 ? "" : "s"}
                </p>
              </div>

              {property.rooms.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {property.rooms.map((room) => (
                    <RoomCard key={room.id} room={room} />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-sm text-muted-foreground">
                  No rooms are recorded for this property.
                </p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[#cfd7e3] py-16 text-center">
          <Building2 className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium text-[#0b1733]">No properties available</p>
        </div>
      )}
    </section>
  );
}

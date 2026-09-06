import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  DoorOpen,
  Home,
  WalletCards,
} from "lucide-react";
import { Link } from "@/components/app-link";
import { QuickCheckoutDialog } from "@/app/properties/[id]/quick-checkout-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hasModuleAccess } from "@/lib/auth/access";
import { getCurrentUserAccess, requireRole } from "@/lib/auth/session";
import { formatMalaysiaDate } from "@/lib/date-format";
import {
  getRoomAvailabilityMap,
  type RoomAvailabilityItem,
  type RoomAvailabilityStatus,
} from "@/lib/data/room-availability";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    checkout?: string;
    checkout_error?: string;
    phone_release?: string;
  }>;
};

const money = new Intl.NumberFormat("en-MY", {
  currency: "MYR",
  style: "currency",
});

const roomStyles: Record<RoomAvailabilityStatus, string> = {
  contract_active:
    "border-emerald-400 bg-emerald-50 text-emerald-950 shadow-emerald-100/70",
  contract_expired:
    "border-amber-400 bg-amber-100 text-amber-950 shadow-amber-100/80",
  vacant: "border-gray-300 bg-transparent text-gray-900 shadow-gray-100",
  maintenance: "border-slate-400 bg-slate-100 text-slate-900 shadow-slate-100",
  reserved: "border-blue-300 bg-blue-50 text-blue-950 shadow-blue-100",
  needs_attention: "border-rose-300 bg-rose-50 text-rose-950 shadow-rose-100",
};

const roomLabels: Record<RoomAvailabilityStatus, string> = {
  contract_active: "Occupied · TA active",
  contract_expired: "Occupied · TA expired",
  vacant: "Vacant",
  maintenance: "Maintenance",
  reserved: "Reserved",
  needs_attention: "Occupied · check record",
};

function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isOccupied(room: RoomAvailabilityItem) {
  return room.availabilityStatus === "contract_active" ||
    room.availabilityStatus === "contract_expired";
}

function RoomCard({
  canCheckout,
  room,
}: {
  canCheckout: boolean;
  room: RoomAvailabilityItem;
}) {
  const occupied = isOccupied(room);

  return (
    <article
      className={`flex min-h-64 flex-col rounded-xl border p-4 shadow-sm ${roomStyles[room.availabilityStatus]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xl font-bold">{room.roomNumber}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-75">
            {roomLabels[room.availabilityStatus]}
          </p>
        </div>
        {room.availabilityStatus === "contract_expired" ? (
          <AlertTriangle aria-label="Tenancy agreement expired" className="h-5 w-5 shrink-0" />
        ) : room.availabilityStatus === "contract_active" ? (
          <CheckCircle2 aria-label="Tenancy agreement active" className="h-5 w-5 shrink-0" />
        ) : room.availabilityStatus === "vacant" ? (
          <DoorOpen aria-label="Vacant room" className="h-5 w-5 shrink-0" />
        ) : (
          <Home aria-hidden="true" className="h-5 w-5 shrink-0" />
        )}
      </div>

      {occupied ? (
        <div className="mt-4 flex-1 space-y-3 text-sm">
          <p className="line-clamp-2 font-semibold" title={room.tenantName ?? "Tenant"}>
            {room.tenantName ?? "Tenant name unavailable"}
          </p>
          <div className="flex items-start gap-2">
            <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
            <p>
              <span className="block text-xs opacity-70">Check-in date</span>
              <span className="font-semibold">{formatMalaysiaDate(room.checkInDate)}</span>
            </p>
          </div>
          <div className="flex items-start gap-2">
            <WalletCards aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
            <p>
              <span className="block text-xs opacity-70">Deposit outstanding</span>
              <span className="font-semibold">{money.format(room.depositOutstanding)}</span>
            </p>
          </div>
          <p className="text-xs opacity-75">
            TA end: {formatMalaysiaDate(room.contractEnd)}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex-1 text-sm">
          <p className="opacity-75">
            {room.availabilityStatus === "vacant"
              ? "No current tenant. This room is ready for registration."
              : "This room is not currently available for a tenant."}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-current/15 pt-3">
        {room.availabilityStatus === "vacant" && canCheckout ? (
          <Button asChild className="bg-[#b8892c] text-white hover:bg-[#9d7422]" size="sm">
            <Link href={`/register-tenant?property=${room.propertyId}&room=${room.id}`}>
              Register Tenant
            </Link>
          </Button>
        ) : null}
        {occupied && canCheckout && room.tenancyId && room.tenantName ? (
          <QuickCheckoutDialog
            checkoutDate={malaysiaToday()}
            propertyId={room.propertyId}
            returnTo="/room-availability"
            roomId={room.id}
            roomNumber={room.roomNumber}
            tenancyId={room.tenancyId}
            tenantName={room.tenantName}
          />
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link href={`/properties/${room.propertyId}/rooms/${room.id}`}>Open Room</Link>
        </Button>
      </div>
    </article>
  );
}

export default async function RoomAvailabilityPage({ searchParams }: PageProps) {
  await requireRole(["super_admin", "owner", "admin"], {
    module: "properties",
    level: "view",
  });
  const [{ access, role }, map, query] = await Promise.all([
    getCurrentUserAccess(),
    getRoomAvailabilityMap(),
    searchParams,
  ]);
  const canCheckout =
    (role === "super_admin" || role === "admin") &&
    hasModuleAccess(access, "properties", "manage");

  return (
    <section className="space-y-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#b17f19]">
          Property Operations
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[#0b1733]">Room Availability Map</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          See every room at a glance. This page shows availability, check-in dates,
          tenancy-agreement status and deposit balances only—rent payment status is
          intentionally not shown here.
        </p>
      </div>

      {query.checkout === "1" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {query.phone_release === "failed"
            ? "Tenant checked out and the room is vacant. The old phone login needs a Super Admin review before the number can be reused."
            : query.phone_release === "kept_for_active_tenancy"
              ? "Tenant checked out and the room is vacant. The phone login remains active because this tenant still has another active room."
              : "Tenant checked out successfully. The room is vacant, the checkout is in history, and the old phone login was released for future registration."}
        </div>
      ) : null}
      {query.checkout_error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {query.checkout_error === "date_before_checkin"
            ? "Checkout date cannot be earlier than the tenant's check-in date."
            : query.checkout_error === "future_date"
              ? "Checkout date cannot be in the future."
              : query.checkout_error === "lock"
                ? "Checkout stopped because the linked door access could not be removed."
                : "Checkout could not be completed because this room record changed. Refresh and try again."}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card><CardContent className="p-5"><p className="text-xs font-medium uppercase text-gray-500">All rooms</p><p className="mt-2 text-3xl font-semibold">{map.totalRooms}</p></CardContent></Card>
        <Card className="border-gray-300"><CardContent className="p-5"><p className="text-xs font-medium uppercase text-gray-500">Vacant</p><p className="mt-2 text-3xl font-semibold">{map.vacantRooms}</p></CardContent></Card>
        <Card className="border-emerald-300 bg-emerald-50"><CardContent className="p-5"><p className="text-xs font-medium uppercase text-emerald-800">Occupied · TA active</p><p className="mt-2 text-3xl font-semibold text-emerald-950">{map.activeContractRooms}</p></CardContent></Card>
        <Card className="border-amber-300 bg-amber-100"><CardContent className="p-5"><p className="text-xs font-medium uppercase text-amber-800">Occupied · TA expired</p><p className="mt-2 text-3xl font-semibold text-amber-950">{map.expiredContractRooms}</p></CardContent></Card>
        <Card className="border-slate-300 bg-slate-50"><CardContent className="p-5"><p className="text-xs font-medium uppercase text-slate-600">Other unavailable</p><p className="mt-2 text-3xl font-semibold text-slate-950">{map.otherUnavailableRooms}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-lg border border-[#d8dee8] bg-white px-4 py-3 text-sm font-medium text-[#31425c]">
        <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-emerald-400 bg-emerald-100" />Green: occupied, TA active</span>
        <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-amber-400 bg-amber-200" />Yellow: occupied, TA expired</span>
        <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-gray-400 bg-white" />No colour: vacant</span>
      </div>

      {map.properties.length ? (
        <div className="space-y-10">
          {map.properties.map((property) => {
            const vacantCount = property.rooms.filter(
              (room) => room.availabilityStatus === "vacant",
            ).length;
            return (
              <section className="space-y-4" id={`property-${property.id}`} key={property.id}>
                <div className="flex flex-col gap-2 border-b border-[#d8dee8] pb-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-[#b37b14]" />
                      <h2 className="text-xl font-semibold text-[#0b1733]">
                        {property.code ? `${property.code} · ` : ""}{property.name}
                      </h2>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {[property.area, property.address].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Badge className="w-fit bg-gray-100 text-gray-700">
                    {vacantCount} vacant of {property.rooms.length}
                  </Badge>
                </div>

                {property.rooms.length ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {property.rooms.map((room) => (
                      <RoomCard canCheckout={canCheckout} key={room.id} room={room} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
                    No rooms have been added to this property yet.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-500">
          No properties are available for this account.
        </p>
      )}
    </section>
  );
}

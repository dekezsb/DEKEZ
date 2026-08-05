"use client";

import { useMemo, useState } from "react";
import { Building2, CalendarClock, Paperclip, WalletCards } from "lucide-react";
import { Link } from "@/components/app-link";
import { money } from "@/lib/e-tenancy";
import type { RentMapProperty, RentMapRoom } from "@/lib/data/rent-due-map";
import { AdminPaymentSlipUpload } from "./admin-payment-slip-upload";

type RoomFilter = "all" | "deposit" | "overdue" | "due_today" | "upcoming";

type OutstandingProperty = Pick<RentMapProperty, "id" | "name" | "area"> & {
  rooms: RentMapRoom[];
};

type OutstandingRoomMapProps = {
  canUploadSlip: boolean;
  paymentDateDefault: string;
  properties: OutstandingProperty[];
  selectedMonth: string;
  selectedProperty: string;
  today: string;
};

const filterLabels: Array<{ id: RoomFilter; label: string }> = [
  { id: "all", label: "All Outstanding" },
  { id: "deposit", label: "Deposit Unpaid" },
  { id: "overdue", label: "Overdue" },
  { id: "due_today", label: "Due Today" },
  { id: "upcoming", label: "Upcoming" },
];

type DueUrgency = "future" | "due_today" | "overdue" | "severely_overdue";

const dueUrgencyStyles: Record<DueUrgency, string> = {
  future: "border-gray-300 bg-white text-gray-950 hover:border-gray-500",
  due_today: "border-yellow-400 bg-yellow-50 text-yellow-950 hover:border-yellow-500",
  overdue: "border-orange-400 bg-orange-50 text-orange-950 hover:border-orange-500",
  severely_overdue: "border-red-400 bg-red-50 text-red-950 hover:border-red-500",
};

function dateOnlyValue(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dueTiming(room: RentMapRoom, today: string) {
  if (!room.dueDate) {
    return {
      urgency: "future" as DueUrgency,
      label: `Due day ${room.dueDay ?? "-"}`,
      daysOverdue: null,
    };
  }

  const daysOverdue = Math.round(
    (dateOnlyValue(today) - dateOnlyValue(room.dueDate)) / 86_400_000,
  );

  if (daysOverdue >= 7) {
    return { urgency: "severely_overdue" as DueUrgency, label: `${daysOverdue} days overdue`, daysOverdue };
  }
  if (daysOverdue > 0) {
    return {
      urgency: "overdue" as DueUrgency,
      label: `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`,
      daysOverdue,
    };
  }
  if (daysOverdue === 0) {
    return { urgency: "due_today" as DueUrgency, label: "Due today", daysOverdue };
  }

  const daysUntilDue = Math.abs(daysOverdue);
  return {
    urgency: "future" as DueUrgency,
    label: `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`,
    daysOverdue,
  };
}

function compactRoomLabel(roomNumber: string) {
  const number = roomNumber
    .trim()
    .replace(/^(?:(?:room|r)\s*)+/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  return number ? `R${number}` : "Room";
}

function matchesFilter(room: RentMapRoom, filter: RoomFilter, today: string) {
  const timing = dueTiming(room, today);
  if (filter === "deposit") return room.depositOutstanding > 0.005;
  if (filter === "overdue") return (timing.daysOverdue ?? 0) > 0;
  if (filter === "due_today") return timing.daysOverdue === 0;
  if (filter === "upcoming") return (timing.daysOverdue ?? 0) < 0;
  return true;
}

export function OutstandingRoomMap({
  canUploadSlip,
  paymentDateDefault,
  properties,
  selectedMonth,
  selectedProperty,
  today,
}: OutstandingRoomMapProps) {
  const [filter, setFilter] = useState<RoomFilter>("all");
  const [selectedRoom, setSelectedRoom] = useState<{
    property: OutstandingProperty;
    room: RentMapRoom;
  } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const allRooms = useMemo(
    () => properties.flatMap((property) => property.rooms),
    [properties],
  );
  const counts = useMemo(
    () => Object.fromEntries(
      filterLabels.map(({ id }) => [
        id,
        allRooms.filter((room) => matchesFilter(room, id, today)).length,
      ]),
    ) as Record<RoomFilter, number>,
    [allRooms, today],
  );
  const visibleProperties = useMemo(
    () => properties
      .map((property) => ({
        ...property,
        rooms: property.rooms.filter((room) => matchesFilter(room, filter, today)),
      }))
      .filter((property) => property.rooms.length > 0),
    [filter, properties, today],
  );

  const openRoom = (property: OutstandingProperty, room: RentMapRoom) => {
    if (!canUploadSlip || !room.billId) return;
    setSelectedRoom({ property, room });
    setUploadOpen(true);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[#0b1733]">Rooms Requiring Attention</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a status, then press a room to attach its payment slip immediately.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs font-medium text-[#6f5317]">
          <Paperclip className="size-4" />
          {canUploadSlip ? "Room cards open payment upload" : "Select a room to view its details"}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Outstanding room filters">
        {filterLabels.map(({ id, label }) => {
          const active = filter === id;
          return (
            <button
              key={id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b98a2c] ${
                active
                  ? "border-[#b98a2c] bg-[#fff7e5] text-[#6f5317]"
                  : "border-[#d8dee8] bg-white text-[#0b1733] hover:border-[#b98a2c]"
              }`}
              onClick={() => setFilter(id)}
              type="button"
            >
              <span>{label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-[#b98a2c] text-white" : "bg-[#eef2f6]"}`}>
                {counts[id]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 border-y border-[#d8dee8] py-3 text-xs font-medium text-[#42516a]">
        <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full bg-gray-300" />Not due yet</span>
        <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full bg-yellow-400" />Due today</span>
        <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full bg-orange-500" />1-6 days overdue</span>
        <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full bg-red-500" />7+ days overdue</span>
      </div>

      {visibleProperties.length ? (
        <div className="space-y-8">
          {visibleProperties.map((property) => (
            <section key={property.id} className="space-y-4">
              <div className="flex flex-col gap-3 border-b border-[#d8dee8] pb-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="size-5 text-[#b37b14]" />
                    <h3 className="text-xl font-semibold text-[#0b1733]">{property.name}</h3>
                  </div>
                  {property.area ? <p className="mt-1 text-sm text-muted-foreground">{property.area}</p> : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {property.rooms.length} room{property.rooms.length === 1 ? "" : "s"} | Rent + deposit{" "}
                  <span className="font-semibold text-red-700">
                    {money(property.rooms.reduce((total, room) => total + room.outstanding, 0))}
                  </span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
                {property.rooms.map((room) => {
                  const timing = dueTiming(room, today);
                  const roomLabel = compactRoomLabel(room.roomNumber);
                  const content = (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{roomLabel}</p>
                        {canUploadSlip ? <Paperclip className="size-4 shrink-0 opacity-70" /> : null}
                      </div>
                      <p className="mt-1 truncate text-xs font-medium" title={room.tenantName ?? "Tenant"}>
                        {room.tenantName ?? "Tenant"}
                      </p>
                      <p className="mt-1 text-xs font-medium text-current/75">Due day {room.dueDay ?? "-"}</p>
                      <p className="mt-0.5 text-xs font-semibold">{timing.label}</p>
                      <p className="mt-2 text-xs font-semibold text-red-700">{money(room.outstanding)}</p>
                      {room.depositOutstanding > 0.005 ? (
                        <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          Deposit {money(room.depositOutstanding)}
                        </span>
                      ) : null}
                    </>
                  );
                  const className = `group min-h-36 rounded-lg border p-3 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b98a2c] ${dueUrgencyStyles[timing.urgency]}`;

                  return canUploadSlip && room.billId ? (
                    <button
                      key={room.id}
                      aria-label={`Attach payment slip for ${roomLabel}, ${room.tenantName ?? "tenant"}`}
                      className={className}
                      onClick={() => openRoom(property, room)}
                      type="button"
                    >
                      {content}
                    </button>
                  ) : (
                    <Link
                      key={room.id}
                      aria-label={`Open ${roomLabel}, ${room.tenantName ?? "tenant"}`}
                      className={className}
                      href={`/properties/${room.propertyId}/rooms/${room.id}`}
                    >
                      {content}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[#cfd7e3] py-12 text-center">
          {filter === "deposit" ? <WalletCards className="mx-auto size-7 text-emerald-600" /> : <CalendarClock className="mx-auto size-7 text-emerald-600" />}
          <p className="mt-3 font-medium text-[#0b1733]">No rooms in this category</p>
          <p className="mt-1 text-sm text-muted-foreground">Choose another status above.</p>
        </div>
      )}

      {selectedRoom?.room.billId ? (
        <AdminPaymentSlipUpload
          key={selectedRoom.room.billId}
          billId={selectedRoom.room.billId}
          depositOutstanding={selectedRoom.room.depositOutstanding}
          hideTrigger
          onOpenChange={setUploadOpen}
          open={uploadOpen}
          outstandingLabel={money(selectedRoom.room.outstanding)}
          paymentDateDefault={paymentDateDefault}
          propertyName={selectedRoom.property.name}
          rentOutstanding={Math.max(selectedRoom.room.outstanding - selectedRoom.room.depositOutstanding, 0)}
          roomName={compactRoomLabel(selectedRoom.room.roomNumber)}
          selectedMonth={selectedMonth}
          selectedProperty={selectedProperty}
          tenantName={selectedRoom.room.tenantName ?? "Tenant"}
        />
      ) : null}
    </section>
  );
}

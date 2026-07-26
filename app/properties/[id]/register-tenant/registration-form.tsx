"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type VacantRoom = {
  id: string;
  roomNumber: string;
  monthlyRent: number;
};

function inputClass() {
  return "mt-1.5 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm outline-none focus:border-[#b98a29] focus:ring-2 focus:ring-[#b98a29]/20";
}

export function RegistrationForm({
  action,
  propertyId,
  propertyName,
  rooms,
  selectedRoomId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  propertyId: string;
  propertyName: string;
  rooms: VacantRoom[];
  selectedRoomId?: string;
}) {
  const initialRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0];
  const [roomId, setRoomId] = useState(initialRoom?.id ?? "");
  const [checkInDate, setCheckInDate] = useState("");
  const selectedRoom = rooms.find((room) => room.id === roomId);
  const dueDay = checkInDate ? Number(checkInDate.slice(8, 10)) : null;
  const nextDates = (() => {
    if (!checkInDate) return [];
    const [year, month, day] = checkInDate.split("-").map(Number);
    return [1, 2, 3].map((offset) => {
      const target = new Date(Date.UTC(year, month - 1 + offset, 1));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)))
        .toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" });
    });
  })();

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-2">
      <input name="propertyId" type="hidden" value={propertyId} />
      <label>
        <span className="text-sm font-medium text-gray-700">Property</span>
        <input className={`${inputClass()} bg-gray-50`} value={propertyName} readOnly />
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">Vacant room</span>
        <select className={inputClass()} name="roomId" value={roomId} onChange={(event) => setRoomId(event.target.value)} required>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>{room.roomNumber}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">Full name</span>
        <input className={inputClass()} name="fullName" required />
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">Phone / WhatsApp</span>
        <input className={inputClass()} name="phone" inputMode="tel" />
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">IC / passport</span>
        <input className={inputClass()} name="identificationNumber" />
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">Email optional</span>
        <input className={inputClass()} name="email" type="email" />
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">Check-in date</span>
        <input className={inputClass()} name="checkInDate" type="date" value={checkInDate} onChange={(event) => setCheckInDate(event.target.value)} required />
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">Contract end date optional</span>
        <input className={inputClass()} name="contractEnd" type="date" min={checkInDate || undefined} />
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">Monthly rent RM</span>
        <input className={inputClass()} name="monthlyRent" type="number" min="0" step="0.01" defaultValue={selectedRoom?.monthlyRent ?? 0} required />
      </label>
      <label>
        <span className="text-sm font-medium text-gray-700">Deposit RM</span>
        <input className={inputClass()} name="deposit" type="number" min="0" step="0.01" defaultValue="0" />
      </label>

      <div className="rounded-md border border-[#ead8ad] bg-[#fffaf0] p-4 lg:col-span-2">
        <p className="text-sm font-semibold text-gray-950">Recurring billing preview</p>
        {dueDay ? (
          <>
            <p className="mt-2 text-sm text-gray-700">
              Rent will be due on day <strong>{dueDay}</strong> every month.
            </p>
            <p className="mt-1 text-sm text-gray-600">Next bills: {nextDates.join(", ")}</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-gray-500">Choose a check-in date to calculate the recurring due day.</p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end lg:col-span-2">
        <Button asChild variant="outline">
          <Link href={`/properties/${propertyId}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={!rooms.length}>Register Tenant & Prepare Agreement</Button>
      </div>
    </form>
  );
}

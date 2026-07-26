"use client";

import { useState } from "react";

type PropertyOption = {
  id: string;
  isCommercial: boolean;
  name: string;
};

type RoomOption = {
  id: string;
  monthlyRent: number;
  propertyId: string;
  roomNumber: string;
};

const inputClass =
  "mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20";

export function CommercialPropertyFields({
  properties,
  rooms,
}: {
  properties: PropertyOption[];
  rooms: RoomOption[];
}) {
  const [propertyId, setPropertyId] = useState("");
  const selected = properties.find((property) => property.id === propertyId);
  const availableRooms = rooms.filter((room) => room.propertyId === propertyId);

  return (
    <>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Property</span>
        <select
          className={inputClass}
          name="propertyId"
          onChange={(event) => setPropertyId(event.target.value)}
          required
          value={propertyId}
        >
          <option value="">Choose property</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}{property.isCommercial ? " - Commercial title" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Available room</span>
        <select className={inputClass} name="roomId" required disabled={!propertyId}>
          <option value="">
            {propertyId ? "Choose room" : "Choose property first"}
          </option>
          {availableRooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.roomNumber} - RM {room.monthlyRent.toFixed(2)}
            </option>
          ))}
        </select>
      </label>
      {selected?.isCommercial ? (
        <label className="block rounded-md border border-[#ead8ad] bg-[#fffaf0] p-3">
          <span className="text-sm font-semibold text-gray-950">
            Trading licence / supporting business document
          </span>
          <span className="mt-1 block text-xs text-gray-600">
            Required for this commercial-title property.
          </span>
          <input
            className={inputClass}
            name="commercialSupportingDocument"
            type="file"
            accept="image/*,.pdf"
            required
          />
        </label>
      ) : null}
    </>
  );
}

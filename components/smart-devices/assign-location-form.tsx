"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AssignmentSuggestion, PropertyOption, RoomOption } from "@/lib/ttlock/device-discovery";

type AssignLocationFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  deviceId: string;
  properties: PropertyOption[];
  rooms: RoomOption[];
  suggestion?: AssignmentSuggestion | null;
  allowMainDoor?: boolean;
  skipReason?: string | null;
};

export function AssignLocationForm({
  action,
  deviceId,
  properties,
  rooms,
  suggestion,
  allowMainDoor = false,
  skipReason,
}: AssignLocationFormProps) {
  const [propertyId, setPropertyId] = useState(suggestion?.propertyId ?? "");
  const [accessScope, setAccessScope] = useState<"property_entry" | "room_entry">(
    suggestion?.accessScope ?? "room_entry",
  );
  const [roomId, setRoomId] = useState(suggestion?.roomId ?? "");
  const propertyRooms = useMemo(
    () => rooms.filter((room) => room.property_id === propertyId),
    [propertyId, rooms],
  );

  return (
    <form action={action} className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50/80 p-4">
      <input name="deviceId" type="hidden" value={deviceId} />
      <p className="text-sm font-semibold text-amber-950">Assign this device</p>
      {suggestion ? (
        <p className="text-sm text-amber-900">
          Suggested: <strong>{suggestion.label}</strong>. Confirm or choose a different room before saving.
        </p>
      ) : (
        <p className="text-sm text-amber-900">
          This device is unassigned. Choose the property and room, then confirm.
        </p>
      )}
      {skipReason ? <p className="text-sm text-amber-800">{skipReason}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-amber-800">Property</span>
          <select
            className="h-10 w-full rounded-md border border-amber-300 bg-white px-2 text-sm"
            name="propertyId"
            onChange={(event) => {
              setPropertyId(event.target.value);
              setRoomId("");
            }}
            required
            value={propertyId}
          >
            <option value="">Select property</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.property_code ? `${property.property_code} · ${property.name}` : property.name}
              </option>
            ))}
          </select>
        </label>
        {allowMainDoor ? (
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-amber-800">Access</span>
            <select
              className="h-10 w-full rounded-md border border-amber-300 bg-white px-2 text-sm"
              name="accessScope"
              onChange={(event) =>
                setAccessScope(event.target.value as "property_entry" | "room_entry")
              }
              value={accessScope}
            >
              <option value="room_entry">Room lock</option>
              <option value="property_entry">Main entrance</option>
            </select>
          </label>
        ) : (
          <input name="accessScope" type="hidden" value="room_entry" />
        )}
        {accessScope === "room_entry" ? (
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-amber-800">Room</span>
            <select
              className="h-10 w-full rounded-md border border-amber-300 bg-white px-2 text-sm"
              name="roomId"
              onChange={(event) => setRoomId(event.target.value)}
              required
              value={roomId}
            >
              <option value="">Select room</option>
              {propertyRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.room_number || room.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex items-end">
          <Button size="sm" type="submit">
            Confirm assignment
          </Button>
        </div>
      </div>
    </form>
  );
}


type UnassignLocationFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  deviceId: string;
};

export function UnassignLocationForm({ action, deviceId }: UnassignLocationFormProps) {
  return (
    <form action={action} className="mt-3">
      <input name="deviceId" type="hidden" value={deviceId} />
      <Button size="sm" type="submit" variant="outline">
        Unassign
      </Button>
    </form>
  );
}

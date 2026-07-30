"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { createClaimBill } from "@/app/maintenance/actions";
import { ClaimDocumentUpload } from "@/components/maintenance/claim-document-upload";

type PropertyOption = {
  id: string;
  name: string;
};

type RoomOption = {
  id: string;
  property_id: string | null;
  name: string | null;
  room_number: string | null;
};

type TicketOption = {
  id: string;
  property_id: string;
  ticket_number: string | null;
  description: string;
};

function roomLabel(room: RoomOption) {
  const value = room.room_number || room.name || room.id.slice(0, 8);
  return /^room\s/i.test(value) ? value : `Room ${value}`;
}

function SubmitClaimButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-disabled={pending}
      className="w-fit px-6 lg:col-span-2"
      disabled={pending}
      type="submit"
    >
      {pending ? "Submitting claim…" : "Submit claim"}
    </Button>
  );
}

export function ClaimBillForm({
  allowUnlinkedJob,
  properties,
  returnTo = "/maintenance",
  rooms,
  tickets,
}: {
  allowUnlinkedJob: boolean;
  properties: PropertyOption[];
  returnTo?: string;
  rooms: RoomOption[];
  tickets: TicketOption[];
}) {
  const [propertyId, setPropertyId] = useState("");
  const [fundingSource, setFundingSource] = useState("company_cash");
  const propertyRooms = useMemo(
    () => rooms.filter((room) => room.property_id === propertyId),
    [propertyId, rooms],
  );
  const propertyTickets = useMemo(
    () => tickets.filter((ticket) => ticket.property_id === propertyId),
    [propertyId, tickets],
  );

  return (
    <form action={createClaimBill} className="grid gap-4 lg:grid-cols-2">
      <input name="returnTo" type="hidden" value={returnTo} />
      <label className="block lg:col-span-2">
        <span className="text-sm font-medium text-gray-700">
          What did you pay for?
        </span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
          name="description"
          placeholder="e.g. New water pump, plumber charge"
          required
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Property *</span>
        <select
          className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
          name="propertyId"
          onChange={(event) => setPropertyId(event.target.value)}
          required
          value={propertyId}
        >
          <option value="">Select a property</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">
          Room (optional)
        </span>
        <select
          className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 disabled:bg-[#f4f6f8]"
          disabled={!propertyId}
          name="roomId"
        >
          <option value="">
            {propertyId ? "No specific room" : "Choose a property first"}
          </option>
          {propertyRooms.map((room) => (
            <option key={room.id} value={room.id}>
              {roomLabel(room)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Amount (RM) *</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
          inputMode="decimal"
          min="0.01"
          name="amount"
          placeholder="e.g. 120"
          required
          step="0.01"
          type="number"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Bill date *</span>
        <input
          className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
          defaultValue={new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kuala_Lumpur",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date())}
          name="billDate"
          required
          type="date"
        />
        <span className="mt-1 block text-xs text-gray-500">
          Reports use this date to place the spending in the correct month.
        </span>
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">Paid with *</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            ["company_cash", "Company money"],
            ["staff_personal", "My own money"],
          ].map(([value, label]) => (
            <label
              className={`cursor-pointer rounded-md border px-3 py-2 text-center text-sm font-medium ${
                fundingSource === value
                  ? "border-[#b98a2c] bg-[#fbf4df] text-[#9a6b12]"
                  : "border-[#d7dde5] bg-white text-gray-700"
              }`}
              key={value}
            >
              <input
                checked={fundingSource === value}
                className="sr-only"
                name="fundingSource"
                onChange={() => setFundingSource(value)}
                type="radio"
                value={value}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block lg:col-span-2">
        <span className="text-sm font-medium text-gray-700">
          For which job? {allowUnlinkedJob ? "(optional)" : "*"}
        </span>
        <select
          className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 disabled:bg-[#f4f6f8]"
          disabled={!propertyId}
          name="ticketId"
          required={!allowUnlinkedJob}
        >
          {allowUnlinkedJob ? (
            <option value="">Not linked to a maintenance report</option>
          ) : (
            <option value="">Choose an assigned job</option>
          )}
          {propertyTickets.map((ticket) => (
            <option key={ticket.id} value={ticket.id}>
              {ticket.ticket_number ?? "Job"} - {ticket.description}
            </option>
          ))}
        </select>
      </label>

      <ClaimDocumentUpload />

      <SubmitClaimButton />
    </form>
  );
}

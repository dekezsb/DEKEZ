"use client";

import { useActionState } from "react";
import {
  createRoomAction,
  createUnitAction,
  type RoomActionState,
} from "./actions";

type CompanyOption = {
  id: string;
  name: string;
};

type PropertyOption = {
  id: string;
  company_id: string;
  name: string;
};

type UnitOption = {
  id: string;
  company_id: string;
  property_id: string;
  name: string;
};

type RoomFormsProps = {
  companies: CompanyOption[];
  properties: PropertyOption[];
  units: UnitOption[];
};

const initialState: RoomActionState = {
  ok: false,
  message: "",
};

export function RoomForms({ companies, properties, units }: RoomFormsProps) {
  const [unitState, createUnit, isCreatingUnit] = useActionState(
    createUnitAction,
    initialState,
  );
  const [roomState, createRoom, isCreatingRoom] = useActionState(
    createRoomAction,
    initialState,
  );

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-950">Create unit</h2>
        <p className="mt-1 text-sm text-gray-500">
          Add a unit, floor, or block under a property.
        </p>
        <form action={createUnit} className="mt-5 space-y-4">
          <CompanySelect companies={companies} />
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Property</span>
            <select
              className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="property_id"
              required
            >
              <option value="">Select property</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Unit name</span>
            <input
              className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="name"
              placeholder="Block A, Level 2, Main House"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Floor</span>
            <input
              className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="floor"
              placeholder="2"
            />
          </label>
          {unitState.message ? (
            <p className={`text-sm ${unitState.ok ? "text-[#126b5f]" : "text-red-600"}`}>
              {unitState.message}
            </p>
          ) : null}
          <button
            className="rounded-md bg-[#126b5f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f5a50] disabled:opacity-60"
            disabled={isCreatingUnit || properties.length === 0}
            type="submit"
          >
            {isCreatingUnit ? "Creating..." : "Create unit"}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-950">Create room</h2>
        <p className="mt-1 text-sm text-gray-500">
          Add a room with one of the approved statuses.
        </p>
        <form action={createRoom} className="mt-5 space-y-4">
          <CompanySelect companies={companies} />
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Unit</span>
            <select
              className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="unit_id"
              required
            >
              <option value="">Select unit</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Room number</span>
            <input
              className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="room_number"
              placeholder="A-01"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Status</span>
            <select
              className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="status"
              required
            >
              <option value="vacant">Vacant</option>
              <option value="occupied">Occupied</option>
              <option value="maintenance">Maintenance</option>
              <option value="reserved">Reserved</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Notes</span>
            <textarea
              className="mt-2 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
              name="notes"
            />
          </label>
          {roomState.message ? (
            <p className={`text-sm ${roomState.ok ? "text-[#126b5f]" : "text-red-600"}`}>
              {roomState.message}
            </p>
          ) : null}
          <button
            className="rounded-md bg-[#126b5f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f5a50] disabled:opacity-60"
            disabled={isCreatingRoom || units.length === 0}
            type="submit"
          >
            {isCreatingRoom ? "Creating..." : "Create room"}
          </button>
        </form>
      </section>
    </div>
  );
}

function CompanySelect({ companies }: { companies: CompanyOption[] }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">Company</span>
      <select
        className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
        name="company_id"
        required
      >
        <option value="">Select company</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
    </label>
  );
}

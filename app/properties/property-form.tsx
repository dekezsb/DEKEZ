"use client";

import { useActionState } from "react";
import { createPropertyAction, type PropertyActionState } from "./actions";

type CompanyOption = {
  id: string;
  name: string;
};

type PropertyFormProps = {
  companies: CompanyOption[];
};

const initialState: PropertyActionState = {
  ok: false,
  message: "",
};

export function PropertyForm({ companies }: PropertyFormProps) {
  const [state, action, isPending] = useActionState(createPropertyAction, initialState);

  return (
    <section className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-950">Create property</h2>
      <p className="mt-1 text-sm text-gray-500">
        Add a property under one of your managed companies.
      </p>

      <form action={action} className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="block lg:col-span-2">
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
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Property name</span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            name="name"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Property type</span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            name="property_type"
            placeholder="Apartment, hostel, landed house"
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="text-sm font-medium text-gray-700">Address</span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            name="address"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">City</span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            name="city"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">State</span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            name="state"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Postcode</span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
            name="postcode"
          />
        </label>

        <div className="flex items-end gap-3 lg:col-span-2">
          <button
            className="rounded-md bg-[#126b5f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f5a50] disabled:opacity-60"
            disabled={isPending || companies.length === 0}
            type="submit"
          >
            {isPending ? "Creating..." : "Create property"}
          </button>
          {state.message ? (
            <p className={`text-sm ${state.ok ? "text-[#126b5f]" : "text-red-600"}`}>
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

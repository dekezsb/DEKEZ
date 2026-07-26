"use client";

import { useRef, useState } from "react";
import { updatePropertyOwner } from "./actions";

type OwnerOption = {
  id: string;
  name: string;
};

type PropertyOwnerSelectProps = {
  currentOwnerId: string | null;
  owners: OwnerOption[];
  propertyId: string;
  propertyName: string;
};

export function PropertyOwnerSelect({
  currentOwnerId,
  owners,
  propertyId,
  propertyName,
}: PropertyOwnerSelectProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form action={updatePropertyOwner} ref={formRef}>
      <input name="propertyId" type="hidden" value={propertyId} />
      <label className="block min-w-48">
        <span className="text-[11px] font-semibold uppercase text-gray-500">
          {saving ? "Saving..." : "Owner"}
        </span>
        <select
          aria-label={`Owner for ${propertyName}`}
          className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20 disabled:cursor-not-allowed disabled:bg-gray-100"
          defaultValue={currentOwnerId ?? ""}
          disabled={!owners.length || saving}
          name="ownerId"
          onChange={() => {
            formRef.current?.requestSubmit();
            setSaving(true);
          }}
          required
        >
          <option disabled value="">
            {owners.length ? "Select owner" : "No Owner accounts"}
          </option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

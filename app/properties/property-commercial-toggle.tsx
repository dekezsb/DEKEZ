"use client";

import { useRef, useState } from "react";
import { updatePropertyCommercial } from "./actions";

export function PropertyCommercialToggle({
  isCommercial,
  propertyId,
  propertyName,
}: {
  isCommercial: boolean;
  propertyId: string;
  propertyName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form action={updatePropertyCommercial} ref={formRef}>
      <input name="propertyId" type="hidden" value={propertyId} />
      <label className="inline-flex cursor-pointer flex-col items-center gap-1">
        <span className="relative inline-flex h-6 w-11 items-center">
          <input
            aria-label={`Commercial title for ${propertyName}`}
            className="peer sr-only"
            defaultChecked={isCommercial}
            disabled={saving}
            name="isCommercial"
            onChange={() => {
              setSaving(true);
              formRef.current?.requestSubmit();
            }}
            type="checkbox"
          />
          <span className="absolute inset-0 rounded-full bg-gray-200 transition peer-checked:bg-[#b98a29] peer-focus-visible:ring-2 peer-focus-visible:ring-[#b98a29]/40 peer-disabled:cursor-wait" />
          <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5" />
        </span>
        <span className={`text-[10px] font-medium uppercase ${isCommercial ? "text-[#9a6b0f]" : "text-gray-500"}`}>
          {saving ? "Saving" : "Commercial"}
        </span>
      </label>
    </form>
  );
}

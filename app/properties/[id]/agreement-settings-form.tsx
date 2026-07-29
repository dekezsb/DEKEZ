"use client";

import { useState } from "react";
import { FileSignature, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agreementTypeLabel } from "@/lib/tenancy/agreement-types";
import {
  FACILITY_OPTIONS,
  OPTIONAL_CLAUSES,
  PROPERTY_TYPES,
  type PropertyInventoryItem,
  type PropertyTenancySettings,
} from "@/lib/tenancy/property-settings";

type AgreementSettingsFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  propertyId: string;
  readOnly: boolean;
  settings: PropertyTenancySettings;
};

const inputClass =
  "w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm text-gray-950 outline-none focus:border-[#b98a29] focus:ring-2 focus:ring-[#b98a29]/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-600";

function emptyInventoryItem(): PropertyInventoryItem {
  return { name: "", quantity: 1, notes: "" };
}

export function AgreementSettingsForm({
  action,
  propertyId,
  readOnly,
  settings,
}: AgreementSettingsFormProps) {
  const [facilities, setFacilities] = useState(settings.facilities);
  const [clauses, setClauses] = useState(settings.optionalClauses);
  const [airConditionerMode, setAirConditionerMode] = useState(
    settings.airConditionerMode,
  );
  const agreementType = settings.defaultAgreementType;
  const [waterMode, setWaterMode] = useState(settings.waterMode);
  const [electricityMode, setElectricityMode] = useState(
    settings.electricityMode,
  );
  const [inventory, setInventory] = useState(settings.inventory);
  const applicableFacilities = FACILITY_OPTIONS.filter(
    (option) =>
      option.appliesTo === "both" || option.appliesTo === agreementType,
  );
  const applicableClauses = OPTIONAL_CLAUSES.filter(
    (option) =>
      option.appliesTo === "both" || option.appliesTo === agreementType,
  );

  function updateInventory(
    index: number,
    field: keyof PropertyInventoryItem,
    value: string,
  ) {
    setInventory((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]:
                field === "quantity"
                  ? Math.max(1, Math.floor(Number(value) || 1))
                  : value,
            }
          : item,
      ),
    );
  }

  return (
    <form action={action} className="space-y-7">
      <input name="propertyId" type="hidden" value={propertyId} />

      <div className="flex items-start gap-3">
        <div className="rounded-md bg-[#f6edd9] p-2 text-[#9a6b12]">
          <FileSignature className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-950">Master Agreement Settings</h3>
          <p className="mt-1 text-sm text-gray-600">
            These property settings are applied to each newly generated tenancy term.
          </p>
        </div>
      </div>

      <fieldset className="space-y-4" disabled={readOnly}>
        <legend className="text-sm font-semibold text-gray-950">
          Property & Utilities
        </legend>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-[#dbc38e] bg-[#fbf6e9] p-3 md:col-span-2">
            <p className="text-xs font-semibold uppercase text-[#8a6418]">
              Agreement mode
            </p>
            <p className="mt-1 text-sm font-semibold text-gray-950">
              {agreementTypeLabel(agreementType)}
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Automatically selected from the Commercial switch on the
              Properties page.
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Property type</span>
            <select
              className={`${inputClass} mt-1.5`}
              defaultValue={settings.propertyType}
              name="propertyType"
            >
              {PROPERTY_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Water</span>
            <select
              className={`${inputClass} mt-1.5`}
              name="waterMode"
              onChange={(event) =>
                setWaterMode(
                  event.target.value as PropertyTenancySettings["waterMode"],
                )
              }
              value={waterMode}
            >
              <option value="included">Included</option>
              <option value="tenant_pays">Tenant Pays</option>
              <option value="smart_meter">Smart Meter</option>
              <option value="monthly_quota">Monthly Quota</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Electricity</span>
            <select
              className={`${inputClass} mt-1.5`}
              name="electricityMode"
              onChange={(event) =>
                setElectricityMode(
                  event.target
                    .value as PropertyTenancySettings["electricityMode"],
                )
              }
              value={electricityMode}
            >
              <option value="included">Included</option>
              <option value="tenant_pays">Tenant Pays</option>
              <option value="smart_meter">Smart Meter</option>
              <option value="monthly_quota">Monthly Quota</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Air conditioner</span>
            <select
              className={`${inputClass} mt-1.5`}
              name="airConditionerMode"
              onChange={(event) =>
                setAirConditionerMode(
                  event.target.value as PropertyTenancySettings["airConditionerMode"],
                )
              }
              value={airConditionerMode}
            >
              <option value="included">Included</option>
              <option value="smart_meter">Smart Meter</option>
              <option value="monthly_free_quota">Monthly Free Quota</option>
              <option value="none">No Air Conditioner</option>
            </select>
          </label>
        </div>
        {waterMode === "smart_meter" || waterMode === "monthly_quota" ? (
          <div className="grid gap-4 md:grid-cols-2">
            {waterMode === "monthly_quota" ? (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">
                  Water monthly quota
                </span>
                <input
                  className={`${inputClass} mt-1.5`}
                  defaultValue={settings.waterMonthlyQuota ?? ""}
                  min="0"
                  name="waterMonthlyQuota"
                  step="0.01"
                  type="number"
                />
              </label>
            ) : null}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Water rate per unit (RM)
              </span>
              <input
                className={`${inputClass} mt-1.5`}
                defaultValue={settings.waterRate ?? ""}
                min="0"
                name="waterRate"
                step="0.0001"
                type="number"
              />
            </label>
          </div>
        ) : null}
        {electricityMode === "smart_meter" ||
        electricityMode === "monthly_quota" ? (
          <div className="grid gap-4 md:grid-cols-2">
            {electricityMode === "monthly_quota" ? (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">
                  Electricity monthly quota (kWh)
                </span>
                <input
                  className={`${inputClass} mt-1.5`}
                  defaultValue={settings.electricityMonthlyQuota ?? ""}
                  min="0"
                  name="electricityMonthlyQuota"
                  step="0.01"
                  type="number"
                />
              </label>
            ) : null}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Electricity rate per kWh (RM)
              </span>
              <input
                className={`${inputClass} mt-1.5`}
                defaultValue={settings.electricityRate ?? ""}
                min="0"
                name="electricityRate"
                step="0.0001"
                type="number"
              />
            </label>
          </div>
        ) : null}
        {agreementType === "commercial_office" ? (
          <label className="block max-w-sm">
            <span className="text-sm font-medium text-gray-700">
              Maximum employees / authorised users
            </span>
            <input
              className={`${inputClass} mt-1.5`}
              defaultValue={settings.employeeLimit ?? ""}
              min="1"
              name="employeeLimit"
              step="1"
              type="number"
            />
          </label>
        ) : null}
        {airConditionerMode === "monthly_free_quota" ? (
          <label className="block max-w-sm">
            <span className="text-sm font-medium text-gray-700">
              Monthly free quota (kWh)
            </span>
            <input
              className={`${inputClass} mt-1.5`}
              defaultValue={settings.airConditionerFreeQuotaKwh ?? 0}
              min="0"
              name="airConditionerFreeQuotaKwh"
              step="0.01"
              type="number"
            />
          </label>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4" disabled={readOnly}>
        <legend className="text-sm font-semibold text-gray-950">
          Included Facilities
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {applicableFacilities.map((option) => {
            const included = facilities[option.code];
            return (
              <label
                className={`flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
                  included
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-gray-200 bg-gray-50"
                }`}
                key={option.code}
              >
                <span className="font-medium text-gray-800">{option.label}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={
                      included
                        ? "text-xs font-semibold text-emerald-700"
                        : "text-xs font-medium text-gray-500"
                    }
                  >
                    {included ? "Included" : "Not Included"}
                  </span>
                  <input
                    checked={included}
                    className="h-4 w-4 accent-[#b98a29]"
                    name={`facility.${option.code}`}
                    onChange={(event) =>
                      setFacilities((current) => ({
                        ...current,
                        [option.code]: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={readOnly}>
        <legend className="text-sm font-semibold text-gray-950">
          Optional Clauses
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {applicableClauses.map((option) => (
            <label
              className={`flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                clauses[option.code]
                  ? "border-[#dbc38e] bg-[#fbf6e9]"
                  : "border-gray-200 bg-white"
              }`}
              key={option.code}
            >
              <input
                checked={clauses[option.code]}
                className="h-4 w-4 accent-[#b98a29]"
                name={`clause.${option.code}`}
                onChange={(event) =>
                  setClauses((current) => ({
                    ...current,
                    [option.code]: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span className="font-medium text-gray-800">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={readOnly}>
        <legend className="text-sm font-semibold text-gray-950">
          Inventory Checklist
        </legend>
        <div className="flex items-center justify-end gap-3">
          {!readOnly ? (
            <Button
              onClick={() =>
                setInventory((current) => [...current, emptyInventoryItem()])
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus className="h-4 w-4" />
              Add Item
            </Button>
          ) : null}
        </div>
        {inventory.length ? (
          <div className="space-y-2">
            {inventory.map((item, index) => (
              <div
                className="grid gap-2 rounded-md border border-gray-200 p-3 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)_40px]"
                key={`${item.name}-${index}`}
              >
                <input
                  aria-label={`Inventory item ${index + 1}`}
                  className={inputClass}
                  name="inventoryName"
                  onChange={(event) =>
                    updateInventory(index, "name", event.target.value)
                  }
                  placeholder="Item name"
                  value={item.name}
                />
                <input
                  aria-label={`Inventory quantity ${index + 1}`}
                  className={inputClass}
                  min="1"
                  name="inventoryQuantity"
                  onChange={(event) =>
                    updateInventory(index, "quantity", event.target.value)
                  }
                  type="number"
                  value={item.quantity}
                />
                <input
                  aria-label={`Inventory notes ${index + 1}`}
                  className={inputClass}
                  name="inventoryNotes"
                  onChange={(event) =>
                    updateInventory(index, "notes", event.target.value)
                  }
                  placeholder="Condition or notes"
                  value={item.notes}
                />
                {!readOnly ? (
                  <Button
                    aria-label={`Remove ${item.name || "inventory item"}`}
                    onClick={() =>
                      setInventory((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
            No inventory items configured.
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-4" disabled={readOnly}>
        <legend className="text-sm font-semibold text-gray-950">
          Key Handover
        </legend>
        <div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Key handover notes
            </span>
            <textarea
              className={`${inputClass} mt-1.5 min-h-20 resize-y`}
              defaultValue={settings.keyHandoverNotes}
              name="keyHandoverNotes"
            />
          </label>
        </div>
      </fieldset>

      {!readOnly ? (
        <div className="flex justify-end border-t border-gray-200 pt-5">
          <Button type="submit">
            <Save className="h-4 w-4" />
            Save Agreement Settings
          </Button>
        </div>
      ) : null}
    </form>
  );
}

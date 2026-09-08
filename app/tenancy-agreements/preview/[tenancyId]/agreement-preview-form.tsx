"use client";

import { CheckCircle2, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  agreementTypeLabel,
  type AgreementDocumentType,
} from "@/lib/tenancy/agreement-types";
import {
  FACILITY_OPTIONS,
  OPTIONAL_CLAUSES,
  type PropertyTenancySettings,
} from "@/lib/tenancy/property-settings";
import { commercialDepositSchedule } from "@/lib/tenancy/commercial-deposit-policy";

type AgreementPreviewFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  agreementType: AgreementDocumentType;
  monthlyRent: number;
  propertyName: string;
  roomName: string;
  settings: PropertyTenancySettings;
  tenantName: string;
  tenantType: string;
  tenancyId: string;
};

function utilityLabel(
  mode: PropertyTenancySettings["waterMode"],
  quota: number | null,
  rate: number | null,
) {
  if (mode === "included") return "Included";
  if (mode === "tenant_pays") return "Tenant Pays Separately";
  if (mode === "smart_meter") {
    return `Smart Meter${rate === null ? "" : ` at RM ${rate.toFixed(4)} per unit`}`;
  }
  return `Monthly Quota${quota === null ? "" : ` ${quota.toFixed(2)}`}${
    rate === null ? "" : `, excess RM ${rate.toFixed(4)} per unit`
  }`;
}

export function AgreementPreviewForm({
  action,
  agreementType,
  monthlyRent,
  propertyName,
  roomName,
  settings,
  tenantName,
  tenantType,
  tenancyId,
}: AgreementPreviewFormProps) {
  const preview = {
    facilities: FACILITY_OPTIONS.filter(
      (option) =>
        (option.appliesTo === "both" ||
          option.appliesTo === agreementType) &&
        settings.facilities[option.code],
    ).map((option) => option.label),
    clauses: OPTIONAL_CLAUSES.filter(
      (option) =>
        (option.appliesTo === "both" ||
          option.appliesTo === agreementType) &&
        settings.optionalClauses[option.code],
    ).map((option) => option.label),
    permittedUse:
      agreementType === "commercial_office"
        ? "Commercial office use only, subject to written approval."
        : "Residential accommodation only.",
  };

  const displayedTenantType =
    agreementType === "residential_room"
      ? "Individual tenant"
      : tenantType === "company"
        ? "Company"
        : "Sole proprietor / enterprise";
  const commercialDeposits = commercialDepositSchedule(monthlyRent);

  return (
    <form action={action} className="space-y-6">
      <input name="tenancyId" type="hidden" value={tenancyId} />

      <div className="max-w-xl rounded-md border border-[#dbc38e] bg-[#fbf6e9] p-4">
        <p className="text-xs font-semibold uppercase text-[#8a6418]">
          Agreement type
        </p>
        <p className="mt-1 text-sm font-semibold text-gray-950">
          {agreementTypeLabel(agreementType)}
        </p>
        <p className="mt-1 text-xs text-gray-600">
          Automatically selected from this property&apos;s Commercial switch.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {[
          ["Agreement type", agreementTypeLabel(agreementType)],
          ["Tenant type", displayedTenantType],
          ["Tenant", tenantName],
          ["Property / Room", `${propertyName} / ${roomName}`],
          ["Permitted use", preview.permittedUse],
        ].map(([label, value]) => (
          <div
            className="rounded-md border border-[#d7dde5] bg-white p-4"
            key={label}
          >
            <p className="text-xs font-semibold uppercase text-gray-500">
              {label}
            </p>
            <p className="mt-1.5 text-sm font-medium text-gray-950">{value}</p>
          </div>
        ))}
      </div>

      {agreementType === "commercial_office" ? (
        <section className="rounded-md border border-[#dbc38e] bg-[#fbf6e9] p-4">
          <h3 className="font-semibold text-gray-950">
            Commercial office deposit schedule
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            This fixed formula will be written clearly into the tenancy
            agreement.
          </p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-gray-500">Security — 2 months</dt>
              <dd className="mt-1 font-semibold text-gray-950">
                RM {commercialDeposits.securityDeposit.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Utilities — 0.5 month</dt>
              <dd className="mt-1 font-semibold text-gray-950">
                RM {commercialDeposits.utilityDeposit.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Total required</dt>
              <dd className="mt-1 font-semibold text-gray-950">
                RM {commercialDeposits.totalDeposit.toFixed(2)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-[#d7dde5] bg-white p-4">
          <h3 className="font-semibold text-gray-950">Included Facilities</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {preview.facilities.length ? (
              preview.facilities.map((facility) => (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800"
                  key={facility}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {facility}
                </span>
              ))
            ) : (
              <p className="text-sm text-gray-500">No facilities included.</p>
            )}
          </div>
        </section>

        <section className="rounded-md border border-[#d7dde5] bg-white p-4">
          <h3 className="font-semibold text-gray-950">Utilities</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Water</dt>
              <dd className="text-right font-medium">
                {utilityLabel(
                  settings.waterMode,
                  settings.waterMonthlyQuota,
                  settings.waterRate,
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Electricity</dt>
              <dd className="text-right font-medium">
                {utilityLabel(
                  settings.electricityMode,
                  settings.electricityMonthlyQuota,
                  settings.electricityRate,
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Air conditioner</dt>
              <dd className="text-right font-medium">
                {settings.airConditionerMode.replaceAll("_", " ")}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md border border-[#d7dde5] bg-white p-4">
          <h3 className="font-semibold text-gray-950">Inventory</h3>
          {settings.inventory.length ? (
            <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
              {settings.inventory.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  {item.quantity} x {item.name}
                  {item.notes ? ` - ${item.notes}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              No property inventory configured.
            </p>
          )}
        </section>

        <section className="rounded-md border border-[#d7dde5] bg-white p-4">
          <h3 className="font-semibold text-gray-950">Enabled Clauses</h3>
          {preview.clauses.length ? (
            <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
              {preview.clauses.map((clause) => (
                <li key={clause}>{clause}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              No optional clauses enabled.
            </p>
          )}
        </section>
      </div>

      <label className="flex items-start gap-3 rounded-md border border-[#dbc38e] bg-[#fbf6e9] p-4 text-sm text-gray-800">
        <input
          className="mt-0.5 h-4 w-4 accent-[#b98a2c]"
          name="confirmed"
          required
          type="checkbox"
        />
        <span>
          I confirm that the agreement type and property settings above are
          correct. The generated wording will use only clauses applicable to
          this agreement type.
        </span>
      </label>

      <div className="flex justify-end border-t border-gray-200 pt-5">
        <Button className="min-w-52" type="submit">
          <FileCheck2 className="h-4 w-4" />
          Confirm & Generate
        </Button>
      </div>
    </form>
  );
}

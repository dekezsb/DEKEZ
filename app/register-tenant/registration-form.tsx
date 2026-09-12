"use client";

import { useState } from "react";
import { supportsReservations } from "@/lib/tenancy/reservation-policy";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { commercialDepositSchedule } from "@/lib/tenancy/commercial-deposit-policy";

type RegistrationProperty = {
  id: string;
  label: string;
  isCommercial: boolean;
  rentalModel: "tenancy" | "monthly_stay";
  code: string | null;
};

type RegistrationRoom = {
  id: string;
  propertyId: string;
  roomNumber: string;
  monthlyRent: number;
};

function roomLabel(value: string) {
  return /^room\b/i.test(value.trim()) ? value.trim() : `Room ${value.trim()}`;
}

function fieldClass() {
  return "mt-1.5 h-11 w-full rounded-md border border-[#cfd8e6] bg-white px-3 text-sm text-[#07142f] outline-none transition focus:border-[#b98a2c] focus:ring-2 focus:ring-[#b98a2c]/20";
}

function FileField({
  label,
  name,
  required,
}: {
  label: string;
  name: string;
  required?: boolean;
}) {
  return (
    <label>
      <span className="text-sm font-medium text-[#17223b]">{label}</span>
      <input
        accept="image/*,.pdf"
        className="mt-1.5 block w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#f4ead3] file:px-3 file:py-1.5 file:font-medium file:text-[#795917]"
        name={name}
        required={required}
        type="file"
      />
    </label>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      className="h-11 bg-[#b98a2c] px-6 text-white hover:bg-[#9d7424]"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Submitting..." : "Submit for verification"}
    </Button>
  );
}

export function RegistrationForm({
  action,
  initialPropertyId,
  initialRoomId,
  properties,
  rooms,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initialPropertyId?: string;
  initialRoomId?: string;
  properties: RegistrationProperty[];
  rooms: RegistrationRoom[];
}) {
  const firstPropertyId =
    properties.find((property) => property.id === initialPropertyId)?.id ?? "";
  const [propertyId, setPropertyId] = useState(firstPropertyId);
  const propertyRooms = rooms.filter(
    (room) => room.propertyId === propertyId,
  );
  const initialRoom =
    propertyRooms.find((room) => room.id === initialRoomId) ??
    propertyRooms[0] ??
    null;
  const [roomId, setRoomId] = useState(initialRoom?.id ?? "");
  const [monthlyRent, setMonthlyRent] = useState(
    String(initialRoom?.monthlyRent ?? 0),
  );
  const [rentPaid, setRentPaid] = useState("0");
  const [depositPaid, setDepositPaid] = useState("0");
  const [staffNote, setStaffNote] = useState("");
  const [registrationMode, setRegistrationMode] = useState("check_in");
  const [identityType, setIdentityType] = useState<"ic" | "passport">("ic");
  const [tenantType, setTenantType] = useState<"company" | "sole_proprietor">(
    "sole_proprietor",
  );
  const selectedProperty = properties.find(
    (property) => property.id === propertyId,
  );
  const isMonthlyStay = selectedProperty?.rentalModel === "monthly_stay";
  const isAdvancedPaymentProperty = supportsReservations(selectedProperty?.code);
  const commercialDeposits = commercialDepositSchedule(monthlyRent);
  const requiredDeposit = selectedProperty?.isCommercial
    ? commercialDeposits.totalDeposit
    : isMonthlyStay
      ? 0
      : 0;
  const hasReportedPayment =
    Number(rentPaid || 0) + Number(depositPaid || 0) > 0;

  function selectProperty(nextPropertyId: string) {
    setPropertyId(nextPropertyId);
    const firstRoom = rooms.find(
      (room) => room.propertyId === nextPropertyId,
    );
    setRoomId(firstRoom?.id ?? "");
    setMonthlyRent(String(firstRoom?.monthlyRent ?? 0));
    const nextProperty = properties.find(
      (property) => property.id === nextPropertyId,
    );
    if (!nextProperty?.isCommercial) {
      setTenantType("sole_proprietor");
    }
    setRentPaid("0");
    setDepositPaid("0");
    setStaffNote("");
    setRegistrationMode("check_in");
  }

  function selectRoom(nextRoomId: string) {
    setRoomId(nextRoomId);
    const room = rooms.find((candidate) => candidate.id === nextRoomId);
    setMonthlyRent(String(room?.monthlyRent ?? 0));
  }

  return (
    <form action={action} className="grid gap-5 sm:grid-cols-2">
      <label>
        <span className="text-sm font-medium text-[#17223b]">Property</span>
        <select
          className={fieldClass()}
          name="propertyId"
          onChange={(event) => selectProperty(event.target.value)}
          required
          value={propertyId}
        >
          <option value="">Select a property</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.label}
            </option>
          ))}
        </select>
      </label>

      {isAdvancedPaymentProperty ? (
        <div className="rounded-md border border-[#d7dde5] p-4 sm:col-span-2">
          <label className="block">
            <span className="text-sm font-semibold">Registration type</span>
            <select className={fieldClass()} name="registrationMode" value={registrationMode} onChange={(event) => setRegistrationMode(event.target.value)}>
              <option value="check_in">Check in tenant — submit for approval</option>
              <option value="reservation">Reserve room only — tenant has not checked in</option>
            </select>
          </label>
        </div>
      ) : null}

      {selectedProperty?.isCommercial ? (
        <fieldset className="grid gap-4 rounded-md border border-[#d7dde5] p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-[#07142f]">
            Commercial Tenant Details
          </legend>
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Tenant type
            </span>
            <select
              className={fieldClass()}
              name="tenantType"
              onChange={(event) =>
                setTenantType(
                  event.target.value as "company" | "sole_proprietor",
                )
              }
              required
              value={tenantType}
            >
              <option value="company">Company</option>
              <option value="sole_proprietor">
                Sole proprietor / enterprise
              </option>
            </select>
          </label>
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Company / business name
            </span>
            <input
              className={fieldClass()}
              name="businessName"
              required
            />
          </label>
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Registration number
            </span>
            <input
              className={fieldClass()}
              name="businessRegistrationNumber"
              required
            />
          </label>
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Authorised representative
            </span>
            <input
              className={fieldClass()}
              name="authorisedRepresentativeName"
              required
            />
          </label>
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Representative IC / Passport
            </span>
            <input
              className={fieldClass()}
              name="representativeIdentityNumber"
              required
            />
          </label>
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Business contact number
            </span>
            <input
              className={fieldClass()}
              inputMode="tel"
              name="businessContactNumber"
              required
              type="tel"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-sm font-medium text-[#17223b]">
              Registered address
            </span>
            <textarea
              className={`${fieldClass()} min-h-24 py-3`}
              name="registeredAddress"
              required
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-sm font-medium text-[#17223b]">
              Business email
            </span>
            <input
              className={fieldClass()}
              name="businessEmail"
              required
              type="email"
            />
          </label>
        </fieldset>
      ) : (
        <input name="tenantType" type="hidden" value="individual" />
      )}

      <label>
        <span className="text-sm font-medium text-[#17223b]">
          Available room
        </span>
        <select
          className={fieldClass()}
          disabled={!propertyId || !propertyRooms.length}
          name="roomId"
          onChange={(event) => selectRoom(event.target.value)}
          required
          value={roomId}
        >
          <option value="">
            {propertyId
              ? propertyRooms.length
                ? "Select a vacant room"
                : "No vacant rooms available"
              : "Choose a property first"}
          </option>
          {propertyRooms.map((room) => (
            <option key={room.id} value={room.id}>
              {roomLabel(room.roomNumber)}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="text-sm font-medium text-[#17223b]">Tenant name</span>
        <input
          className={fieldClass()}
          name="fullName"
          placeholder="Full name"
          required
        />
      </label>

      <div>
        <span className="text-sm font-medium text-[#17223b]">
          IC / Passport
        </span>
        <div className="mt-1.5 grid grid-cols-[7rem_1fr] gap-2">
          <select
            className={`${fieldClass()} mt-0`}
            name="identityType"
            onChange={(event) =>
              setIdentityType(event.target.value as "ic" | "passport")
            }
            value={identityType}
          >
            <option value="ic">IC</option>
            <option value="passport">Passport</option>
          </select>
          <input
            className={`${fieldClass()} mt-0`}
            name="identificationNumber"
            placeholder={
              identityType === "ic" ? "e.g. 990101-01-1234" : "Passport number"
            }
            required
          />
        </div>
      </div>

      <label>
        <span className="text-sm font-medium text-[#17223b]">
          Phone / WhatsApp
        </span>
        <input
          className={fieldClass()}
          inputMode="tel"
          name="phone"
          placeholder="+60 12-345 6789"
          required
          type="tel"
        />
      </label>

      <label>
        <span className="text-sm font-medium text-[#17223b]">
          Emergency contact name
        </span>
        <input
          className={fieldClass()}
          name="emergencyContactName"
          placeholder="Person to contact in an emergency"
          required
        />
      </label>

      <label>
        <span className="text-sm font-medium text-[#17223b]">
          Emergency contact number
        </span>
        <input
          className={fieldClass()}
          inputMode="tel"
          name="emergencyContactNumber"
          placeholder="+60 12-345 6789"
          required
          type="tel"
        />
      </label>

      <label>
        <span className="text-sm font-medium text-[#17223b]">
          Agreed room rent to collect (RM)
        </span>
        <input
          className={`${fieldClass()} ${
            selectedProperty?.isCommercial ? "bg-gray-50" : ""
          }`}
          min="0"
          name="monthlyRent"
          onChange={(event) => setMonthlyRent(event.target.value)}
          readOnly={selectedProperty?.isCommercial}
          required
          step="0.01"
          type="number"
          value={monthlyRent}
        />
        {selectedProperty?.isCommercial ? (
          <span className="mt-1.5 block text-xs text-[#60708a]">
            Uses this room&apos;s rent from Room Management so the 2 + 0.5 month
            deposit and TA stay correct.
          </span>
        ) : null}
      </label>

      {isMonthlyStay ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>Sulaman monthly stay</strong><br />
          No deposit and no tenancy agreement. Payments can be recorded in instalments;
          monthly rent starts from the approved check-in date.
          <input name="deposit" type="hidden" value="0" />
        </div>
      ) : selectedProperty?.isCommercial ? (
        <div className="rounded-md border border-[#dbc38e] bg-[#fbf6e9] p-4 text-sm leading-6 text-[#61470f]">
          <strong>Commercial office deposit</strong>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt>Security deposit — 2 months</dt>
            <dd className="font-semibold">
              RM {commercialDeposits.securityDeposit.toFixed(2)}
            </dd>
            <dt>Utility deposit — 0.5 month</dt>
            <dd className="font-semibold">
              RM {commercialDeposits.utilityDeposit.toFixed(2)}
            </dd>
            <dt className="border-t border-[#dbc38e] pt-1 font-semibold">
              Total required
            </dt>
            <dd className="border-t border-[#dbc38e] pt-1 font-semibold">
              RM {commercialDeposits.totalDeposit.toFixed(2)}
            </dd>
          </dl>
          <input
            name="deposit"
            type="hidden"
            value={commercialDeposits.securityDeposit.toFixed(2)}
          />
          <input
            name="utilityDeposit"
            type="hidden"
            value={commercialDeposits.utilityDeposit.toFixed(2)}
          />
        </div>
      ) : (
        <label>
          <span className="text-sm font-medium text-[#17223b]">
            Agreed security deposit to collect (RM)
          </span>
          <input
            className={fieldClass()}
            defaultValue="0"
            min="0"
            name="deposit"
            step="0.01"
            type="number"
          />
          <input name="utilityDeposit" type="hidden" value="0" />
        </label>
      )}

      <fieldset className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 sm:col-span-2">
        <legend className="px-1 text-sm font-semibold text-emerald-950">
          Check-in payment declaration
        </legend>
        <p className="mb-4 text-xs leading-5 text-emerald-900">
          Enter exactly what was received today. Rent and deposit are recorded
          separately, so partial payments stay clear for your main account to
          verify. Leave both fields at RM 0.00 if nothing has been paid yet.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Rent received today (RM)
            </span>
            <input
              className={fieldClass()}
              max={monthlyRent || undefined}
              min="0"
              name="rentPaid"
              onChange={(event) => setRentPaid(event.target.value)}
              step="0.01"
              type="number"
              value={rentPaid}
            />
          </label>
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Deposit received today (RM)
            </span>
            <input
              className={fieldClass()}
              max={requiredDeposit || undefined}
              min="0"
              name="depositPaid"
              onChange={(event) => setDepositPaid(event.target.value)}
              step="0.01"
              type="number"
              value={depositPaid}
            />
          </label>
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-[#17223b]">
            Staff check-in note
          </span>
          <textarea
            className={`${fieldClass()} min-h-20 py-3`}
            name="staffNote"
            onChange={(event) => setStaffNote(event.target.value)}
            placeholder="e.g. Tenant paid the deposit first. Rent balance will be paid later."
            value={staffNote}
          />
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="text-sm font-medium text-[#17223b]">
              Payment date
            </span>
            <input className={fieldClass()} name="paymentDate" type="date" />
          </label>
          <FileField
            label="Bank / DuitNow payment proof"
            name="paymentSlip"
            required={hasReportedPayment}
          />
        </div>
        <input name="paymentMethod" type="hidden" value="online_payment" />
        <p className="mt-3 text-xs leading-5 text-emerald-900">
          {hasReportedPayment
            ? "This proof will be sent to Payment Verification. It is not counted as paid until you verify it."
            : "No payment proof is needed while both received amounts are RM 0.00."}
        </p>
      </fieldset>

      <label>
        <span className="text-sm font-medium text-[#17223b]">
          {registrationMode === "reservation" ? "Expected check-in date" : "Check-in / contract start date"}
        </span>
        <input
          className={fieldClass()}
          name="contractStart"
          required
          type="date"
        />
      </label>

      {isMonthlyStay ? (
        <input name="contractEnd" type="hidden" value="" />
      ) : (
        <label>
          <span className="text-sm font-medium text-[#17223b]">
            Contract end
          </span>
          <input className={fieldClass()} name="contractEnd" type="date" />
        </label>
      )}

      <fieldset className="rounded-md border border-[#d7dde5] p-4 sm:col-span-2">
        <legend className="px-1 text-sm font-semibold text-[#07142f]">
          Identity documents
        </legend>
        <p className="mb-4 text-xs leading-5 text-[#60708a]">
          Upload both sides of the IC, or the passport photo page. Files may be
          JPG, PNG, WebP or PDF up to 10 MB.
        </p>
        {identityType === "ic" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FileField label="IC front" name="icFront" required />
            <FileField label="IC back" name="icBack" required />
          </div>
        ) : (
          <FileField
            label="Passport photo page"
            name="passportPhoto"
            required
          />
        )}
      </fieldset>

      {selectedProperty?.isCommercial ? (
        <div className="rounded-md border border-[#ead8ad] bg-[#fffaf0] p-4 sm:col-span-2">
          <FileField
            label="Trading licence / supporting business document"
            name="commercialSupportingDocument"
            required
          />
          <p className="mt-2 text-xs text-[#795917]">
            Required because this property has a commercial title.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-[#e3e8ef] pt-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs leading-5 text-[#60708a]">
          {registrationMode === "reservation"
            ? "After approval, this room is reserved. Use Reservations to add payments and request actual check-in later."
            : "The room remains vacant until an authorized Admin approves this application in Verification."}
        </p>
        <SubmitButton disabled={!propertyId || !roomId} />
      </div>
    </form>
  );
}

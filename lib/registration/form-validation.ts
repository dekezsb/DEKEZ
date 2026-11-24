import { phoneInputProblem } from "@/lib/auth/phone";
import { reservationAmount, validReservationPaymentDate } from "@/lib/tenancy/reservation-payment";

/**
 * Field-level validation shared by the public registration form and
 * /api/register/start, so the browser and the server name the same field.
 */
export type RegistrationField =
  | "accountType"
  | "propertyId"
  | "roomId"
  | "fullName"
  | "identityNumber"
  | "phone"
  | "agreedMonthlyRent"
  | "agreedDeposit"
  | "icFront"
  | "icBack"
  | "passportPhoto"
  | "commercialSupportingDocument"
  | "companyDocument"
  | "tradingLicense"
  | "reservationDeposit"
  | "paymentDate"
  | "paymentSlip"
  | "rentPaid"
  | "depositPaid";

export type RegistrationFieldErrors = Partial<Record<RegistrationField, string>>;

export const registrationFieldLabels: Record<RegistrationField, string> = {
  accountType: "Tenant or owner",
  propertyId: "Property",
  roomId: "Room",
  fullName: "Full name",
  identityNumber: "IC / passport number",
  phone: "Phone / WhatsApp",
  agreedMonthlyRent: "Agreed room rent",
  agreedDeposit: "Required security deposit",
  icFront: "IC photo (front)",
  icBack: "IC photo (back)",
  passportPhoto: "Passport photo page",
  commercialSupportingDocument: "Trading licence / supporting document",
  companyDocument: "Company document",
  tradingLicense: "Trading licence",
  reservationDeposit: "Reservation deposit received",
  paymentDate: "Payment date",
  paymentSlip: "Payment slip",
  rentPaid: "Rent received today",
  depositPaid: "Deposit received today",
};

/** Order the fields appear on the page, used to focus the first problem. */
export const registrationFieldOrder: RegistrationField[] = [
  "accountType",
  "propertyId",
  "roomId",
  "fullName",
  "identityNumber",
  "phone",
  "agreedMonthlyRent",
  "agreedDeposit",
  "icFront",
  "icBack",
  "passportPhoto",
  "commercialSupportingDocument",
  "tradingLicense",
  "companyDocument",
  "reservationDeposit",
  "rentPaid",
  "depositPaid",
  "paymentDate",
  "paymentSlip",
];

export type RegistrationInput = {
  accountType: string;
  registrationMode?: string;
  identityType?: string;
  fullName?: unknown;
  phone?: unknown;
  identityNumber?: unknown;
  propertyId?: unknown;
  roomId?: unknown;
  rentalModel?: "tenancy" | "monthly_stay" | null;
  agreedMonthlyRent?: unknown;
  agreedDeposit?: unknown;
  reservationDeposit?: unknown;
  paymentDate?: unknown;
  hasPaymentSlip?: boolean;
  rentPaid?: unknown;
  depositPaid?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function money(value: unknown) {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function validateRegistrationInput(input: RegistrationInput): RegistrationFieldErrors {
  const errors: RegistrationFieldErrors = {};
  const isTenant = input.accountType === "tenant";
  const isReservation = isTenant && input.registrationMode === "reservation";

  if (!["owner", "tenant"].includes(input.accountType)) {
    errors.accountType = "Choose Tenant or Owner at the top of the form.";
  }
  if (!text(input.fullName)) errors.fullName = "Enter the full name as per IC / passport.";
  const phoneProblem = phoneInputProblem(text(input.phone));
  if (phoneProblem) errors.phone = phoneProblem;
  if (input.accountType === "owner" && !text(input.identityNumber)) {
    errors.identityNumber = input.identityType === "passport"
      ? "Enter the passport number."
      : "Enter the IC number.";
  }

  if (isTenant) {
    if (!text(input.propertyId)) errors.propertyId = "Choose a property.";
    if (!text(input.roomId)) {
      errors.roomId = text(input.propertyId)
        ? "Choose a room. If none are listed, that property has no vacant room right now."
        : "Choose a property first, then a room.";
    }
    const rent = money(input.agreedMonthlyRent);
    if (rent === null || rent <= 0) {
      errors.agreedMonthlyRent = "Enter the agreed monthly room rent (more than RM0).";
    }
    if (input.rentalModel !== "monthly_stay" && money(input.agreedDeposit) === null) {
      errors.agreedDeposit = "Enter the required security deposit (RM0 if none).";
    }

    if (isReservation) {
      if (reservationAmount(text(input.reservationDeposit)) === null) {
        errors.reservationDeposit = "Enter the reservation deposit actually received (for example RM50).";
      }
      if (!validReservationPaymentDate(text(input.paymentDate))) {
        errors.paymentDate = "Choose the date the reservation deposit was paid.";
      }
      if (!input.hasPaymentSlip) errors.paymentSlip = "Attach the reservation deposit slip.";
    } else if (input.rentPaid !== undefined || input.depositPaid !== undefined) {
      const rentPaid = text(input.rentPaid) ? money(input.rentPaid) : 0;
      const depositPaid = text(input.depositPaid) ? money(input.depositPaid) : 0;
      if (rentPaid === null) errors.rentPaid = "Enter the rent received as a number (0 if none).";
      else if (rent !== null && rent > 0 && rentPaid > rent + 0.005) {
        errors.rentPaid = `Rent received cannot be more than the agreed rent (RM${rent.toFixed(2)}).`;
      }
      // The deposit cap depends on commercial deposit rules, so the server checks it.
      if (depositPaid === null) errors.depositPaid = "Enter the deposit received as a number (0 if none).";
      const total = (rentPaid ?? 0) + (depositPaid ?? 0);
      if (total > 0) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text(input.paymentDate))) {
          errors.paymentDate = "Choose the date the money was received.";
        }
        if (!input.hasPaymentSlip) errors.paymentSlip = "Attach the payment slip for the money received.";
      } else if (input.hasPaymentSlip && rentPaid !== null && depositPaid !== null) {
        errors.rentPaid = "Enter the rent and/or deposit amount shown on the payment slip.";
      }
    }
  }
  return errors;
}

export function orderedErrorFields(errors: RegistrationFieldErrors): RegistrationField[] {
  return registrationFieldOrder.filter((field) => errors[field]);
}

/** Banner text that names every field still needing attention. */
export function summarizeRegistrationErrors(errors: RegistrationFieldErrors): string | null {
  const fields = orderedErrorFields(errors);
  if (!fields.length) return null;
  const labels = fields.map((field) => registrationFieldLabels[field]);
  return `Please check ${fields.length === 1 ? "this field" : `these ${fields.length} fields`}: ${labels.join(", ")}.`;
}

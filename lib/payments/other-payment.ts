/**
 * "Other payment" = money a tenant pays that is NOT monthly rent: an electricity
 * top-up, a lost key / key replacement, a deposit balance or something else.
 *
 * Rules that keep accounting safe (see AGENTS.md accounting governance):
 *  - An other payment goes into the same payment_submissions verification queue
 *    as rent slips, marked with bill_type = "other_payment".
 *  - It NEVER carries a rent_bill_id and verification never touches rent_bills,
 *    so it cannot mark any rent invoice paid or change its outstanding balance.
 *  - Verification posts exactly one `payments` row whose category is the
 *    payment_type below (deposit, key_replacement, top_up, other). It creates no
 *    invoice, no invoice line, no journal and no receivable posting.
 *  - A deposit-balance payment is capped at the tenancy's remaining deposit.
 */

export const OTHER_PAYMENT_BILL_TYPE = "other_payment";

export const OTHER_PAYMENT_TYPES = [
  {
    value: "top_up",
    label: "Electricity top-up",
    shortLabel: "Top-up elektrik",
    hint: "Extra electricity credit. Rooms with a smart-meter top-up box use that box instead.",
    requiresDescription: false,
  },
  {
    value: "key_replacement",
    label: "Lost key / key replacement",
    shortLabel: "Kunci hilang / ganti kunci",
    hint: "Fee for a lost key, access card or replacement key.",
    requiresDescription: false,
  },
  {
    value: "deposit",
    label: "Deposit balance",
    shortLabel: "Baki deposit",
    hint: "Pays part of the security deposit still owed. It cannot be more than the deposit balance.",
    requiresDescription: false,
  },
  {
    value: "other",
    label: "Other payment",
    shortLabel: "Bayaran lain",
    hint: "Anything else. Please describe what it is for.",
    requiresDescription: true,
  },
] as const;

export type OtherPaymentType = (typeof OTHER_PAYMENT_TYPES)[number]["value"];

/** payments.category written when staff verify the slip. Same as the type. */
export const OTHER_PAYMENT_CATEGORIES: Record<OtherPaymentType, string> = {
  top_up: "top_up",
  key_replacement: "key_replacement",
  deposit: "deposit",
  other: "other",
};

/** Tenants may not pay cash through the portal; every other payment needs a slip. */
export const OTHER_PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "duitnow", label: "DuitNow QR" },
  { value: "online_payment", label: "Online payment" },
  { value: "other", label: "Other non-cash payment" },
] as const;

export const OTHER_PAYMENT_MAX_AMOUNT = 50000;
export const OTHER_PAYMENT_MAX_FILE_BYTES = 3 * 1024 * 1024;
export const OTHER_PAYMENT_ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function isOtherPaymentType(value: string): value is OtherPaymentType {
  return OTHER_PAYMENT_TYPES.some((type) => type.value === value);
}

export function isOtherPaymentMethod(value: string) {
  return OTHER_PAYMENT_METHODS.some((method) => method.value === value);
}

export function otherPaymentTypeLabel(value: string | null | undefined) {
  return (
    OTHER_PAYMENT_TYPES.find((type) => type.value === value)?.label ??
    "Other payment"
  );
}

export function otherPaymentCategory(type: OtherPaymentType) {
  return OTHER_PAYMENT_CATEGORIES[type];
}

/** True for slips submitted through the Other payment feature. */
export function isOtherPaymentSubmission(
  submission: { bill_type?: string | null } | null | undefined,
) {
  return submission?.bill_type === OTHER_PAYMENT_BILL_TYPE;
}

/** Label shown on lists: "Other payment — Lost key / key replacement". */
export function otherPaymentDisplayLabel(paymentType: string | null | undefined) {
  return `Other payment — ${otherPaymentTypeLabel(paymentType)}`;
}

export type OtherPaymentFields = {
  type: OtherPaymentType;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string | null;
  description: string;
  note: string;
};

export type OtherPaymentFieldError =
  | "type"
  | "amount"
  | "date"
  | "method"
  | "reference"
  | "description"
  | "note";

export const OTHER_PAYMENT_FIELD_MESSAGES: Record<OtherPaymentFieldError, string> = {
  type: "Choose what the payment is for.",
  amount: "Enter an amount above RM 0 (for example 25.00).",
  date: "Choose the date you paid. It cannot be in the future.",
  method: "Choose how you paid. Cash is not accepted here.",
  reference: "The reference number is too long or has unusual characters.",
  description: "Please write what this payment is for (at least 3 letters).",
  note: "The note is too long (500 letters at most).",
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function malaysiaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  }).format(now);
}

/** Server-side validation of the submitted fields. Pure so it can be tested. */
export function validateOtherPaymentFields(
  input: {
    type: string;
    amount: number;
    paymentDate: string;
    paymentMethod: string;
    referenceNumber: string;
    description: string;
    note: string;
  },
  today = malaysiaToday(),
):
  | { ok: true; value: OtherPaymentFields }
  | { ok: false; error: OtherPaymentFieldError } {
  if (!isOtherPaymentType(input.type)) return { ok: false, error: "type" };
  const type = OTHER_PAYMENT_TYPES.find((item) => item.value === input.type)!;

  if (
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    input.amount > OTHER_PAYMENT_MAX_AMOUNT ||
    Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 0.00001
  ) {
    return { ok: false, error: "amount" };
  }
  if (!validDate(input.paymentDate) || input.paymentDate > today) {
    return { ok: false, error: "date" };
  }
  if (!isOtherPaymentMethod(input.paymentMethod)) {
    return { ok: false, error: "method" };
  }
  const reference = input.referenceNumber.trim();
  if (reference.length > 120 || /[\x00-\x1f\x7f]/.test(reference)) {
    return { ok: false, error: "reference" };
  }
  const description = input.description.trim();
  if (description.length > 200) return { ok: false, error: "description" };
  if (type.requiresDescription && description.length < 3) {
    return { ok: false, error: "description" };
  }
  const note = input.note.trim();
  if (note.length > 500) return { ok: false, error: "note" };

  return {
    ok: true,
    value: {
      type: type.value,
      amount: Math.round(input.amount * 100) / 100,
      paymentDate: input.paymentDate,
      paymentMethod: input.paymentMethod,
      referenceNumber: reference || null,
      description,
      note,
    },
  };
}

/**
 * Text kept in payment_submissions.payment_note: the description, the optional
 * note and, when staff filed it, who it was filed by. Shown on the verification
 * row and in the tenant's payment history.
 */
export function otherPaymentNote(input: {
  description: string;
  note: string;
  submittedByStaffName?: string | null;
}) {
  return [
    input.description ? `For: ${input.description}` : "",
    input.note ? `Note: ${input.note}` : "",
    input.submittedByStaffName
      ? `Submitted by management (${input.submittedByStaffName}) on behalf of the tenant.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A deposit-balance payment can only be as large as the deposit still owed.
 * Returns the remaining deposit and whether this amount fits.
 */
export function depositBalanceCheck(input: {
  depositRequired: number;
  depositReceived: number;
  amount: number;
}) {
  const remaining = Math.max(
    Math.round((input.depositRequired - input.depositReceived) * 100) / 100,
    0,
  );
  return { remaining, fits: input.amount <= remaining + 0.005 };
}

export function isAllowedSlipType(type: string) {
  return (OTHER_PAYMENT_ALLOWED_FILE_TYPES as readonly string[]).includes(type);
}

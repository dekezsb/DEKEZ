/**
 * "Other payment" = money a tenant pays that is NOT monthly rent: an electricity
 * top-up, a lost key / key replacement, a deposit balance or something else.
 *
 * Rules that keep accounting safe (see AGENTS.md accounting governance):
 *  - An other payment goes into the same payment_submissions verification queue
 *    as rent slips, marked with bill_type = "other_payment".
 *  - While pending it carries no rent_bill_id and no tenancy_id, so it cannot
 *    look like a pending rent slip or suppress rent chasing.
 *  - On verify, a key replacement or "other" payment is added as an invoice
 *    "other charge" line on that month's room invoice and posted as Other
 *    Tenant Charges Income (4190). An electricity top-up is added as a
 *    top_up_utilities line and posted as Top Up Utilities Income (4100). The
 *    invoice line creates the receivable and the income; the payment settles
 *    only that new charge, never the rent balance.
 *  - A deposit-balance payment stays a deposit liability: one `payments` row
 *    with category deposit, no invoice line, no income. It is capped at the
 *    deposit still owed.
 *  - Only bank transfer, DuitNow or online payment are accepted. A slip is
 *    required. Cash is not allowed.
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

/**
 * payments.category written when staff verify the slip.
 * Income types use the same categories as invoice extra-charge lines, so
 * collection review and the P&L already understand them (key_lock and other
 * → Other Tenant Charges Income; top_up_utilities → Top Up Utilities Income).
 * Deposit stays a liability and is never an invoice income line.
 */
export const OTHER_PAYMENT_CATEGORIES: Record<OtherPaymentType, string> = {
  top_up: "top_up_utilities",
  key_replacement: "key_lock",
  deposit: "deposit",
  other: "other",
};

/** Invoice line written on verify so the charge appears on the room/month invoice and in the P&L. */
export const OTHER_PAYMENT_INVOICE_CATEGORIES: Record<
  Exclude<OtherPaymentType, "deposit">,
  "top_up_utilities" | "key_lock" | "other"
> = {
  top_up: "top_up_utilities",
  key_replacement: "key_lock",
  other: "other",
};

/** Only bank methods. Cash is not accepted; a slip is always required. */
export const OTHER_PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "duitnow", label: "DuitNow QR" },
  { value: "online_payment", label: "Online payment" },
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

export type OtherPaymentInvoiceCharge = {
  category: "top_up_utilities" | "key_lock" | "other";
  description: string;
};

/** Null for a deposit (liability, no income). Otherwise the invoice line to book. */
export function otherPaymentInvoiceCharge(
  type: OtherPaymentType,
  description = "",
): OtherPaymentInvoiceCharge | null {
  if (type === "deposit") return null;
  if (type === "top_up") {
    return { category: "top_up_utilities", description: "Electricity top-up" };
  }
  if (type === "key_replacement") {
    return { category: "key_lock", description: "Lost key / key replacement" };
  }
  const detail = description.trim();
  return {
    category: "other",
    description: detail ? `Other payment — ${detail}` : "Other payment",
  };
}

/** Description entered for type "other", kept in payment_note as "For: …". */
export function otherPaymentDescriptionFromNote(note: string | null | undefined) {
  const match = (note ?? "").match(/^For:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

/**
 * How the room/month invoice should look after an income-type other payment is
 * verified. The new charge is added to the invoice total and to paid_amount by
 * the same amount, so unpaid rent is unchanged.
 */
export function settleInvoiceForOtherCharge(input: {
  rentAmount: number;
  depositAmount: number;
  existingExtraTotal: number;
  existingPaidAmount: number;
  existingDepositPaid: number;
  chargeAmount: number;
}) {
  const billAmount =
    input.rentAmount + input.existingExtraTotal + input.chargeAmount;
  const newPaidAmount = Math.min(
    input.existingPaidAmount + input.chargeAmount,
    billAmount,
  );
  const depositRequired = Math.max(input.depositAmount, 0);
  const depositPaid = Math.min(input.existingDepositPaid, depositRequired);
  const invoiceTotal = billAmount + depositRequired;
  const invoicePaid = newPaidAmount + depositPaid;
  const status =
    invoicePaid >= invoiceTotal - 0.005
      ? "paid"
      : invoicePaid > 0.005
        ? "partially_paid"
        : "unpaid";
  return { billAmount, newPaidAmount, status };
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

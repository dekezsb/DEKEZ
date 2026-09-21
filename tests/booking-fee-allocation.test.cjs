const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.resolve(__dirname, "../lib/payments/payment-purpose.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleValue = { exports: {} };
new Function("module", "exports", compiled)(moduleValue, moduleValue.exports);

const {
  isBookingFeePayment,
  paymentPurposeChangeNeedsReason,
  paymentPurposeLabel,
  persistedPaymentPurpose,
  verificationPaymentPurpose,
} = moduleValue.exports;

test("booking fee is shown as its original payment type", () => {
  assert.equal(isBookingFeePayment("booking_fee"), true);
  assert.equal(paymentPurposeLabel("booking_fee"), "Booking fee");
});

test("booking fee defaults to rent allocation without becoming rent", () => {
  assert.equal(verificationPaymentPurpose("booking_fee"), "monthly_rent");
  assert.equal(
    paymentPurposeChangeNeedsReason("booking_fee", "monthly_rent"),
    false,
  );
  assert.equal(
    persistedPaymentPurpose("booking_fee", "monthly_rent"),
    "booking_fee",
  );
});

test("ordinary purpose changes still need a correction reason", () => {
  assert.equal(
    paymentPurposeChangeNeedsReason("monthly_rent", "deposit"),
    true,
  );
  assert.equal(
    persistedPaymentPurpose("monthly_rent", "deposit"),
    "deposit",
  );
});

test("legacy rent and deposit labels keep their correct allocation side", () => {
  assert.equal(verificationPaymentPurpose("first_month_rental"), "monthly_rent");
  for (const purpose of [
    "rental_deposit",
    "security_deposit",
    "utility_deposit",
  ]) {
    assert.equal(verificationPaymentPurpose(purpose), "deposit");
    assert.equal(paymentPurposeChangeNeedsReason(purpose, "deposit"), false);
  }
});

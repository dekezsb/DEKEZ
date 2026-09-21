const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const action = fs.readFileSync(
  path.join(root, "app/payment-verification/actions.ts"),
  "utf8",
);
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20260921020301_verify_booking_fee_allocation.sql",
  ),
  "utf8",
);

test("booking fees use their protected atomic verification path", () => {
  assert.match(action, /currentSubmission\.payment_type === "booking_fee"/);
  assert.match(action, /verify_booking_fee_allocation/);
  assert.match(action, /error=booking_review/);
});

test("booking verification retains the source type and posts one allocation", () => {
  assert.match(migration, /s\.payment_type <> 'booking_fee'/);
  assert.doesNotMatch(
    migration,
    /update public\.payment_submissions[\s\S]*payment_type\s*=/,
  );
  assert.match(migration, /p_allocation not in \('monthly_rent', 'deposit'\)/);
  assert.match(migration, /payment_submission_id[\s\S]*p_allocation/);
});

test("booking verification changes the bill and audit in the same function", () => {
  assert.match(migration, /update public\.rent_bills/);
  assert.match(migration, /insert into public\.rent_bill_audit_logs/);
  assert.match(migration, /insert into public\.payment_verification_audit_logs/);
  assert.match(migration, /security definer/);
});

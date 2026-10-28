import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { syncFingerprintEnrollments } from "@/lib/ttlock/fingerprint";

// Keep the existing hourly cron for enrollment reconciliation only. The legacy
// Meta rent sender is permanently retired in this release, including when the
// new reminder engine is disabled or its configuration is missing. Never fall
// back to a second sender. Old deployed versions/in-flight calls must be drained
// and their logs reviewed before the new sender is separately approved.
async function enrollmentSummary() {
  const enrollment = await syncFingerprintEnrollments().catch(() => ({
    matched: 0,
    skipped: 0,
    errors: ["Enrollment sync requires review"],
  }));
  if (enrollment.errors.length) {
    console.error("Scheduled fingerprint enrollment reconciliation requires review.");
  }
  return {
    fingerprintMatched: enrollment.matched,
    fingerprintWaiting: enrollment.skipped,
    fingerprintEnrollmentErrors: enrollment.errors.length,
    fingerprintSuspended: 0,
    fingerprintSkipped: 0,
    fingerprintErrors: 0,
  };
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret ?? ""}`;
  if (!cronSecret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, {
      status: 401, headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json({
    ok: true, sent: 0, skipped: 0, failed: 0,
    legacyRentRemindersSkipped: true,
    rentalReminderSender: "retired",
    ...await enrollmentSummary(),
  }, { headers: { "Cache-Control": "no-store" } });
}

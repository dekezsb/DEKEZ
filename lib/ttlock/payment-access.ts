import "server-only";

import { extendFingerprintAccessAfterPayment } from "@/lib/ttlock/fingerprint";
import { extendPasscodeAccessAfterPayment } from "@/lib/ttlock/passcode-payment";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.slice(0, 500) : fallback;
}

/**
 * Staff-verified rent payment hook. Aligns existing fingerprints to the
 * contract end (no 30-day cycle) and extends any existing TTLock passcodes
 * by one month, capped at the contract end. Failures are collected and
 * never thrown, so payment verification can finish.
 */
export async function extendDoorAccessAfterPayment(input: {
  tenancyId: string;
  paymentSubmissionId: string;
  performedBy?: string | null;
}) {
  const fingerprint = await extendFingerprintAccessAfterPayment(input).catch(
    (error) => ({
      created: 0,
      matched: 0,
      extended: 0,
      suspended: 0,
      revoked: 0,
      skipped: 0,
      errors: [errorMessage(error, "TTLock fingerprint request failed.")],
    }),
  );
  const passcode = await extendPasscodeAccessAfterPayment(input).catch((error) => ({
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [errorMessage(error, "TTLock passcode request failed.")],
  }));

  return {
    fingerprint,
    passcode,
    errors: [...fingerprint.errors, ...passcode.errors],
  };
}

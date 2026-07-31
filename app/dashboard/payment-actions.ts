"use server";

import { uploadRentPaymentSlip } from "@/app/rent-due-tracker/actions";

/**
 * Gives the compact management dashboard its own Server Action identity.
 * Authorization and payment validation remain inside uploadRentPaymentSlip,
 * but the dashboard submission no longer depends on the protected tracker UI.
 */
export async function uploadManagementRentPaymentSlip(formData: FormData) {
  await uploadRentPaymentSlip(formData);
}

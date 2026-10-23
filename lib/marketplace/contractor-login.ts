import { normalizeInternationalPhone } from "@/lib/auth/phone";

// Shared input rules only: this module cannot authenticate, provision, reset or
// change roles. Credential verification and durable throttling belong server-side.
export const contractorLoginPolicy = {
  method: "phone_pin",
  futureMethod: "whatsapp_otp",
  starterPinLength: 4,
  personalPinLength: 6,
  maximumFailedAttempts: 5,
  lockoutMinutes: 15,
  changeStarterPinOnFirstLogin: true,
} as const;

export function contractorStarterPin(phoneValue: string): string | null {
  const phone = normalizeInternationalPhone(phoneValue);
  return phone ? phone.digits.slice(-4) : null;
}

export function validContractorPersonalPin(phoneValue: string, pin: string): boolean {
  const phone = normalizeInternationalPhone(phoneValue);
  if (!phone || !/^\d{6}$/.test(pin)) return false;
  // A personal PIN must not simply repeat the publicly known phone suffix.
  return pin !== phone.digits.slice(-6) && !/^(\d)\1{5}$/.test(pin)
    && !"01234567890123456789".includes(pin) && !"98765432109876543210".includes(pin);
}

export type ContractorLoginState = {
  // Server-loaded identity; no automatic conversion of an existing non-contractor.
  role: string;
  credentialVerified: boolean;
  starterPinChanged: boolean;
  accountEnabled: boolean;
};

export function contractorLoginDestination(state: ContractorLoginState):
  "/contractor/change-pin" | "/contractor/dashboard" | null {
  if (state.role !== "contractor" || state.credentialVerified !== true || state.accountEnabled !== true) return null;
  return state.starterPinChanged === true ? "/contractor/dashboard" : "/contractor/change-pin";
}

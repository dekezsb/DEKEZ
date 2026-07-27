import "server-only";

import { createHmac } from "node:crypto";
import type { InternationalPhone } from "./phone";

function authPepper() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!value) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable.");
  }

  return value;
}

function hmac(value: string) {
  return createHmac("sha256", authPepper()).update(value).digest("base64url");
}

export function initialPin(phone: InternationalPhone) {
  return phone.digits.slice(-4);
}

export function derivePinPassword(
  phone: InternationalPhone,
  pin = initialPin(phone),
) {
  if (!/^\d{4}$/.test(pin) || pin !== initialPin(phone)) {
    return null;
  }

  return `Dk!${hmac(`pin:v1:${phone.digits}:${pin}`)}`;
}

export function phoneAuthAlias(phone: InternationalPhone) {
  return `phone-${hmac(`alias:v1:${phone.digits}`).slice(0, 40)}@auth.dekez.invalid`;
}

export function phoneRateLimitKey(phone: InternationalPhone) {
  return hmac(`rate-limit:v1:${phone.digits}`);
}

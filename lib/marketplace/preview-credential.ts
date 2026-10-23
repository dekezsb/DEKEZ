import "server-only";
import { createHmac } from "node:crypto";
import type { InternationalPhone } from "@/lib/auth/phone";

// Separate namespace from tenant PINs. No credential literals or frontend secrets.
export function previewPassword(phone: InternationalPhone, password: string) {
  if (password.length < 5 || password.length > 128) return null;
  const pepper = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pepper) throw new Error("Authentication unavailable");
  return `Dkp!${createHmac("sha256", pepper).update(`contractor-preview:v1:${phone.digits}:${password}`).digest("base64url")}`;
}

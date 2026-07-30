import { cookies } from "next/headers";
import { isAppLocale, type AppLocale } from "@/lib/i18n";
import type { AppRole } from "@/lib/auth/roles";

export async function getUserLocale(role?: AppRole | null): Promise<AppLocale> {
  if (role === "super_admin") return "en";

  const cookieStore = await cookies();
  const savedLocale = cookieStore.get("dekez-language")?.value ?? null;
  return isAppLocale(savedLocale) ? savedLocale : "en";
}


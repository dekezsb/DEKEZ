"use client";

import { Globe2 } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import {
  localeNames,
  supportedLocales,
  type AppLocale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSelector({ dark = false }: { dark?: boolean }) {
  const { locale, setLocale, t } = useLanguage();

  return (
    <label className="relative flex items-center">
      <Globe2
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-2.5 h-4 w-4",
          dark ? "text-[#d7c6a8]" : "text-gray-500",
        )}
      />
      <span className="sr-only">{t("common.language")}</span>
      <select
        aria-label={t("common.language")}
        className={cn(
          "h-9 max-w-36 appearance-none rounded-md border py-1 pl-8 pr-7 text-xs font-semibold outline-none transition focus:ring-2 focus:ring-[#c99a3e]",
          dark
            ? "border-[#4a4031] bg-[#15120d] text-[#f8f0df]"
            : "border-[#cfd8e5] bg-white text-gray-900",
        )}
        onChange={(event) => setLocale(event.target.value as AppLocale)}
        value={locale}
      >
        {supportedLocales.map((item) => (
          <option key={item} value={item}>
            {localeNames[item]}
          </option>
        ))}
      </select>
    </label>
  );
}


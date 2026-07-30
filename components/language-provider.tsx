"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  isAppLocale,
  translate,
  type AppLocale,
  type TranslationKey,
} from "@/lib/i18n";
import type { AppRole } from "@/lib/auth/roles";

const STORAGE_KEY = "dekez-language";
const COOKIE_KEY = "dekez-language";

type LanguageContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  children,
  role,
}: {
  children: ReactNode;
  role: AppRole | null;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState<AppLocale>("en");
  const isEnglishOnly = role === "super_admin";

  useEffect(() => {
    if (isEnglishOnly) {
      setLocale("en");
      return;
    }

    const savedLocale = window.localStorage.getItem(STORAGE_KEY);
    if (isAppLocale(savedLocale)) {
      setLocale(savedLocale);
      return;
    }

    const browserLocale = window.navigator.language.toLowerCase();
    if (browserLocale.startsWith("ms")) setLocale("ms");
    if (browserLocale.startsWith("zh")) setLocale("zh");
    if (browserLocale.startsWith("ta")) setLocale("ta");
  }, [isEnglishOnly]);

  useEffect(() => {
    const effectiveLocale = isEnglishOnly ? "en" : locale;
    if (effectiveLocale !== locale) {
      setLocale(effectiveLocale);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.cookie = `${COOKIE_KEY}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang =
      locale === "en" ? "en-MY" : locale === "ms" ? "ms-MY" : locale;
  }, [isEnglishOnly, locale]);

  function updateLocale(nextLocale: AppLocale) {
    if (isEnglishOnly) return;
    setLocale(nextLocale);
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    document.cookie = `${COOKIE_KEY}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.setTimeout(() => router.refresh(), 0);
  }

  const value = useMemo(
    () => ({
      locale,
      setLocale: updateLocale,
      t: (key: TranslationKey) => translate(locale, key),
    }),
    [locale, isEnglishOnly, router],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return context;
}

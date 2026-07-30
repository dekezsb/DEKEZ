"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  isAppLocale,
  translate,
  type AppLocale,
  type TranslationKey,
} from "@/lib/i18n";

const STORAGE_KEY = "dekez-language";

type LanguageContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>("en");

  useEffect(() => {
    const savedLocale = window.localStorage.getItem(STORAGE_KEY);
    if (isAppLocale(savedLocale)) {
      setLocale(savedLocale);
      return;
    }

    const browserLocale = window.navigator.language.toLowerCase();
    if (browserLocale.startsWith("ms")) setLocale("ms");
    if (browserLocale.startsWith("zh")) setLocale("zh");
    if (browserLocale.startsWith("ta")) setLocale("ta");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang =
      locale === "en" ? "en-MY" : locale === "ms" ? "ms-MY" : locale;
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (key: TranslationKey) => translate(locale, key),
    }),
    [locale],
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

